import * as fs from "fs";
import { openDatabase } from "./db";

const DIGEST_REGEX = /(.{43})\.[^.]+$/;

export interface WaybackEntry {
  filePath: string;
  replayUrl: string;
  originalUrl: string;
  timestamp: string;
  cdxEntryId: number;
  bodyDigest: string;
}

export function resolveWaybackEntries(
  fileListPath: string,
  dbPath: string,
): WaybackEntry[] {
  const db = openDatabase(dbPath);

  const stmt = db.prepare<[string], { timestamp: string; original: string; cdx_entry_id: number; body_digest: string }>(`
    SELECT ce.timestamp, ce.original, r.cdx_entry_id, r.body_digest
    FROM request r
    JOIN cdx_entry ce ON r.cdx_entry_id = ce.id
    WHERE r.body_digest = ?
    LIMIT 1
  `);

  const lines = fs
    .readFileSync(fileListPath, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const entries: WaybackEntry[] = [];

  for (const line of lines) {
    const match = line.match(DIGEST_REGEX);
    if (!match) {
      console.error(`no digest found in path: ${line}`);
      continue;
    }

    const digest = match[1];
    const row = stmt.get(digest);

    if (!row) {
      console.error(`no db row found for digest ${digest} (${line})`);
      continue;
    }

    const replayUrl = `https://web.archive.org/web/${row.timestamp}/${row.original}`;
    entries.push({ filePath: line, replayUrl, originalUrl: row.original, timestamp: row.timestamp, cdxEntryId: row.cdx_entry_id, bodyDigest: row.body_digest });
  }

  db.close();
  return entries;
}
