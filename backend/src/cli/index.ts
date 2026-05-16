import pLimit from 'p-limit';
import { v4 as uuidv4 } from 'uuid';
import cliProgress from 'cli-progress';
import { parseArgs } from './args';
import { openDatabase } from '../db/conn';
import { RunRepository } from '../run/repository';
import { CdxRepository } from '../cdx/repository';
import { RequestRepository } from '../request/repository';
import {
  fetchCdxRows,
  insertCdxEntries,
  getOrCreateCdxFile,
  getOrCreateCdxSource,
  findNewEntries,
} from '../cdx/sync';
import { loadAgents } from '../http/agents';
import { AgentPool } from '../http/agent_pool';
import { downloadEntry, type DownloadTask } from '../request/downloader';

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
  runRepo: RunRepository,
  args: { all: boolean; domain: string[] },
  runId: string,
): Map<string, string> {
  const domains = new Map<string, string>();
  if (args.all) {
    const rows = cdxRepo.findAllDomains();
    for (const row of rows) {
      domains.set(row.name, row.name);
    }
    return domains;
  }

  for (const domain of args.domain) {
    const domainName = getOrCreateCdxFile(cdxRepo, domain, runId);
    domains.set(domainName, domain);
  }
  return domains;
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

type PendingTaskCounts = {
  total: number;
  byDomainId: Map<string, number>;
};

async function countPendingTasks(
  cdxRepo: CdxRepository,
  domains: Map<string, string>,
  skipErrors: string[],
  skipErrorMessages: string[],
): Promise<PendingTaskCounts> {
  if (domains.size === 0) {
    return { total: 0, byDomainId: new Map<string, number>() };
  }

  const domainIds = Array.from(domains.keys());
  const rows = cdxRepo.countPendingByDomains({
    domainIds,
    skipErrors,
    skipErrorMessages,
  });

  const byDomainId = new Map<string, number>();
  for (const domainId of domainIds) byDomainId.set(domainId, 0);
  let total = 0;
  for (const row of rows) {
    byDomainId.set(row.domain_name, row.n);
    total += row.n;
  }

  return { total, byDomainId };
}

function samplePendingEntries(
  cdxRepo: CdxRepository,
  domains: Map<string, string>,
  skipErrors: string[],
  skipErrorMessages: string[],
): Map<string, RetryEntry[]> {
  const sampledByDomainId = new Map<string, RetryEntry[]>();
  if (domains.size === 0) return sampledByDomainId;

  for (const domainId of domains.keys()) {
    const sampled = cdxRepo.samplePendingEntries({
      domainId,
      skipErrors,
      skipErrorMessages,
      limit: RETRY_ENTRIES_PREVIEW_CAP,
    }) as RetryEntry[];
    sampledByDomainId.set(domainId, sampled);
  }

  return sampledByDomainId;
}

function runDownloadPlan(
  cdxRepo: CdxRepository,
  domains: Map<string, string>,
  args: {
    skipErrors: string[];
    skipErrorMessages: string[];
    verbose: boolean;
  },
  pendingTaskCounts: PendingTaskCounts,
): void {
  const sampledByDomain = args.verbose
    ? samplePendingEntries(
        cdxRepo,
        domains,
        args.skipErrors,
        args.skipErrorMessages,
      )
    : undefined;
  const summary = Array.from(domains.entries()).map(([domainId, domain]) => ({
    domain,
    pendingCount: pendingTaskCounts.byDomainId.get(domainId)!,
    ...(args.verbose ? { entriesCapped: sampledByDomain!.get(domainId)! } : {}),
  }));
  printDownloadPlanSummary(summary, args.verbose);
}

async function runRetryMode(
  cdxRepo: CdxRepository,
  domains: Map<string, string>,
  args: {
    skipErrors: string[];
    skipErrorMessages: string[];
    dryRun: boolean;
    verbose: boolean;
    output: string;
    replayBaseUrl: string;
  },
  runId: string,
  isSyncDone: () => boolean,
  runDownloads: (tasks: DownloadTask[]) => Promise<void>,
): Promise<void> {
  const domainIds = Array.from(domains.keys());
  const outputFolder = args.output;

  while (true) {
    const pendingEntriesPage = cdxRepo.findRetryTasksPage({
      domainIds,
      runId,
      skipErrors: args.skipErrors,
      skipErrorMessages: args.skipErrorMessages,
      limit: RETRY_TASK_PAGE_SIZE,
    }) as RetryEntry[];

    if (pendingEntriesPage.length === 0) {
      if (!isSyncDone()) {
        await new Promise((r) => setTimeout(r, 2000));
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
      replayBaseUrl: args.replayBaseUrl,
    }));

    await runDownloads(tasks);
  }
}

async function runSyncMode(
  db: DB,
  cdxRepo: CdxRepository,
  runRepo: RunRepository,
  domains: Map<string, string>,
  args: {
    dryRun: boolean;
    verbose: boolean;
    output: string;
    cdxPageSize: number;
    cdxBaseUrl: string;
    cdxStrategy: 'json_wayback' | 'json_pywb';
    replayBaseUrl: string;
  },
  runId: string,
  log: (msg: string) => void,
  onNewEntries?: (count: number) => void,
): Promise<void> {
  const summary: Array<{
    domain: string;
    newEntriesCapped: NewEntryPreview[];
    newEntryCount: number;
  }> = [];

  const cdxSourceId = getOrCreateCdxSource(
    cdxRepo,
    args.cdxBaseUrl,
    args.replayBaseUrl,
  );

  for (const [domainName, domain] of domains) {
    log(`\nDomain: ${domain}`);

    let domainEntryCount = 0;
    const newEntriesCapped: NewEntryPreview[] = [];
    let newEntryCount = 0;

    try {
      for await (const pageEntries of fetchCdxRows(
        domain,
        args.cdxPageSize,
        log,
        args.cdxBaseUrl,
        args.cdxStrategy,
        args.replayBaseUrl,
      )) {
        domainEntryCount += pageEntries.length;
        if (args.dryRun) {
          const newEntries = findNewEntries(cdxRepo, domain, pageEntries);
          newEntryCount += newEntries.length;
          appendNewEntryPreviewsCapped(newEntriesCapped, newEntries);
        } else {
          const insertedEntries = insertCdxEntries(
            db,
            cdxRepo,
            runRepo,
            runId,
            domainName,
            cdxSourceId,
            pageEntries,
          );
          newEntryCount += insertedEntries.length;
          appendNewEntryPreviewsCapped(newEntriesCapped, insertedEntries);
          onNewEntries?.(insertedEntries.length);
        }
      }
    } catch (err) {
      console.error(`  Error fetching CDX: ${err}`);
      throw err;
    }

    if (domainEntryCount === 0) {
      log('  No CDX entries found.');
      continue;
    }

    summary.push({ domain, newEntriesCapped, newEntryCount });
  }

  if (args.dryRun) {
    printSyncDryRunSummary(summary, args.verbose);
  }

  const totalNew = summary.reduce((sum, s) => sum + s.newEntryCount, 0);
  log(
    `\nSynced ${totalNew} new CDX entries across ${summary.length} domain(s).`,
  );
}

async function main() {
  const args = parseArgs();
  const db = openDatabase(args.db);

  const runId = uuidv4();
  const cdxRepo = new CdxRepository(db);
  const runRepo = new RunRepository(db);
  const reqRepo = new RequestRepository(db);
  runRepo.insertRun(runId);
  runRepo.insertRunArgs(runId, args);

  const domains = resolveDomains(cdxRepo, runRepo, args, runId);
  if (domains.size === 0) {
    console.log('No domains found in database.');
    return;
  }

  // Dry-run: show summaries only, no downloading
  if (args.dryRun) {
    if (!args.retryErrors) {
      await runSyncMode(
        db,
        cdxRepo,
        runRepo,
        domains,
        args,
        runId,
        console.log,
      );
    }
    const pendingTaskCounts = await countPendingTasks(
      cdxRepo,
      domains,
      args.skipErrors,
      args.skipErrorMessages,
    );
    if (pendingTaskCounts.total === 0) {
      console.log('No pending entries found.');
      return;
    }
    runDownloadPlan(cdxRepo, domains, args, pendingTaskCounts);
    return;
  }

  // Live run
  const pool = new AgentPool(
    loadAgents(args.proxyFile, args.maxReqPerPeriod!, args.periodMs!),
  );
  const limit = pLimit(args.concurrency);

  const multiBar = new cliProgress.MultiBar(
    {
      format:
        'Progress |{bar}| {value}/{total} | succeeded: {succeeded} | failed: {failed} | ETA: {eta_formatted}',
      clearOnComplete: false,
      hideCursor: true,
    },
    cliProgress.Presets.shades_classic,
  );

  let succeeded = 0;
  let failed = 0;
  let bar: cliProgress.SingleBar;
  const runDownloads = async (tasks: DownloadTask[]): Promise<void> => {
    await Promise.all(
      tasks.map((task) =>
        limit(async () => {
          const ok = await downloadEntry(
            db,
            reqRepo,
            cdxRepo,
            runRepo,
            task,
            pool,
          );
          if (ok) succeeded++;
          else failed++;
          bar.increment({ succeeded, failed });
        }),
      ),
    );
  };

  if (args.retryErrors) {
    // Sync skipped — count pending upfront and download
    const pendingTaskCounts = await countPendingTasks(
      cdxRepo,
      domains,
      args.skipErrors,
      args.skipErrorMessages,
    );
    if (pendingTaskCounts.total === 0) {
      console.log('No pending entries found.');
      return;
    }
    bar = multiBar.create(pendingTaskCounts.total, 0, {
      succeeded: 0,
      failed: 0,
    });
    await runRetryMode(cdxRepo, domains, args, runId, () => true, runDownloads);
  } else {
    // Run sync and download concurrently
    // Seed the bar total with whatever is already pending in the DB
    const initialPending = await countPendingTasks(
      cdxRepo,
      domains,
      args.skipErrors,
      args.skipErrorMessages,
    );
    bar = multiBar.create(initialPending.total, 0, { succeeded: 0, failed: 0 });
    let barTotal = initialPending.total;
    let syncDone = false;
    await Promise.all([
      runSyncMode(
        db,
        cdxRepo,
        runRepo,
        domains,
        args,
        runId,
        (msg) => multiBar.log(msg + '\n'),
        (count) => {
          barTotal += count;
          bar.setTotal(barTotal);
        },
      ).then(() => {
        syncDone = true;
      }),
      runRetryMode(cdxRepo, domains, args, runId, () => syncDone, runDownloads),
    ]);
  }

  multiBar.stop();
  console.log(`Complete. succeeded: ${succeeded}, failed: ${failed}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
