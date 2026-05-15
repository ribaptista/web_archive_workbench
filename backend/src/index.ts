import pLimit from 'p-limit';
import { v4 as uuidv4 } from 'uuid';
import cliProgress from 'cli-progress';
import { parseArgs } from './cli';
import { openDatabase, insertRun, insertRunArgs } from './db';
import { fetchCdxRows, insertCdxEntries, getOrCreateCdxFile } from './cdx';
import { findNewEntries } from './sync';
import { loadProxies } from './proxy';
import { downloadEntry, type DownloadTask } from './downloader';

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
  db: DB,
  args: { all: boolean; domain: string[] },
  runId: string,
): Map<string, string> {
  const domains = new Map<string, string>();
  if (args.all) {
    const rows = db
      .prepare(`SELECT id, domain FROM cdx_file ORDER BY domain`)
      .all() as { id: string; domain: string }[];
    for (const row of rows) {
      domains.set(row.id, row.domain);
    }
    return domains;
  }

  for (const domain of args.domain) {
    const cdxId = getOrCreateCdxFile(db, domain, runId);
    domains.set(cdxId, domain);
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
  cdx_id: string;
  normalized_domain: string;
};

type PendingTaskCounts = {
  total: number;
  byDomainId: Map<string, number>;
};

function buildSkipErrorFilter(
  skipErrors: string[],
  skipErrorMessages: string[],
): {
  skipErrorParams: string[];
  skipErrorExistsClause: string;
} {
  const skipErrorFilters = [
    ...skipErrors.map(() => `re.error_code = ?`),
    ...skipErrorMessages.map(() => `re.error_message LIKE ?`),
  ].join(' OR ');
  const skipErrorParams = [...skipErrors, ...skipErrorMessages];
  const skipErrorExistsClause = skipErrorFilters.length
    ? `AND NOT EXISTS (
        SELECT 1 FROM request_errors re
        JOIN request r ON r.id = re.request_id
        WHERE r.resource_version_url = rv.url
          AND r.resource_version_timestamp = rv.timestamp
          AND (${skipErrorFilters})
      )`
    : '';

  return { skipErrorParams, skipErrorExistsClause };
}

async function countPendingTasks(
  db: DB,
  domains: Map<string, string>,
  skipErrors: string[],
  skipErrorMessages: string[],
): Promise<PendingTaskCounts> {
  if (domains.size === 0) {
    return { total: 0, byDomainId: new Map<string, number>() };
  }

  const { skipErrorParams, skipErrorExistsClause } = buildSkipErrorFilter(
    skipErrors,
    skipErrorMessages,
  );

  const domainIds = Array.from(domains.keys());
  const domainPlaceholders = domainIds.map(() => '?').join(', ');
  const countStmt = db.prepare(
    `SELECT rvs.cdx_id AS cdx_id, count(*) AS n
       FROM resource_version rv
       JOIN resource_version_source rvs ON rvs.url = rv.url AND rvs.timestamp = rv.timestamp
       WHERE rvs.cdx_id IN (${domainPlaceholders})
         AND rv.successful_request_id IS NULL
         ${skipErrorExistsClause}
       GROUP BY rvs.cdx_id`,
  );

  const rows = countStmt.all(...domainIds, ...skipErrorParams) as Array<{
    cdx_id: string;
    n: number;
  }>;

  const byDomainId = new Map<string, number>();
  for (const domainId of domainIds) byDomainId.set(domainId, 0);
  let total = 0;
  for (const row of rows) {
    byDomainId.set(row.cdx_id, row.n);
    total += row.n;
  }

  return { total, byDomainId };
}

function samplePendingEntries(
  db: DB,
  domains: Map<string, string>,
  skipErrors: string[],
  skipErrorMessages: string[],
): Map<string, RetryEntry[]> {
  const sampledByDomainId = new Map<string, RetryEntry[]>();
  if (domains.size === 0) return sampledByDomainId;

  const { skipErrorParams, skipErrorExistsClause } = buildSkipErrorFilter(
    skipErrors,
    skipErrorMessages,
  );

  const stmt = db.prepare(
    `
      SELECT rvs.url, rvs.timestamp, rvs.cdx_id
        FROM resource_version rv
        JOIN resource_version_source rvs ON rvs.url = rv.url AND rvs.timestamp = rv.timestamp
        WHERE rvs.cdx_id = ?
          AND rv.successful_request_id IS NULL
          ${skipErrorExistsClause}
        LIMIT ${RETRY_ENTRIES_PREVIEW_CAP}`,
  );

  for (const domainId of domains.keys()) {
    const sampled = stmt.all(domainId, ...skipErrorParams) as RetryEntry[];
    sampledByDomainId.set(domainId, sampled);
  }

  return sampledByDomainId;
}

function runDownloadPlan(
  db: DB,
  domains: Map<string, string>,
  args: {
    skipErrors: string[];
    skipErrorMessages: string[];
    verbose: boolean;
  },
  pendingTaskCounts: PendingTaskCounts,
): void {
  const sampledByDomain = args.verbose
    ? samplePendingEntries(db, domains, args.skipErrors, args.skipErrorMessages)
    : undefined;
  const summary = Array.from(domains.entries()).map(([domainId, domain]) => ({
    domain,
    pendingCount: pendingTaskCounts.byDomainId.get(domainId)!,
    ...(args.verbose ? { entriesCapped: sampledByDomain!.get(domainId)! } : {}),
  }));
  printDownloadPlanSummary(summary, args.verbose);
}

async function runRetryMode(
  db: DB,
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
  const { skipErrorParams, skipErrorExistsClause } = buildSkipErrorFilter(
    args.skipErrors,
    args.skipErrorMessages,
  );

  const domainIds = Array.from(domains.keys());
  const domainPlaceholders = domainIds.map(() => '?').join(', ');
  const outputFolder = args.output;

  while (true) {
    const pendingEntriesPage = db
      .prepare(
        `
        SELECT rvs.cdx_id, rvs.url, rvs.timestamp, cf.normalized_domain
          FROM resource_version rv
          JOIN resource_version_source rvs ON rvs.url = rv.url AND rvs.timestamp = rv.timestamp
          JOIN cdx_file cf ON cf.id = rvs.cdx_id
          WHERE rvs.cdx_id IN (${domainPlaceholders})
            AND rv.successful_request_id IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM request r
              WHERE r.run_id = ?
                AND r.resource_version_url = rv.url
                AND r.resource_version_timestamp = rv.timestamp
            )
            ${skipErrorExistsClause}
          ORDER BY rvs.cdx_id, rvs.url, rvs.timestamp
          LIMIT ${RETRY_TASK_PAGE_SIZE}`,
      )
      .all(...domainIds, runId, ...skipErrorParams) as RetryEntry[];

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
      cdxId: entry.cdx_id,
      normalizedDomain: entry.normalized_domain,
      outputFolder,
      replayBaseUrl: args.replayBaseUrl,
    }));

    await runDownloads(tasks);
  }
}

async function runSyncMode(
  db: DB,
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

  for (const [cdxId, domain] of domains) {
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
          const newEntries = findNewEntries(db, domain, pageEntries);
          newEntryCount += newEntries.length;
          appendNewEntryPreviewsCapped(newEntriesCapped, newEntries);
        } else {
          const insertedEntries = insertCdxEntries(
            db,
            runId,
            cdxId,
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
  insertRun(db, runId);
  insertRunArgs(db, runId, args);

  const domains = resolveDomains(db, args, runId);
  if (domains.size === 0) {
    console.log('No domains found in database.');
    return;
  }

  // Dry-run: show summaries only, no downloading
  if (args.dryRun) {
    if (!args.retryErrors) {
      await runSyncMode(db, domains, args, runId, console.log);
    }
    const pendingTaskCounts = await countPendingTasks(
      db,
      domains,
      args.skipErrors,
      args.skipErrorMessages,
    );
    if (pendingTaskCounts.total === 0) {
      console.log('No pending entries found.');
      return;
    }
    runDownloadPlan(db, domains, args, pendingTaskCounts);
    return;
  }

  // Live run
  const proxies = loadProxies(
    args.proxyFile,
    args.maxReqPerPeriod!,
    args.periodMs!,
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
          const ok = await downloadEntry(db, task, proxies);
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
      db,
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
    await runRetryMode(db, domains, args, runId, () => true, runDownloads);
  } else {
    // Run sync and download concurrently
    // Seed the bar total with whatever is already pending in the DB
    const initialPending = await countPendingTasks(
      db,
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
      runRetryMode(db, domains, args, runId, () => syncDone, runDownloads),
    ]);
  }

  multiBar.stop();
  console.log(`Complete. succeeded: ${succeeded}, failed: ${failed}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
