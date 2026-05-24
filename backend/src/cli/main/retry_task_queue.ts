import type {
  CdxRepository,
  FetchPendingOptions,
  RetryEntryRow,
} from '../../cdx/repository';
import type { DownloadTask } from '../../request/downloader';

export type IsSyncDone = () => boolean;

const RETRY_TASK_PAGE_SIZE = 256;

/**
 * Feeds DownloadTasks to the consumer while honouring a concurrency cap.
 * The generator pauses before yielding the next task whenever `ongoing`
 * reaches `concurrency`, and resumes once a slot is freed via `onTaskDone()`.
 * This prevents fetching DB pages faster than tasks are being processed.
 *
 * Single-use: `run()` must be called at most once per instance. Create a
 * new instance for each run.
 */
export class RetryTaskQueue {
  private ongoing = 0;
  private hasRun = false;
  private readonly waiters: Array<() => void> = [];
  private readonly yielded = new Set<string>();

  constructor(
    private readonly concurrency: number,
    private readonly cdxRepo: CdxRepository,
    private readonly domains: string[],
    private readonly fetchPendingOptions: FetchPendingOptions,
    private readonly outputFolder: string,
    private readonly replayBaseUrl: string,
    private readonly runId: string,
    private readonly isSyncDone: IsSyncDone,
    /**
     * Per-task runner. If it rejects for any task, `run()` rethrows that
     * first error immediately, without waiting for in-flight tasks to
     * finish. Already-started tasks keep running in the background until
     * they settle; their results and any later rejections are silently
     * dropped.
     */
    private readonly runTask: (task: DownloadTask) => Promise<void>,
  ) {}

  private onTaskDone(key: string): void {
    this.yielded.delete(key);
    this.ongoing--;
    this.waiters.shift()?.();
  }

  private waitForSlot(): Promise<void> | void {
    if (this.ongoing < this.concurrency) return;
    return new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  private deduplicateTaskPayloads(page: RetryEntryRow[]): RetryEntryRow[] {
    // De-dupe across pages: `findRetryTasksPage` excludes rows that
    // already have a `request` row for this run, but a still-in-flight
    // task hasn't written its row yet — so the next page query can
    // re-yield it. Without this filter we'd double-dispatch and, once
    // all distinct tasks are yielded, spin in a tight loop re-querying
    // the same in-flight rows until they complete. Entries are removed
    // from `yielded` in `onTaskDone()`, so the set stays bounded by
    // concurrency rather than total task count.
    const fresh: RetryEntryRow[] = [];
    for (const entry of page) {
      const key = `${entry.domain_name}\t${entry.url}\t${entry.timestamp}`;
      if (this.yielded.has(key)) continue;
      this.yielded.add(key);
      fresh.push(entry);
    }
    return fresh;
  }

  private async *emitPageTasks(
    page: RetryEntryRow[],
  ): AsyncGenerator<{ task: DownloadTask; key: string }> {
    for (const entry of page) {
      await this.waitForSlot();
      this.ongoing++;
      const key = `${entry.domain_name}\t${entry.url}\t${entry.timestamp}`;
      yield {
        key,
        task: {
          runId: this.runId,
          timestamp: entry.timestamp,
          original: entry.url,
          domainName: entry.domain_name,
          normalizedDomain: entry.normalized_name,
          outputFolder: this.outputFolder,
          replayBaseUrl: this.replayBaseUrl,
        },
      };
    }
  }

  private async *tasks(): AsyncGenerator<{ task: DownloadTask; key: string }> {
    while (true) {
      await this.waitForSlot();

      const page = this.cdxRepo.findRetryTasksPage({
        domainIds: this.domains,
        runId: this.runId,
        fetchPendingOptions: this.fetchPendingOptions,
        limit: RETRY_TASK_PAGE_SIZE,
      });

      // De-dupe across pages: see `deduplicateTaskPayloads`.
      const fresh = this.deduplicateTaskPayloads(page);

      if (fresh.length === 0) {
        if (!this.isSyncDone() || this.ongoing > 0) {
          // Either CDX sync isn't finished yet (more tasks coming), or
          // some tasks are still in flight and haven't written their
          // request row yet. Sleep before re-querying so we don't spin
          // on the DB, and so that in the happy path `run()` only
          // returns after every yielded task has completed.
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        break;
      }

      yield* this.emitPageTasks(fresh);
    }
  }

  async run(): Promise<void> {
    if (this.hasRun) {
      throw new Error('RetryTaskQueue.run() can only be called once');
    }
    this.hasRun = true;

    const inflight = new Set<Promise<void>>();
    const tasks = this.tasks();
    let firstError = false;

    // Rejects on the first task failure, letting `run()` throw
    // immediately without waiting for in-flight tasks to finish.
    const { promise: failure, reject: failNow } =
      Promise.withResolvers<never>();

    const loop = (async () => {
      for await (const { task, key } of tasks) {
        const taskRun: Promise<void> = this.runTask(task).finally(() => {
          this.onTaskDone(key);
          inflight.delete(taskRun);
        });
        inflight.add(taskRun);
        // First failure: abort the generator and reject `run()` ASAP.
        // Later failures are absorbed here (this handler returns void),
        // so they don't become unhandled rejections. In-flight tasks
        // keep running in the background; their `.finally` still drains
        // `ongoing`/`inflight`, but the caller has already moved on.
        taskRun.catch((err) => {
          if (firstError) {
            // Already failing; this error won't be surfaced to the caller
            // so log it here to avoid losing diagnostic information.
            console.error(
              'RetryTaskQueue: additional task failure (suppressed)',
              err,
            );
            return;
          }
          firstError = true;
          tasks.return(undefined);
          failNow(err);
        });
      }
    })();
    // After a failure the race settles via `failure` and nobody is
    // awaiting `loop` anymore. If the generator then throws (e.g. the
    // next `findRetryTasksPage` call fails) the rejection would be
    // unhandled, so absorb it here. Log it so it isn't silently lost.
    loop.catch((err) => {
      console.error('RetryTaskQueue: background task loop failed', err);
    });

    await Promise.race([loop, failure]);
  }
}
