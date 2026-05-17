import path from 'path';
import Database from 'better-sqlite3';
import type { Database as DB } from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

// NULL-safe equality operator for use in prepared statement WHERE clauses.
// SQLite:    `col IS ?`                   — works for both NULL and non-NULL values.
// PostgreSQL: `col IS NOT DISTINCT FROM $n` — replace if switching databases;
//             plain `col = $n` does NOT match NULL = NULL in postgres.
export const SQL_NULL_SAFE_EQ = 'IS';

export const DB_FILENAME = 'archive.db';

const MIGRATIONS_FOLDER = path.join(__dirname, 'migrations');

export function openDatabase(filePath: string): DB {
  const sqlite = new Database(filePath, {
    // verbose: console.log,
  });
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  migrate(drizzle(sqlite), { migrationsFolder: MIGRATIONS_FOLDER });

  return sqlite;
}

export type { DB };
