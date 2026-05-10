import type { Database as DB } from 'better-sqlite3';

interface RunRow {
  id: string;
  created_at: string;
}

interface RunArgRow {
  arg_name: string;
  arg_value: string;
}

interface DomainByIdRow {
  domain: string;
}

interface DownloadedByDomainRow {
  domain: string;
  count: number;
}

interface CdxIdCountRow {
  cdx_id: string;
  count: number;
}

interface ErrorByDomainRow {
  domain: string;
  count: number;
}

interface ErrorByTypeRow {
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
  requested_by_domain: DownloadedByDomainRow[];
  downloaded_total: number;
  downloaded_by_domain: DownloadedByDomainRow[];
  errors_total: number;
  errors_by_domain: ErrorByDomainRow[];
  errors_by_type: ErrorByTypeRow[];
}

const cdxDomainCache = new Map<string, string | null>();

function mapCdxCountsToDomain(
  rows: CdxIdCountRow[],
  resolveDomain: (cdxId: string) => string,
): DownloadedByDomainRow[] {
  return rows
    .map((row) => ({
      domain: resolveDomain(row.cdx_id),
      count: row.count,
    }))
    .sort((a, b) => a.domain.localeCompare(b.domain));
}

export function getRunsData(db: DB): RunStats[] {
  const runs = db
    .prepare<
      [],
      RunRow
    >(`SELECT id, created_at FROM run ORDER BY created_at DESC`)
    .all();

  const argStmt = db.prepare<[string], RunArgRow>(
    `SELECT arg_name, arg_value FROM run_args WHERE run_id = ? ORDER BY id`,
  );

  const cdxDomainByIdStmt = db.prepare<[string], DomainByIdRow>(
    `SELECT domain FROM cdx_file WHERE id = ?`,
  );

  const cdxCountStmt = db.prepare<[string], { count: number }>(
    `SELECT COUNT(*) AS count FROM cdx_entry WHERE run_id = ?`,
  );

  const requestedTotalStmt = db.prepare<[string], { count: number }>(
    `SELECT COUNT(*) AS count FROM request WHERE run_id = ?`,
  );

  const requestedByDomainStmt = db.prepare<[string], CdxIdCountRow>(
    `SELECT rvs.cdx_id, COUNT(*) AS count
     FROM request r
     INNER JOIN resource_version_source rvs
       ON rvs.url = r.resource_version_url AND rvs.timestamp = r.resource_version_timestamp
     WHERE r.run_id = ?
     GROUP BY rvs.cdx_id`,
  );

  const countsBySuccessStmt = db.prepare<
    [string],
    { is_successful: number; count: number }
  >(
    `SELECT is_successful, COUNT(*) AS count
     FROM request
     WHERE run_id = ?
     GROUP BY is_successful`,
  );

  const downloadedByDomainStmt = db.prepare<[string], CdxIdCountRow>(
    `SELECT rvs.cdx_id, COUNT(*) AS count
     FROM request r
     INNER JOIN resource_version_source rvs
       ON rvs.url = r.resource_version_url AND rvs.timestamp = r.resource_version_timestamp
     WHERE r.run_id = ?
     AND r.is_successful = 1
     GROUP BY rvs.cdx_id`,
  );

  const errorsByDomainStmt = db.prepare<[string], CdxIdCountRow>(
    `SELECT rvs.cdx_id, COUNT(*) AS count
     FROM request r
     INNER JOIN resource_version_source rvs
       ON rvs.url = r.resource_version_url AND rvs.timestamp = r.resource_version_timestamp
     WHERE r.run_id = ?
     AND r.is_successful = 0
     GROUP BY rvs.cdx_id`,
  );

  const errorsByTypeStmt = db.prepare<[string], ErrorByTypeRow>(
    `SELECT re.error_name, re.error_code, COUNT(*) AS count
     FROM request_errors re
     INNER JOIN request r ON r.id = re.request_id
     WHERE r.run_id = ?
     GROUP BY re.error_name, re.error_code
     ORDER BY count DESC`,
  );

  return runs.map((run) => {
    const resolveDomain = (cdxId: string): string => {
      if (cdxDomainCache.has(cdxId)) {
        return cdxDomainCache.get(cdxId) ?? cdxId;
      }

      const domain = cdxDomainByIdStmt.get(cdxId)?.domain ?? null;
      cdxDomainCache.set(cdxId, domain);
      return domain ?? cdxId;
    };

    const countsBySuccess = new Map(
      countsBySuccessStmt
        .all(run.id)
        .map((row) => [row.is_successful, row.count] as const),
    );

    return {
      id: run.id,
      created_at: run.created_at,
      args: argStmt.all(run.id),
      new_cdx_entry_count: cdxCountStmt.get(run.id)?.count ?? 0,
      requested_total: requestedTotalStmt.get(run.id)?.count ?? 0,
      requested_by_domain: mapCdxCountsToDomain(
        requestedByDomainStmt.all(run.id),
        resolveDomain,
      ),
      downloaded_total: countsBySuccess.get(1) ?? 0,
      downloaded_by_domain: mapCdxCountsToDomain(
        downloadedByDomainStmt.all(run.id),
        resolveDomain,
      ),
      errors_total: countsBySuccess.get(0) ?? 0,
      errors_by_domain: mapCdxCountsToDomain(
        errorsByDomainStmt.all(run.id),
        resolveDomain,
      ),
      errors_by_type: errorsByTypeStmt.all(run.id),
    };
  });
}
