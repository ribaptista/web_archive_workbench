import path from 'path';
import pLimit from 'p-limit';
import { v4 as uuidv4 } from 'uuid';
import cliProgress from 'cli-progress';
import { parseArgs } from './cli';
import { openDatabase, insertRun, insertRunArgs } from './db';
import { fetchCdxRows, insertCdxEntries, getOrCreateCdxFile } from './cdx';
import { findNewEntries, type ParsedCdxEntry } from './sync';
import { loadProxies } from './proxy';
import { downloadEntry, type DownloadTask } from './downloader';

import type { Database as DB } from 'better-sqlite3';

function resolveDomains(
  db: DB,
  args: { all: boolean; domain: string[] },
): string[] {
  if (args.all) {
    const rows = db
      .prepare(`SELECT domain FROM cdx_file ORDER BY domain`)
      .all() as { domain: string }[];
    return rows.map((r) => r.domain);
  }
  return args.domain;
}

function printRetryDryRunSummary(
  summary: Array<{ domain: string; entries: RetryEntry[] }>,
  verbose: boolean,
): void {
  console.log('\n--- Dry-run Summary (retry mode) ---');
  for (const s of summary) {
    console.log(`  ${s.domain}: ${s.entries.length} entries to retry`);
    if (verbose && s.entries.length > 0) {
      for (const e of s.entries) {
        console.log(`    [${e.timestamp}] ${e.url}`);
      }
    }
  }
}

function printSyncDryRunSummary(
  summary: Array<{ domain: string; newEntries: ParsedCdxEntry[] }>,
  verbose: boolean,
): void {
  console.log('\n--- Dry-run Summary ---');
  for (const s of summary) {
    console.log(`  ${s.domain}: ${s.newEntries.length} new entries`);
    if (verbose && s.newEntries.length > 0) {
      for (const e of s.newEntries) {
        console.log(
          `    [${e.timestamp ?? '-'}] ${e.original} (${e.mimetype}, status=${e.statusCode ?? '-'}, digest=${e.digest}, length=${e.length ?? '-'})`,
        );
      }
    }
  }
}

type RetryEntry = {
  url: string;
  timestamp: number;
  cdx_id: string;
};

async function runRetryMode(
  db: DB,
  domains: string[],
  args: {
    skipErrors: string[];
    skipErrorMessages: string[];
    dryRun: boolean;
    verbose: boolean;
    output: string;
  },
  runId: string,
  runDownloads: (tasks: DownloadTask[]) => Promise<void>,
): Promise<void> {
  const summary: Array<{ domain: string; entries: RetryEntry[] }> = [];
  const allTasks: DownloadTask[] = [];

  const skipErrorFilters = [
    ...args.skipErrors.map(() => `re.error_code = ?`),
    ...args.skipErrorMessages.map(() => `re.error_message LIKE ?`),
  ].join(' OR ');
  const skipErrorParams = [...args.skipErrors, ...args.skipErrorMessages];
  const skipErrorExistsClause = skipErrorFilters.length
    ? `AND NOT EXISTS (
        SELECT 1 FROM request_errors re
        JOIN request r ON r.id = re.request_id
        WHERE r.resource_version_url = rv.url
          AND r.resource_version_timestamp = rv.timestamp
          AND (${skipErrorFilters})
      )`
    : '';

  for (const domain of domains) {
    console.log(`\nDomain: ${domain}`);

    const pendingEntries = db
      .prepare(
        `
        SELECT rv.url, rv.timestamp, rvs.cdx_id
          FROM resource_version rv
          JOIN resource_version_source rvs ON rvs.url = rv.url AND rvs.timestamp = rv.timestamp
          JOIN cdx_file cf ON rvs.cdx_id = cf.id
          WHERE cf.domain = ?
            AND rv.successful_request_id IS NULL
            ${skipErrorExistsClause}`,
      )
      .all(domain, ...skipErrorParams) as RetryEntry[];

    console.log(`  ${pendingEntries.length} entries to retry.`);
    summary.push({ domain, entries: pendingEntries });

    const outputFolder = args.output;
    for (const entry of pendingEntries) {
      allTasks.push({
        runId,
        timestamp: entry.timestamp,
        original: entry.url,
        cdxId: entry.cdx_id,
        outputFolder,
      });
    }
  }

  if (args.dryRun) {
    printRetryDryRunSummary(summary, args.verbose);
  } else {
    if (allTasks.length === 0) {
      console.log('No incomplete entries found.');
      return;
    }
    await runDownloads(allTasks);
  }
}

async function runSyncMode(
  db: DB,
  domains: string[],
  args: { dryRun: boolean; verbose: boolean; output: string },
  runId: string,
): Promise<void> {
  const summary: Array<{
    domain: string;
    cdxId: string;
    allEntries: ParsedCdxEntry[];
    newEntries: ParsedCdxEntry[];
  }> = [];

  for (const domain of domains) {
    console.log(`\nDomain: ${domain}`);

    const cdxId = getOrCreateCdxFile(db, domain, runId);

    let allEntries: ParsedCdxEntry[];
    try {
      allEntries = await fetchCdxRows(domain);
    } catch (err) {
      console.error(`  Error fetching CDX: ${err}`);
      throw err;
    }

    if (allEntries.length === 0) {
      console.log('  No CDX entries found.');
      continue;
    }

    const newEntries = findNewEntries(db, domain, allEntries);
    summary.push({ domain, cdxId, allEntries, newEntries });
  }

  printSyncDryRunSummary(
    summary.map(({ domain, newEntries }) => ({ domain, newEntries })),
    args.verbose,
  );

  if (args.dryRun) return;

  for (const { cdxId, allEntries } of summary) {
    insertCdxEntries(db, runId, cdxId, allEntries);
  }
  const totalNew = summary.reduce((sum, s) => sum + s.newEntries.length, 0);
  console.log(
    `\nSynced ${totalNew} new CDX entries across ${summary.length} domain(s).`,
  );
}

async function main() {
  const args = parseArgs();
  const db = openDatabase(args.db);

  const domains = resolveDomains(db, args);
  if (domains.length === 0) {
    console.log('No domains found in database.');
    return;
  }

  const runId = uuidv4();
  insertRun(db, runId);
  insertRunArgs(db, runId, args);

  const proxies = args.dryRun
    ? []
    : loadProxies(args.proxyFile, args.maxReqPerPeriod!, args.periodMs!);

  const limit = pLimit(args.concurrency);

  const runDownloads = async (tasks: DownloadTask[]): Promise<void> => {
    const bar = new cliProgress.SingleBar(
      {
        format:
          'Progress |{bar}| {value}/{total} | succeeded: {succeeded} | failed: {failed}',
      },
      cliProgress.Presets.shades_classic,
    );
    bar.start(tasks.length, 0, { succeeded: 0, failed: 0 });
    let succeeded = 0;
    let failed = 0;

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

    bar.stop();
    console.log(`Complete. succeeded: ${succeeded}, failed: ${failed}`);
  };

  if (!args.retryErrors) {
    await runSyncMode(db, domains, args, runId);
  }
  await runRetryMode(db, domains, args, runId, runDownloads);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
