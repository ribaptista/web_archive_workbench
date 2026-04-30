import Database from 'better-sqlite3';
import type { Database as DB } from 'better-sqlite3';

export function openDatabase(filePath: string): DB {
  const db = new Database(filePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS run (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS run_args (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL REFERENCES run(id),
      arg_name TEXT NOT NULL,
      arg_value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cdx_file (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES run(id),
      domain TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(domain)
    );

    CREATE TABLE IF NOT EXISTS cdx_entry (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL REFERENCES run(id),
      cdx_id TEXT NOT NULL REFERENCES cdx_file(id),
      line INTEGER NOT NULL,
      url_key TEXT,
      timestamp INTEGER,
      original TEXT,
      parsed_scheme TEXT,
      parsed_domain TEXT,
      normalized_port INTEGER,
      parsed_path_and_query TEXT,
      mimetype TEXT,
      status_code INTEGER,
      digest TEXT,
      length INTEGER,
      raw TEXT NOT NULL,
      is_valid INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(cdx_id, raw)
    );

    CREATE TABLE IF NOT EXISTS tree_node (
      path TEXT PRIMARY KEY,
      level INTEGER NOT NULL,
      UNIQUE(path, level)
    );

    CREATE TABLE IF NOT EXISTS resource (
      url TEXT PRIMARY KEY REFERENCES tree_node(path) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS resource_version (
      url TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      successful_request_id TEXT REFERENCES request(id) ON DELETE SET NULL,

      PRIMARY KEY (url, timestamp),
      FOREIGN KEY (url) REFERENCES resource(url) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS resource_version_source (
      url TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      cdx_id TEXT NOT NULL REFERENCES cdx_file(id) ON DELETE CASCADE,
      FOREIGN KEY (url, timestamp) REFERENCES resource_version(url, timestamp) ON DELETE CASCADE,
      UNIQUE(url, timestamp, cdx_id)
    );

    CREATE TABLE IF NOT EXISTS request (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES run(id) ON DELETE CASCADE,
      resource_version_url TEXT NOT NULL,
      resource_version_timestamp INTEGER NOT NULL,
      status_code INTEGER,
      mimetype TEXT,
      location TEXT,
      location_original TEXT,
      location_timestamp INTEGER,
      body_digest TEXT,
      inferred_gzip INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER,
      proxy_address TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      is_successful INTEGER NOT NULL,

      FOREIGN KEY (resource_version_url, resource_version_timestamp) REFERENCES resource_version(url, timestamp) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS request_errors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id TEXT NOT NULL REFERENCES request(id) ON DELETE CASCADE,
      error_name TEXT,
      error_code TEXT NOT NULL,
      error_message TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS response_header (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id TEXT NOT NULL REFERENCES request(id) ON DELETE CASCADE,
      header_name TEXT NOT NULL,
      header_value TEXT NOT NULL
    );

    -- findNewEntries: WHERE ce.raw = ? (UNIQUE(cdx_id,raw) has cdx_id first, so raw-only lookup needs its own index)
    CREATE INDEX IF NOT EXISTS idx_cdx_entry_raw ON cdx_entry(raw);

    -- runRetryMode: JOIN resource_version_source ON rvs.cdx_id = cf.id
    CREATE INDEX IF NOT EXISTS idx_resource_version_source_cdx_id ON resource_version_source(cdx_id);

    -- runRetryMode: WHERE rv.successful_request_id IS NULL
    CREATE INDEX IF NOT EXISTS idx_resource_version_successful_request_id ON resource_version(successful_request_id);

    -- runRetryMode subquery: JOIN request r ON r.resource_version_url = rv.url AND r.resource_version_timestamp = rv.timestamp
    CREATE INDEX IF NOT EXISTS idx_request_resource_version ON request(resource_version_url, resource_version_timestamp);

    -- runRetryMode subquery: JOIN request_errors re / request r ON r.id = re.request_id
    CREATE INDEX IF NOT EXISTS idx_request_errors_request_id ON request_errors(request_id);

    -- run_search_handler count + search_scan selectPage: JOIN request r WHERE r.mimetype = 'text/html' AND r.location IS NULL;
    -- covering index lets SQLite filter by mimetype + location and read body_digest without a heap lookup
    CREATE INDEX IF NOT EXISTS idx_request_mimetype_location_body_digest ON request(mimetype, location, body_digest);
  `);

  return db;
}

export function insertRun(db: DB, runId: string): void {
  db.prepare(`INSERT INTO run (id) VALUES (?)`).run(runId);
}

export function insertRunArgs(db: DB, runId: string, args: object): void {
  const stmt = db.prepare(
    `INSERT INTO run_args (run_id, arg_name, arg_value) VALUES (?, ?, ?)`,
  );
  const insertAll = db.transaction(() => {
    for (const [name, value] of Object.entries(args)) {
      if (value === undefined) continue;
      const values = Array.isArray(value) ? value : [String(value)];
      for (const v of values) {
        stmt.run(runId, name, v);
      }
    }
  });
  insertAll();
}

export type { DB };
