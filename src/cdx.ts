import { fetch } from "undici";
import type { DB } from "./db";

export interface CdxEntry {
  id?: number;
  runId: string;
  cdxId: string;
  line: number;
  urlKey: string;
  timestamp: number | null;
  original: string;
  mimetype: string;
  statusCode: number | null;
  digest: string;
  length: number | null;
  raw: string;
}

export async function fetchAndStoreCdx(
  db: DB,
  domain: string,
  runId: string,
  cdxId: string
): Promise<void> {
  const url = `http://web.archive.org/cdx/search/cdx?matchType=domain&output=json&url=${encodeURIComponent(domain)}`;

  console.log(`Fetching CDX from: ${url}`);

  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  } catch (err) {
    console.error("Failed to fetch CDX file:", err);
    process.exit(1);
  }

  if (!response.ok) {
    console.error(`CDX fetch failed with status ${response.status}`);
    process.exit(1);
  }

  let rows: string[][];
  try {
    rows = (await response.json()) as string[][];
  } catch (err) {
    console.error("Failed to parse CDX JSON:", err);
    process.exit(1);
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    console.error("CDX response is empty or invalid");
    process.exit(1);
  }

  // Insert cdx_file row
  const insertFile = db.prepare(
    `INSERT INTO cdx_file (id, run_id, domain) VALUES (?, ?, ?)`
  );
  insertFile.run(cdxId, runId, domain);

  // Skip header row (index 0), insert entries
  const insertEntry = db.prepare(`
    INSERT INTO cdx_entry (run_id, cdx_id, line, url_key, timestamp, original, mimetype, status_code, digest, length, raw)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((entries: string[][]) => {
    for (let i = 1; i < entries.length; i++) {
      const tuple = entries[i];
      if (!Array.isArray(tuple) || tuple.length < 7) {
        console.error(`Invalid CDX entry at line ${i}: ${JSON.stringify(tuple)}`);
        process.exit(1);
      }

      const [urlKey, timestampStr, original, mimetype, statusCodeStr, digest, lengthStr] = tuple;

      const _ts = parseInt(timestampStr);
      const timestamp = isNaN(_ts) ? null : _ts;
      const _sc = parseInt(statusCodeStr);
      const statusCode = isNaN(_sc) ? null : _sc;
      const _len = parseInt(lengthStr);
      const length = isNaN(_len) ? null : _len;

      insertEntry.run(
        runId,
        cdxId,
        i, // line number (1-based, header is 0)
        urlKey,
        timestamp,
        original,
        mimetype,
        statusCode,
        digest,
        length,
        JSON.stringify(tuple)
      );
    }
  });

  insertMany(rows);
  console.log(`Stored ${rows.length - 1} CDX entries for CDX ID: ${cdxId}`);
}
