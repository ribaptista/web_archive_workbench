import * as fs from 'fs';
import { openDatabase } from './db';

const REQUEST_ID_REGEX = /_(\d+)_(.{43})\.[^.]+$/;

export interface WaybackEntry {
  requestId: number;
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

  const stmt = db.prepare<
    [number],
    {
      timestamp: string;
      original: string;
      cdx_entry_id: number;
      body_digest: string;
    }
  >(`
    SELECT ce.timestamp, ce.original, r.cdx_entry_id, r.body_digest
    FROM request r
    JOIN cdx_entry ce ON r.cdx_entry_id = ce.id
    WHERE r.id = ?
  `);

  const lines = fs
    .readFileSync(fileListPath, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const entries: WaybackEntry[] = [];

  for (const line of lines) {
    const match = line.match(REQUEST_ID_REGEX);
    if (!match) {
      console.error(`no request id found in path: ${line}`);
      continue;
    }

    const requestId = Number(match[1]);
    const digest = match[2];
    const row = stmt.get(requestId);

    if (!row) {
      console.error(`no db row found for request id ${requestId} (${line})`);
      continue;
    }

    const replayUrl = `https://web.archive.org/web/${row.timestamp}/${row.original}`;
    entries.push({
      requestId,
      filePath: line,
      replayUrl,
      originalUrl: row.original,
      timestamp: row.timestamp,
      cdxEntryId: row.cdx_entry_id,
      bodyDigest: row.body_digest,
    });
  }

  db.close();
  return entries;
}
