import type { Database as DB } from 'better-sqlite3';

interface RunRow {
  id: string;
  created_at: string;
  cdx_entry_count: number;
  request_total: number;
  request_successful: number;
  request_errored: number;
}

interface RunArgRow {
  arg_name: string;
  arg_value: string;
}

interface DomainStatsRow {
  domain: string;
  requested: number;
  downloaded: number;
  errored: number;
}

interface ErrorByTypeRow {
  domain: string;
  error_name: string | null;
  error_code: string;
  count: number;
}

export interface RunStats {
  id: string;
  created_at: string;
  args: RunArgRow[];
  new_cdx_entry_count: number;
  requested_total: number;
  requested_by_domain: { domain: string; count: number }[];
  downloaded_total: number;
  downloaded_by_domain: { domain: string; count: number }[];
  errors_total: number;
  errors_by_domain: { domain: string; count: number }[];
  errors_by_type: ErrorByTypeRow[];
}

export function getRunsData(db: DB): RunStats[] {
  const runs = db
    .prepare<[], RunRow>(
      `SELECT id, created_at, cdx_entry_count, request_total, request_successful, request_errored
       FROM run ORDER BY created_at DESC`,
    )
    .all();

  const argStmt = db.prepare<[string], RunArgRow>(
    `SELECT arg_name, arg_value FROM run_args WHERE run_id = ? ORDER BY id`,
  );

  const domainStatsStmt = db.prepare<[string], DomainStatsRow>(`
    SELECT cf.domain, rds.requested, rds.downloaded, rds.errored
    FROM run_domain_stats rds
    JOIN cdx_file cf ON cf.id = rds.cdx_id
    WHERE rds.run_id = ?
    ORDER BY cf.domain
  `);

  const errorTypeStatsStmt = db.prepare<[string], ErrorByTypeRow>(`
    SELECT cf.domain, NULLIF(rets.error_name, '') AS error_name, rets.error_code, rets.count
    FROM run_error_type_stats rets
    JOIN cdx_file cf ON cf.id = rets.cdx_id
    WHERE rets.run_id = ?
    ORDER BY cf.domain, rets.count DESC
  `);

  return runs.map((run) => {
    const domainStats = domainStatsStmt.all(run.id);
    return {
      id: run.id,
      created_at: run.created_at,
      args: argStmt.all(run.id),
      new_cdx_entry_count: run.cdx_entry_count,
      requested_total: run.request_total,
      requested_by_domain: domainStats.map((r) => ({
        domain: r.domain,
        count: r.requested,
      })),
      downloaded_total: run.request_successful,
      downloaded_by_domain: domainStats.map((r) => ({
        domain: r.domain,
        count: r.downloaded,
      })),
      errors_total: run.request_errored,
      errors_by_domain: domainStats.map((r) => ({
        domain: r.domain,
        count: r.errored,
      })),
      errors_by_type: errorTypeStatsStmt.all(run.id),
    };
  });
}
