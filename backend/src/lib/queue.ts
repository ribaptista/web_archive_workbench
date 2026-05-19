/**
 * A generic bounded task queue backed by a fixed number of `TaskRunner`
 * instances. Each `queue()` call acquires a runner, invokes `runner.run()`,
 * and releases it. Requests that arrive while all runners are busy are
 * enqueued and resolved in FIFO order as runners become available.
 *
 * If `runner.run()` throws a `FatalTaskRunnerError`, the runner is terminated
 * and replaced by a fresh instance produced by the factory. Any other error
 * is propagated to the caller but leaves the runner in the pool.
 */

/**
 * Error thrown by a `TaskRunner` to signal that it is no longer usable and
 * must be terminated and replaced. The original error (if any) is exposed
 * via `cause`.
 */
export class FatalTaskRunnerError extends Error {
  readonly cause: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'FatalTaskRunnerError';
    this.cause = cause;
  }
}

/**
 * A reusable worker-like resource that processes one request at a time.
 *
 * - `run()` may throw any error. A `FatalTaskRunnerError` indicates the runner
 *   is no longer usable and triggers replacement in the queue.
 * - `terminate()` releases any underlying resources held by the runner.
 */
export interface TaskRunner {
  run<TRequest, TResponse>(request: TRequest): Promise<TResponse>;
  terminate(): Promise<void>;
}

type RunnerWaiter = {
  resolve: (runner: TaskRunner) => void;
  reject: (err: Error) => void;
};

export class TaskQueue {
  private readonly allRunners: TaskRunner[];
  private readonly freeRunners: TaskRunner[];
  private readonly waitQueue: RunnerWaiter[] = [];
  private readonly factory: (() => TaskRunner) | null;
  private terminated = false;

  /**
   * Create a queue that lazily produces `size` runners via `factory`. Fatal
   * runners are terminated and transparently replaced by a fresh instance.
   */
  constructor(size: number, factory: () => TaskRunner);
  /**
   * Create a queue backed by a fixed set of pre-built runners. Fatal runners
   * are terminated and dropped from the pool with no replacement. If every
   * runner dies, subsequent `queue()` calls (and any pending waiters) reject
   * with an "exhausted" error.
   */
  constructor(runners: TaskRunner[]);
  constructor(
    sizeOrRunners: number | TaskRunner[],
    factory?: () => TaskRunner,
  ) {
    if (typeof sizeOrRunners === 'number') {
      // factory is guaranteed to be defined by the (size, factory) overload.
      this.factory = factory!;
      this.allRunners = Array.from({ length: sizeOrRunners }, () =>
        this.factory!(),
      );
    } else {
      if (sizeOrRunners.length === 0) {
        throw new Error('TaskQueue: runners array must not be empty');
      }
      this.factory = null;
      this.allRunners = [...sizeOrRunners];
    }
    this.freeRunners = [...this.allRunners];
  }

  private acquire(): Promise<TaskRunner> {
    if (this.freeRunners.length > 0)
      return Promise.resolve(this.freeRunners.pop()!);
    return new Promise((resolve, reject) =>
      this.waitQueue.push({ resolve, reject }),
    );
  }

  private release(runner: TaskRunner): void {
    if (this.terminated) return;
    const next = this.waitQueue.shift();
    if (next) next.resolve(runner);
    else this.freeRunners.push(runner);
  }

  /**
   * Terminate `dead` and remove it from the pool. In replaceable mode, a
   * fresh runner is created in its slot and released back to the queue. In
   * fixed mode, the slot is dropped; if the pool empties, all pending
   * waiters are rejected. No-op if the queue has already been terminated.
   */
  private async handleCorruptedRunner(dead: TaskRunner): Promise<void> {
    await dead.terminate();
    if (this.terminated) return;
    const idx = this.allRunners.indexOf(dead);
    if (idx === -1) {
      // Bug: every runner handed out by acquire() came from allRunners and is
      // only ever removed here. Reaching this branch means our invariant is
      // broken.
      throw new Error('TaskQueue bug: dead runner not found in allRunners');
    }
    if (this.factory) {
      this.replaceCorruptedRunner(idx);
    } else {
      this.discardCorruptedRunner(idx);
    }
  }

  private replaceCorruptedRunner(idx: number): void {
    const fresh = this.factory!();
    this.allRunners[idx] = fresh;
    this.release(fresh);
  }

  private discardCorruptedRunner(idx: number): void {
    this.allRunners.splice(idx, 1);
    if (this.allRunners.length === 0) {
      const err = new Error(
        'TaskQueue exhausted: all runners died with fatal errors',
      );
      for (const waiter of this.waitQueue.splice(0)) waiter.reject(err);
    }
  }

  async queue<TRequest, TResponse>(request: TRequest): Promise<TResponse> {
    if (this.terminated) throw new Error('TaskQueue is terminated');
    if (this.allRunners.length === 0) {
      throw new Error(
        'TaskQueue exhausted: all runners died with fatal errors',
      );
    }
    const runner = await this.acquire();
    try {
      const result = await runner.run<TRequest, TResponse>(request);
      this.release(runner);
      return result;
    } catch (err) {
      if (err instanceof FatalTaskRunnerError) {
        await this.handleCorruptedRunner(runner);
      } else {
        this.release(runner);
      }
      throw err;
    }
  }

  async terminate(): Promise<void> {
    this.terminated = true;
    const err = new Error('TaskQueue is terminated');
    for (const waiter of this.waitQueue.splice(0)) waiter.reject(err);
    await Promise.all(this.allRunners.map((r) => r.terminate()));
  }
}
