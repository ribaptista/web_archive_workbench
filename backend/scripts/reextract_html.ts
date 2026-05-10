import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { nestedIdPath } from '../src/id-path';
import { htmlExtractToFiles } from '../src/html';
import type { ExtractOptions } from '../src/html';

const [, , dbPath, basePath] = process.argv;

if (!dbPath || !basePath) {
  console.error('Usage: reextract_html.ts <db-path> <base-path>');
  process.exit(1);
}

const db = new Database(path.resolve(dbPath), { readonly: true });

interface RequestRow {
  body_digest: string;
  encoding: string | null;
}

const assetsDir = path.join(path.resolve(basePath), 'assets');
const SUFFIXES = ['.attrs', '.text', '.comments'] as const;
const PAGE_SIZE = 500;

let done = 0;
let total = 0;
let skipped = 0;
let deleted = 0;
let errors = 0;
let lastDigest = '';

const stmt = db.prepare<[string, number], RequestRow>(
  `SELECT body_digest, encoding FROM request WHERE body_digest IS NOT NULL AND mimetype = 'text/html' AND body_digest > ? ORDER BY body_digest LIMIT ?`,
);

async function main() {
  while (true) {
    const rows = stmt.all(lastDigest, PAGE_SIZE);
    if (rows.length === 0) break;
    lastDigest = rows[rows.length - 1].body_digest;
    console.log(`Processing up to digest ${lastDigest}...`);

    for (const row of rows) {
      if (total % 100 === 0) {
        console.log(
          `  total=${total}, extracted=${done}, skipped=${skipped}, deleted=${deleted}, errors=${errors}`,
        );
      }
      total++;

      const prefix = nestedIdPath(assetsDir, row.body_digest, 2);
      const htmlPath = prefix;

      if (!fs.existsSync(htmlPath)) {
        skipped++;
        continue;
      }

      // Delete existing extracted files before re-extracting
      for (const suffix of SUFFIXES) {
        try {
          fs.unlinkSync(prefix + suffix);
          deleted++;
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
            console.warn(`Could not delete ${prefix + suffix}:`, err);
          }
        }
      }

      try {
        const options: ExtractOptions = row.encoding
          ? { inputEncoding: row.encoding }
          : {};
        await htmlExtractToFiles(htmlPath, prefix, {
          skipTags: [
            'script',
            'style',
            'head',
            'template',
            'meta',
            'link',
            'base',
            'noscript',
            'svg',
            'math',
          ],
          ...options,
        });
        done++;
      } catch (err) {
        errors++;
        console.error(`Error extracting ${row.body_digest}:`, err);
      }
    }
  }

  console.log(
    `Done. extracted=${done}, skipped (no .html)=${skipped}, deleted=${deleted}, errors=${errors}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
