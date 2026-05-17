import path from 'path';
import pLimit from 'p-limit';
import { v4 as uuidv4 } from 'uuid';
import { parseArgs, type DownloadOptions } from './args';
import { openDatabase, DB_FILENAME } from '../../db/conn';
import { RunRepository } from '../../run/repository';
import {
  CdxRepository,
  type PendingTaskCounts,
  type FetchPendingOptions,
} from '../../cdx/repository';
import { RequestRepository } from '../../request/repository';
import {
  fetchCdxRows,
  insertCdxEntries,
  getOrCreateCdxFile,
  getOrCreateCdxSource,
  findNewEntries,
  type CdxQueryOptions,
  type CdxServer,
  type EvaluatedCdxEntry,
} from '../../cdx/sync';
import { ProgressTracker } from '../progress_tracker';
import { AgentPool } from '../../http/agent_pool';
import { downloadEntry, type DownloadTask } from '../../request/downloader';

import type { Database as DB } from 'better-sqlite3';

const NEW_ENTRIES_PREVIEW_CAP = 16;
const RETRY_ENTRIES_PREVIEW_CAP = 16;
const RETRY_TASK_PAGE_SIZE = 128;

type NewEntryPreview = {
  original: string | null;
  timestamp: number | null;
};

function appendNewEntryPreviewsCapped(
  target: NewEntryPreview[],
  entries: Array<{ original: string | null; timestamp: number | null }>,
): void {
  for (const e of entries) {
    if (target.length >= NEW_ENTRIES_PREVIEW_CAP) break;
    target.push({
      original: e.original,
      timestamp: e.timestamp,
    });
  }
}

function resolveDomains(
  cdxRepo: CdxRepository,
  runId: string,
  domains?: string[],
): string[] {
  if (domains === undefined) {
    return cdxRepo.findAllDomains().map((row) => row.name);
  }

  return domains.map((domain) => getOrCreateCdxFile(cdxRepo, domain, runId));
}

function printDownloadPlanSummary(
  summary: Array<{
    domain: string;
    entriesCapped?: RetryEntry[];
    pendingCount: number;
  }>,
  verbose: boolean,
): void {
  console.log('\n--- Download plan summary ---');
  for (const s of summary) {
    const entriesCapped = s.entriesCapped ?? [];
    console.log(`  ${s.domain}: ${s.pendingCount} entries to download`);
    if (verbose && entriesCapped.length > 0) {
      for (const e of entriesCapped) {
        console.log(`    [${e.timestamp}] ${e.url}`);
      }
      if (s.pendingCount > entriesCapped.length) {
        console.log(`    and ${s.pendingCount - entriesCapped.length} more`);
      }
    }
  }
}

function printSyncDryRunSummary(
  summary: Array<{
    domain: string;
    newEntriesCapped: NewEntryPreview[];
    newEntryCount: number;
  }>,
  verbose: boolean,
): void {
  console.log('\n--- Dry-run Summary ---');
  for (const s of summary) {
    console.log(`  ${s.domain}: ${s.newEntryCount} new entries`);
    if (verbose && s.newEntriesCapped.length > 0) {
      for (const e of s.newEntriesCapped) {
        console.log(`    [${e.timestamp ?? '-'}] ${e.original}`);
      }
      if (s.newEntryCount > s.newEntriesCapped.length) {
        console.log(
          `    and ${s.newEntryCount - s.newEntriesCapped.length} more`,
        );
      }
    }
  }
}

type RetryEntry = {
  url: string;
  timestamp: number;
  domain_name: string;
  normalized_name: string;
};

type IsSyncDone = () => boolean;

function samplePendingEntries(
  cdxRepo: CdxRepository,
  domains: string[],
  fetchPendingOptions: FetchPendingOptions,
): Map<string, RetryEntry[]> {
  const sampledByDomainId = new Map<string, RetryEntry[]>();
  if (domains.length === 0) return sampledByDomainId;

  for (const domainId of domains) {
    const sampled = cdxRepo.samplePendingEntries({
      domainId,
      fetchPendingOptions,
      limit: RETRY_ENTRIES_PREVIEW_CAP,
    }) as RetryEntry[];
    sampledByDomainId.set(domainId, sampled);
  }

  return sampledByDomainId;
}

function runDownloadPlan(
  cdxRepo: CdxRepository,
  domains: string[],
  verbose: boolean,
  fetchPendingOptions: FetchPendingOptions,
  pendingTaskCounts: PendingTaskCounts,
): void {
  const sampledByDomain = verbose
    ? samplePendingEntries(cdxRepo, domains, fetchPendingOptions)
    : undefined;
  const summary = domains.map((domain) => ({
    domain,
    pendingCount: pendingTaskCounts.byDomainId.get(domain)!,
    ...(verbose ? { entriesCapped: sampledByDomain!.get(domain)! } : {}),
  }));
  printDownloadPlanSummary(summary, verbose);
}

async function runRetryMode(
  cdxRepo: CdxRepository,
  domains: string[],
  fetchPendingOptions: FetchPendingOptions,
  output: string,
  replayBaseUrl: string,
  runId: string,
  isSyncDone: IsSyncDone,
  runDownloads: (tasks: DownloadTask[]) => Promise<void>,
): Promise<void> {
  const outputFolder = output;

  while (true) {
    const pendingEntriesPage = cdxRepo.findRetryTasksPage({
      domainIds: domains,
      runId,
      fetchPendingOptions,
      limit: RETRY_TASK_PAGE_SIZE,
    }) as RetryEntry[];

    if (pendingEntriesPage.length === 0) {
      if (!isSyncDone()) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      break;
    }

    const tasks = pendingEntriesPage.map((entry) => ({
      runId,
      timestamp: entry.timestamp,
      original: entry.url,
      domainName: entry.domain_name,
      normalizedDomain: entry.normalized_name,
      outputFolder,
      replayBaseUrl,
    }));

    await runDownloads(tasks);
  }
}

function handleSyncResultPage(
  db: DB,
  cdxRepo: CdxRepository,
  runRepo: RunRepository,
  domain: string,
  cdxSourceId: number,
  runId: string,
  dryRun: boolean,
  pageEntries: EvaluatedCdxEntry[],
): EvaluatedCdxEntry[] {
  if (dryRun) {
    return findNewEntries(cdxRepo, domain, pageEntries);
  }
  return insertCdxEntries(
    db,
    cdxRepo,
    runRepo,
    runId,
    domain,
    cdxSourceId,
    pageEntries,
  );
}

interface SyncDomainResult {
  domain: string;
  newEntriesCapped: NewEntryPreview[];
  newEntryCount: number;
}

async function syncDomain(
  db: DB,
  cdxRepo: CdxRepository,
  runRepo: RunRepository,
  domain: string,
  cdxSourceId: number,
  runId: string,
  dryRun: boolean,
  cdxServer: CdxServer,
  pageSize: number,
  log: (msg: string) => void = console.log,
  onNewEntries?: (count: number) => void,
): Promise<SyncDomainResult | null> {
  let domainEntryCount = 0;
  const newEntriesCapped: NewEntryPreview[] = [];
  let newEntryCount = 0;
  const cdxOptions: CdxQueryOptions = {
    baseUrl: cdxServer.baseUrl,
    strategy: cdxServer.strategy,
    pageSize,
  };

  for await (const pageEntries of fetchCdxRows(domain, cdxOptions, log)) {
    domainEntryCount += pageEntries.length;
    const newEntries = handleSyncResultPage(
      db,
      cdxRepo,
      runRepo,
      domain,
      cdxSourceId,
      runId,
      dryRun,
      pageEntries,
    );
    newEntryCount += newEntries.length;
    appendNewEntryPreviewsCapped(newEntriesCapped, newEntries);
    if (newEntries.length > 0) onNewEntries?.(newEntries.length);
  }

  if (domainEntryCount === 0) return null;
  return { domain, newEntriesCapped, newEntryCount };
}

async function syncDomains(
  db: DB,
  cdxRepo: CdxRepository,
  runRepo: RunRepository,
  domains: string[],
  cdxSourceId: number,
  runId: string,
  dryRun: boolean,
  cdxServer: CdxServer,
  pageSize: number,
  log: (msg: string) => void = console.log,
  onNewEntries?: (count: number) => void,
): Promise<SyncDomainResult[]> {
  const summary: SyncDomainResult[] = [];

  for (const domain of domains) {
    log(`\nDomain: ${domain}`);
    try {
      const result = await syncDomain(
        db,
        cdxRepo,
        runRepo,
        domain,
        cdxSourceId,
        runId,
        dryRun,
        cdxServer,
        pageSize,
        log,
        onNewEntries,
      );
      if (result === null) {
        log('  No CDX entries found.');
        continue;
      }
      summary.push(result);
    } catch (err) {
      console.error(`  Error fetching CDX: ${err}`);
      throw err;
    }
  }

  return summary;
}

async function runSyncMode(
  db: DB,
  cdxRepo: CdxRepository,
  runRepo: RunRepository,
  domains: string[],
  dryRun: boolean,
  verbose: boolean,
  cdxServer: CdxServer,
  pageSize: number,
  runId: string,
  log: (msg: string) => void = console.log,
  onNewEntries?: (count: number) => void,
): Promise<void> {
  const cdxSourceId = getOrCreateCdxSource(cdxRepo, cdxServer);

  const summary = await syncDomains(
    db,
    cdxRepo,
    runRepo,
    domains,
    cdxSourceId,
    runId,
    dryRun,
    cdxServer,
    pageSize,
    log,
    onNewEntries,
  );

  if (dryRun) {
    printSyncDryRunSummary(summary, verbose);
  }

  const totalNew = summary.reduce((sum, s) => sum + s.newEntryCount, 0);
  log(
    `\n${dryRun ? 'Found' : 'Synced'} ${totalNew} new CDX entries across ${summary.length} domain(s).`,
  );
}

async function runDryRun(
  db: DB,
  cdxRepo: CdxRepository,
  runRepo: RunRepository,
  domains: string[],
  skipCdxSync: boolean,
  verbose: boolean,
  cdxServer: CdxServer,
  cdxPageSize: number,
  fetchPendingOptions: FetchPendingOptions,
  runId: string,
): Promise<void> {
  if (!skipCdxSync) {
    await runSyncMode(
      db,
      cdxRepo,
      runRepo,
      domains,
      true,
      verbose,
      cdxServer,
      cdxPageSize,
      runId,
    );
  }
  const pendingTaskCounts = cdxRepo.countPendingTasks(
    domains,
    fetchPendingOptions,
  );
  if (pendingTaskCounts.total === 0) {
    console.log('No pending entries found.');
    return;
  }
  runDownloadPlan(
    cdxRepo,
    domains,
    verbose,
    fetchPendingOptions,
    pendingTaskCounts,
  );
}

function handleCdxSync(
  db: DB,
  cdxRepo: CdxRepository,
  runRepo: RunRepository,
  domains: string[],
  skipCdxSync: boolean,
  cdxServer: CdxServer,
  cdxPageSize: number,
  runId: string,
  log: (msg: string) => void,
  onNewEntries: (count: number) => void,
): IsSyncDone {
  if (skipCdxSync) {
    return () => true;
  }
  let syncDone = false;
  let syncError: unknown = undefined;
  runSyncMode(
    db,
    cdxRepo,
    runRepo,
    domains,
    false,
    false,
    cdxServer,
    cdxPageSize,
    runId,
    log,
    onNewEntries,
  )
    .then(() => {
      syncDone = true;
    })
    .catch((err) => {
      syncError = err;
      throw err;
    });
  return () => {
    if (syncError) throw syncError;
    return syncDone;
  };
}

async function runDownloadTasks(
  db: DB,
  reqRepo: RequestRepository,
  cdxRepo: CdxRepository,
  runRepo: RunRepository,
  tasks: DownloadTask[],
  pool: AgentPool,
  limit: ReturnType<typeof pLimit>,
  onDownloadResult: (ok: boolean) => void,
): Promise<void> {
  await Promise.all(
    tasks.map((task) =>
      limit(async () => {
        onDownloadResult(
          await downloadEntry(db, reqRepo, cdxRepo, runRepo, task, pool),
        );
      }),
    ),
  );
}

async function runLiveRun(
  db: DB,
  cdxRepo: CdxRepository,
  runRepo: RunRepository,
  reqRepo: RequestRepository,
  domains: string[],
  skipCdxSync: boolean,
  cdxPageSize: number,
  fetchPendingOptions: FetchPendingOptions,
  downloadOptions: DownloadOptions,
  cdxServer: CdxServer,
  runId: string,
): Promise<void> {
  const pool = new AgentPool({
    proxyFile: downloadOptions.proxyFile,
    limiterOptions: downloadOptions.limiterOptions,
  });
  const limit = pLimit(downloadOptions.concurrency);

  const pendingTaskCounts = cdxRepo.countPendingTasks(
    domains,
    fetchPendingOptions,
  );

  if (skipCdxSync && pendingTaskCounts.total === 0) {
    console.log('No pending entries found.');
    return;
  }

  const tracker = new ProgressTracker(pendingTaskCounts.total);
  tracker.startProgressBar();

  const isSyncDone = handleCdxSync(
    db,
    cdxRepo,
    runRepo,
    domains,
    skipCdxSync,
    cdxServer,
    cdxPageSize,
    runId,
    (msg) => tracker.log(msg),
    (count) => tracker.incrementTotal(count),
  );

  const runDownloads = async (tasks: DownloadTask[]): Promise<void> => {
    await runDownloadTasks(
      db,
      reqRepo,
      cdxRepo,
      runRepo,
      tasks,
      pool,
      limit,
      (ok) => tracker.pushResult(ok),
    );
  };

  await runRetryMode(
    cdxRepo,
    domains,
    fetchPendingOptions,
    downloadOptions.dataFolder,
    cdxServer.replayBaseUrl,
    runId,
    isSyncDone,
    runDownloads,
  );

  tracker.stopProgressBar();
  const { succeeded, failed } = tracker.getStats();
  console.log(`Complete. succeeded: ${succeeded}, failed: ${failed}`);
}

async function main() {
  const args = parseArgs();
  const db = openDatabase(path.join(args.dataFolder, DB_FILENAME));

  const runId = uuidv4();
  const cdxRepo = new CdxRepository(db);
  const runRepo = new RunRepository(db);
  const reqRepo = new RequestRepository(db);
  runRepo.insertRun(runId);
  runRepo.insertRunArgs(runId, args);

  const domains = resolveDomains(
    cdxRepo,
    runId,
    args.all ? undefined : args.domain,
  );
  if (domains.length === 0) {
    console.log('No domains found in database.');
    return;
  }

  if (args.dryRun) {
    await runDryRun(
      db,
      cdxRepo,
      runRepo,
      domains,
      args.skipCdxSync,
      args.verbose,
      args.cdxServer,
      args.cdxPageSize,
      args.fetchPendingOptions,
      runId,
    );
    return;
  }

  await runLiveRun(
    db,
    cdxRepo,
    runRepo,
    reqRepo,
    domains,
    args.skipCdxSync,
    args.cdxPageSize,
    args.fetchPendingOptions,
    args.downloadOptions,
    args.cdxServer,
    runId,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
