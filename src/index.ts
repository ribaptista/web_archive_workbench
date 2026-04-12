import path from "path";
import pLimit from "p-limit";
import { v4 as uuidv4 } from "uuid";
import cliProgress from "cli-progress";
import { parseArgs } from "./cli";
import { openDatabase, insertRun } from "./db";
import { fetchAndStoreCdx } from "./cdx";
import { loadProxies } from "./proxy";
import { downloadEntry, type DownloadTask } from "./downloader";
import type { Database as DB } from "better-sqlite3";

async function fetchDomainTasks(
  db: DB,
  domain: string,
  outputBase: string,
  runId: string,
): Promise<DownloadTask[]> {
  const cdxId = uuidv4();
  const outputFolder = path.join(outputBase, domain);

  console.log(`\nDomain: ${domain}`);
  console.log(`  run_id: ${runId}, cdx_id: ${cdxId}`);
  console.log(`  Output folder: ${outputFolder}`);

  await fetchAndStoreCdx(db, domain, runId, cdxId);

  const entries = db
    .prepare(`SELECT id, line, timestamp, original, mimetype FROM cdx_entry WHERE cdx_id = ?`)
    .all(cdxId) as Array<{
    id: number;
    line: number;
    timestamp: number | null;
    original: string;
    mimetype: string;
  }>;

  console.log(`  ${entries.length} CDX entries queued.`);

  return entries.map((entry): DownloadTask => ({
    cdxEntryId: entry.id,
    runId,
    line: entry.line,
    timestamp: entry.timestamp,
    original: entry.original,
    mimetype: entry.mimetype,
    outputFolder,
  }));
}

async function main() {
  const args = parseArgs();

  // Build output folder: append domain (if available) or run_id
  let outputFolder = args.output;

  const runId = uuidv4();

  const db = openDatabase(args.db);
  insertRun(db, runId);

  const proxies = loadProxies(
    args.proxyFile,
    args.maxReqPerSecond,
    args.maxReqPerMinute
  );

  const limit = pLimit(args.concurrency);

  const runDownloads = async (tasks: DownloadTask[]): Promise<void> => {
    const bar = new cliProgress.SingleBar(
      { format: "Progress |{bar}| {value}/{total} | succeeded: {succeeded} | failed: {failed}" },
      cliProgress.Presets.shades_classic,
    );
    bar.start(tasks.length, 0, { succeeded: 0, failed: 0 });
    let succeeded = 0;
    let failed = 0;

    await Promise.all(
      tasks.map((task) =>
        limit(async () => {
          const ok = await downloadEntry(db, task, proxies);
          if (ok) succeeded++; else failed++;
          bar.increment({ succeeded, failed });
        }),
      ),
    );

    bar.stop();
    console.log(`Complete. succeeded: ${succeeded}, failed: ${failed}`);
  };

  // ── MODE: retry-errors ─────────────────────────────────────────────────────
  if (args.retryErrors.length > 0) {
    const allTasks: DownloadTask[] = [];

    for (const retryCdxId of args.retryErrors) {
      console.log(`Retrying incomplete entries for cdx_id: ${retryCdxId}`);

      const cdxFileRow = db
        .prepare(`SELECT domain FROM cdx_file WHERE id = ? LIMIT 1`)
        .get(retryCdxId) as { domain: string } | undefined;

      if (!cdxFileRow) {
        console.error(`No cdx_file record found for cdx_id: ${retryCdxId}`);
        process.exit(1);
      }

      const folder = path.join(args.output, cdxFileRow.domain);

      const pendingEntries = db
        .prepare(
          `SELECT e.id, e.line, e.timestamp, e.original, e.mimetype
           FROM cdx_entry e
           WHERE e.cdx_id = ?
             AND NOT EXISTS (
               SELECT 1 FROM request r
               WHERE r.cdx_entry_id = e.id
                 AND r.is_terminal = 1
                 AND NOT EXISTS (SELECT 1 FROM request_errors re WHERE re.request_id = r.id)
             )`
        )
        .all(retryCdxId) as Array<{
        id: number;
        line: number;
        timestamp: number | null;
        original: string;
        mimetype: string;
      }>;

      if (pendingEntries.length === 0) {
        console.log(`  No incomplete entries for ${retryCdxId}.`);
        continue;
      }

      console.log(`  ${pendingEntries.length} entr(ies)`);

      for (const entry of pendingEntries) {
        allTasks.push({
          cdxEntryId: entry.id,
          runId,
          line: entry.line,
          timestamp: entry.timestamp,
          original: entry.original,
          mimetype: entry.mimetype,
          outputFolder: folder,
        });
      }
    }

    if (allTasks.length === 0) {
      console.log("No incomplete entries found.");
      return;
    }

    await runDownloads(allTasks);
    return;
  }

  // ── MODE: cdx-id supplied (skip fetch) ────────────────────────────────────
  let cdxId: string;

  if (args.cdxId) {
    cdxId = args.cdxId;

    // Look up domain from existing cdx_file row
    const cdxFileRow = db
      .prepare(`SELECT domain FROM cdx_file WHERE id = ?`)
      .get(cdxId) as { domain: string } | undefined;

    if (!cdxFileRow) {
      console.error(`No cdx_file record found for cdx_id: ${cdxId}`);
      process.exit(1);
    }

    outputFolder = path.join(args.output, cdxFileRow.domain);
    console.log(`Using existing CDX ID: ${cdxId}, run_id: ${runId}`);
  } else {
    // ── MODE: fresh download (one or more domains) ──────────────────────────
    if (args.domains.length === 0) {
      console.error("--domains is required when not using --cdx-id or --retry-errors");
      process.exit(1);
    }

    const allTasks: DownloadTask[] = [];

    for (const domain of args.domains) {
      const tasks = await fetchDomainTasks(db, domain, args.output, runId);
      allTasks.push(...tasks);
    }

    console.log(`\nDownloading ${allTasks.length} total CDX entries...`);
    await runDownloads(allTasks);
    return;
  }

  // ── Download entries ───────────────────────────────────────────────────────
  const entries = db
    .prepare(
      `SELECT id, run_id, cdx_id, line, url_key, timestamp, original, mimetype, status_code, digest, length
       FROM cdx_entry
       WHERE cdx_id = ?`
    )
    .all(cdxId) as Array<{
    id: number;
    run_id: string;
    cdx_id: string;
    line: number;
    url_key: string;
    timestamp: number | null;
    original: string;
    mimetype: string;
    status_code: number | null;
    digest: string;
    length: number | null;
  }>;

  console.log(`Downloading ${entries.length} CDX entries...`);

  const tasks = entries.map((entry): DownloadTask => ({
    cdxEntryId: entry.id,
    runId,
    line: entry.line,
    timestamp: entry.timestamp,
    original: entry.original,
    mimetype: entry.mimetype,
    outputFolder,
  }));

  await runDownloads(tasks);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
