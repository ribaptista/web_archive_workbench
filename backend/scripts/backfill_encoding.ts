/**
 * Backfill encoding / encoding_source / chardet_confidence for existing request rows.
 *
 * Usage:
 *   npx tsx scripts/backfill_encoding.ts <db-path> <assets-folder>
 *
 * The script reads every request row where mimetype = 'text/html',
 * location IS NULL, body_digest IS NOT NULL, and encoding IS NULL,
 * reads the corresponding asset file, runs detectEncoding (using the
 * stored response headers), and writes the result back.
 */

import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { buildAssetPath } from '../src/request/paths';
import { detectEncoding } from '../src/storage/encoding';

async function main() {
  const [dbPath, assetsFolder] = process.argv.slice(2);
  if (!dbPath || !assetsFolder) {
    console.error(
      'Usage: npx tsx scripts/backfill_encoding.ts <db-path> <assets-folder>',
    );
    process.exit(1);
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  const PAGE_SIZE = 1000;

  const countRow = db
    .prepare(
      `SELECT COUNT(*) AS n FROM request
       WHERE mimetype = 'text/html'
         AND body_digest IS NOT NULL
         AND encoding IS NULL`,
    )
    .get() as { n: number };
  console.log(`Found ${countRow.n} rows to backfill.`);

  const getPage = db.prepare(
    `SELECT id, body_digest FROM request
     WHERE mimetype = 'text/html'
       AND body_digest IS NOT NULL
       AND encoding IS NULL
     ORDER BY seq
     LIMIT ?`,
  );

  const getHeaders = db.prepare(
    `SELECT header_name, header_value FROM response_header WHERE request_id = ?`,
  );
  const updateRequest = db.prepare(
    `UPDATE request SET encoding = ?, encoding_source = ?, chardet_confidence = ? WHERE id = ?`,
  );

  let done = 0;
  let skipped = 0;
  let errors = 0;

  while (true) {
    const rows = getPage.all(PAGE_SIZE) as {
      id: string;
      body_digest: string;
    }[];
    if (rows.length === 0) break;

    for (const row of rows) {
      const assetPath = buildAssetPath(assetsFolder, row.body_digest);

      let html: Buffer;
      try {
        html = await fs.promises.readFile(assetPath);
      } catch {
        console.error(
          `Asset file not found for request ${row.id} (body_digest: ${row.body_digest}), skipping`,
        );
        skipped++;
        continue;
      }

      const headerRows = getHeaders.all(row.id) as {
        header_name: string;
        header_value: string;
      }[];
      const headers: Record<string, string> = {};
      for (const h of headerRows) {
        headers[h.header_name.toLowerCase()] = h.header_value;
      }

      try {
        const result = detectEncoding(headers['content-type'], html);
        updateRequest.run(
          result?.encoding ?? null,
          result?.source ?? null,
          result?.chardetConfidence ?? null,
          row.id,
        );
        done++;
      } catch (e) {
        console.error(
          `Error processing request ${row.id}: ${(e as Error).message}`,
        );
        errors++;
      }

      if ((done + skipped + errors) % 50 === 0) {
        console.log(
          `Progress: ${done} updated, ${skipped} skipped (no file), ${errors} errors`,
        );
      }
    }
  }

  console.log(
    `Done: ${done} updated, ${skipped} skipped (no file), ${errors} errors`,
  );
  db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
