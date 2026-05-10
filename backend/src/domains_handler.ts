import type { Database as DB } from 'better-sqlite3';

export interface DomainStats {
  id: string;
  domain: string;
  resources: number;
  downloaded: number;
  errored: number;
  pending: number;
}

export function getDomainsStats(db: DB): DomainStats[] {
  return db
    .prepare<[], DomainStats>(
      `SELECT id, domain, total_count AS resources,
              downloaded_count AS downloaded,
              errored_count AS errored,
              pending_count AS pending
       FROM cdx_file
       ORDER BY domain`,
    )
    .all();
}
