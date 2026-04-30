import path from 'path';
import { Worker } from 'worker_threads';
import type { Database as DB } from 'better-sqlite3';
import type { SearchCondition } from './file_search';
import { PAGE_SIZE } from './search_scan';
import type { SearchScanRequest, SearchScanResponse } from './search_scan';

export interface SearchConditionInput {
  regex: RegExp;
  notRegexNearby?: RegExp;
}

export interface RunSearchOptions {
  db: DB;
  baseFolder: string;
  maxWorkers: number;
  contextSize: number;
  cdxFileIds: string[];
}

export function ensureAdminTables(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS search (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      char_encoding TEXT NOT NULL,
      status TEXT NOT NULL,
      file_count INTEGER NOT NULL,
      scanned_file_count INTEGER NOT NULL,
      error_name TEXT,
      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS search_condition (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      search_id INTEGER NOT NULL REFERENCES search(id) ON DELETE CASCADE,
      regex TEXT NOT NULL,
      not_regex_nearby TEXT,
      context_size INTEGER NOT NULL DEFAULT 64
    );

    CREATE TABLE IF NOT EXISTS search_file (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      search_id INTEGER NOT NULL REFERENCES search(id) ON DELETE CASCADE,
      request_id TEXT NOT NULL REFERENCES request(id) ON DELETE CASCADE,
      match_count INTEGER NOT NULL DEFAULT 0,
      context_digest TEXT,
      error_name TEXT,
      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS search_match (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      search_file_id INTEGER NOT NULL REFERENCES search_file(id) ON DELETE CASCADE,
      search_condition_id INTEGER NOT NULL REFERENCES search_condition(id) ON DELETE CASCADE,
      match_offset INTEGER NOT NULL,
      match_length INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS search_domain (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      search_id INTEGER NOT NULL REFERENCES search(id) ON DELETE CASCADE,
      cdx_file_id TEXT NOT NULL REFERENCES cdx_file(id)
    );

    CREATE TABLE IF NOT EXISTS reaction_type (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      emoji TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reaction (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reaction_type_id INTEGER NOT NULL REFERENCES reaction_type(id) ON DELETE CASCADE,
      body_digest TEXT NOT NULL,
      UNIQUE(reaction_type_id, body_digest)
    );

    -- searches_handler: LEFT JOIN search_file sf ON sf.search_id = s.id
    CREATE INDEX IF NOT EXISTS idx_search_file_search_id ON search_file(search_id);

    -- searches_handler: SELECT ... FROM search_condition WHERE search_id = ? ORDER BY id
    CREATE INDEX IF NOT EXISTS idx_search_condition_search_id ON search_condition(search_id);

    -- searches_handler: SELECT ... FROM search_domain sd WHERE sd.search_id = ? ORDER BY sd.id
    CREATE INDEX IF NOT EXISTS idx_search_domain_search_id ON search_domain(search_id);
  `);

  db.prepare(
    `INSERT OR IGNORE INTO reaction_type (id, label, emoji) VALUES (1, 'Like', '❤️'), (2, 'Review later', '⏳')`,
  ).run();
}

function insertSearchRow(
  db: DB,
  charEncoding: string,
  fileCount: number,
): number {
  const result = db
    .prepare<
      [string, number]
    >(`INSERT INTO search (char_encoding, status, file_count, scanned_file_count) VALUES (?, 'pending', ?, 0)`)
    .run(charEncoding, fileCount);
  return result.lastInsertRowid as number;
}

function fetchCdxFiles(db: DB, cdxFileIds: string[]): Map<string, string> {
  const cdxIdToDomain = new Map<string, string>();

  if (cdxFileIds.length > 0) {
    const placeholders = cdxFileIds.map(() => '?').join(', ');
    const rows = db
      .prepare<
        string[],
        { id: string; domain: string }
      >(`SELECT id, domain FROM cdx_file WHERE id IN (${placeholders})`)
      .all(...cdxFileIds);
    for (const row of rows) {
      cdxIdToDomain.set(row.id, row.domain);
    }
  } else {
    const rows = db
      .prepare<
        [],
        { id: string; domain: string }
      >(`SELECT id, domain FROM cdx_file`)
      .all();
    for (const row of rows) {
      cdxIdToDomain.set(row.id, row.domain);
    }
  }

  return cdxIdToDomain;
}

function insertSearchDomains(
  db: DB,
  searchId: number,
  cdxFileIds: string[],
): void {
  if (cdxFileIds.length === 0) return;
  const insertDomain = db.prepare<[number, string]>(
    `INSERT INTO search_domain (search_id, cdx_file_id) VALUES (?, ?)`,
  );
  db.transaction(() => {
    for (const cdxFileId of cdxFileIds) {
      insertDomain.run(searchId, cdxFileId);
    }
  })();
}

function insertSearchConditions(
  db: DB,
  searchId: number,
  conditionInputs: SearchConditionInput[],
  contextSize: number,
): SearchCondition[] {
  const insertCondition = db.prepare<[number, string, string | null, number]>(
    `INSERT INTO search_condition (search_id, regex, not_regex_nearby, context_size) VALUES (?, ?, ?, ?)`,
  );

  const conditions: SearchCondition[] = [];
  for (const input of conditionInputs) {
    const notRegex = input.notRegexNearby?.source ?? null;
    const condResult = insertCondition.run(
      searchId,
      input.regex.source,
      notRegex,
      contextSize,
    );
    conditions.push({
      id: condResult.lastInsertRowid as number,
      regex: input.regex,
      notRegexNearby: input.notRegexNearby ?? null,
      contextSize,
    });
  }
  return conditions;
}

export async function runSearch(
  conditionInputs: SearchConditionInput[],
  charEncoding: string,
  opts: RunSearchOptions,
): Promise<number> {
  const {
    db,
    baseFolder,
    maxWorkers,
    contextSize,
    cdxFileIds: filterIds,
  } = opts;

  const cdxIdToDomain = fetchCdxFiles(db, filterIds);
  const cdxFileIds = filterIds.length > 0 ? [...cdxIdToDomain.keys()] : [];

  const domainClause =
    cdxFileIds.length > 0
      ? `AND EXISTS (
        SELECT 1 FROM resource_version_source rvs
        WHERE rvs.url = rv.url AND rvs.timestamp = rv.timestamp
        AND rvs.cdx_id IN (${cdxFileIds.map(() => '?').join(', ')})
      )`
      : '';

  const countStmt = db.prepare<string[], { count: number }>(`
    SELECT COUNT(*) as count
    FROM resource_version rv
    JOIN request r ON r.id = rv.successful_request_id
    WHERE rv.successful_request_id IS NOT NULL
      AND r.mimetype = 'text/html'
      AND r.location IS NULL
    ${domainClause}
  `);
  const countRow = countStmt.get(...cdxFileIds);
  const total = countRow?.count ?? 0;

  const searchId = insertSearchRow(db, charEncoding, total);
  insertSearchDomains(db, searchId, [...cdxIdToDomain.keys()]);
  const conditions = insertSearchConditions(
    db,
    searchId,
    conditionInputs,
    contextSize,
  );

  const totalPages = Math.ceil(total / PAGE_SIZE);
  console.log(
    `[search ${searchId}] Found ${total} HTML candidates (${totalPages} pages)`,
  );

  const scanRequest: SearchScanRequest = {
    dbPath: db.name,
    searchId,
    baseFolder,
    charEncoding,
    maxWorkers,
    cdxFileIds,
    cdxIdToDomain: [...cdxIdToDomain.entries()],
    conditions,
    domainClause,
    totalPages,
  };

  const updateStatus = db.prepare<[string, number]>(
    `UPDATE search SET status = ? WHERE id = ?`,
  );
  const updateError = db.prepare<[string, number]>(
    `UPDATE search SET status = 'error', error_message = ? WHERE id = ?`,
  );

  const workerPromise = new Promise<SearchScanResponse>((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'search_scan.ts'), {
      execArgv: [...process.execArgv],
    });
    worker.once('message', (msg: SearchScanResponse) => resolve(msg));
    worker.once('error', reject);
    worker.postMessage(scanRequest);
  });

  workerPromise
    .then((response) => {
      if ('error' in response) {
        updateError.run(response.error, searchId);
      } else {
        updateStatus.run('done', searchId);
      }
    })
    .catch((err: unknown) => {
      updateError.run(String(err), searchId);
    });

  console.log(`[search ${searchId}] Scan started in background`);
  return searchId;
}
