import type { DB } from './db';
import type { ParsedCdxEntry } from './cdx';

export type { ParsedCdxEntry };

export function findNewEntries(
  db: DB,
  domain: string,
  entries: ParsedCdxEntry[],
): ParsedCdxEntry[] {
  const stmt = db.prepare<[string, string], { n: number }>(
    `SELECT COUNT(*) AS n
     FROM cdx_entry ce
     JOIN cdx_file cf ON ce.cdx_id = cf.id
     WHERE ce.raw = ?
       AND cf.domain = ?`,
  );

  return entries.filter((entry) => {
    const row = stmt.get(entry.raw, domain);
    return !row || row.n === 0;
  });
}
