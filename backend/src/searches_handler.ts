import type { Database as DB } from 'better-sqlite3';
import type { Eta } from 'eta';

interface SearchSummaryRow {
  id: number;
  created_at: string;
  status: string;
  file_count: number;
  scanned_file_count: number;
  error_message: string | null;
  match_file_count: number;
}

interface ConditionRow {
  regex: string;
  not_regex_nearby: string | null;
}

interface DomainRow {
  domain: string;
}

const querySearches = (db: DB) =>
  db
    .prepare<[], SearchSummaryRow>(
      `SELECT s.id, s.created_at, s.status, s.file_count, s.scanned_file_count, s.error_message,
              COUNT(DISTINCT sf.context_digest) AS match_file_count
       FROM search s
       LEFT JOIN search_file sf ON sf.search_id = s.id
       GROUP BY s.id
       ORDER BY s.created_at DESC`,
    )
    .all();

const queryConditions = (db: DB) =>
  db.prepare<[number], ConditionRow>(
    `SELECT regex, not_regex_nearby FROM search_condition WHERE search_id = ? ORDER BY id`,
  );

const queryDomains = (db: DB) =>
  db.prepare<[number], DomainRow>(
    `SELECT cf.domain FROM search_domain sd
     JOIN cdx_file cf ON cf.id = sd.cdx_file_id
     WHERE sd.search_id = ? ORDER BY sd.id`,
  );

export function getSearchesData(db: DB) {
  const rows = querySearches(db);
  const getConditions = queryConditions(db);
  const getDomains = queryDomains(db);

  const searches = rows.map((row) => ({
    ...row,
    conditions: getConditions.all(row.id),
    domains: getDomains.all(row.id).map((r) => r.domain),
  }));

  const hasRunning = searches.some(
    (s) => s.status === 'pending' || s.status === 'running',
  );

  return { searches, hasRunning };
}

export function renderSearches(db: DB, eta: Eta): string {
  return (
    eta.render('./searches', getSearchesData(db)) ?? '<h1>Template error</h1>'
  );
}

export function deleteSearch(db: DB, searchId: number): void {
  db.prepare(`DELETE FROM search WHERE id = ?`).run(searchId);
}
