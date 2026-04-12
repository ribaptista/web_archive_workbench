import Database from "better-sqlite3";
import type { Database as DB } from "better-sqlite3";

export function openDatabase(filePath: string): DB {
  const db = new Database(filePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS run (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cdx_file (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES run(id),
      domain TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cdx_entry (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL REFERENCES run(id),
      cdx_id TEXT NOT NULL,
      line INTEGER NOT NULL,
      url_key TEXT NOT NULL,
      timestamp INTEGER,
      original TEXT NOT NULL,
      mimetype TEXT NOT NULL,
      status_code INTEGER,
      digest TEXT NOT NULL,
      length INTEGER,
      raw TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS request (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL REFERENCES run(id),
      cdx_entry_id INTEGER REFERENCES cdx_entry(id),
      url TEXT NOT NULL,
      original TEXT,
      timestamp TEXT,
      attempt INTEGER NOT NULL DEFAULT 0,
      redirect_chain_count INTEGER NOT NULL DEFAULT 0,
      is_terminal INTEGER NOT NULL DEFAULT 0,
      status_code INTEGER,
      body_digest TEXT,
      inferred_gzip INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS request_errors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id INTEGER NOT NULL REFERENCES request(id),
      error_code TEXT NOT NULL,
      error_message TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS response_header (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id INTEGER NOT NULL REFERENCES request(id),
      header_name TEXT NOT NULL,
      header_value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_request_cover
      ON request(cdx_entry_id, is_terminal, id);
    CREATE INDEX IF NOT EXISTS idx_request_errors_request_id
      ON request_errors(request_id);
    CREATE INDEX IF NOT EXISTS idx_request_cdx_entry_terminal
      ON request(cdx_entry_id, is_terminal);
    CREATE INDEX IF NOT EXISTS idx_cdx_entry_cdx_id
      ON cdx_entry(cdx_id);
    CREATE INDEX IF NOT EXISTS idx_request_body_digest_cdx
      ON request(body_digest, cdx_entry_id);
  `);

  return db;
}

export function insertRun(db: DB, runId: string): void {
  db.prepare(`INSERT INTO run (id) VALUES (?)`).run(runId);
}

export type { DB };
