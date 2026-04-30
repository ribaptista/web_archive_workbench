import type { Database as DB } from 'better-sqlite3';
import type { Eta } from 'eta';

type VersionRow = {
  timestamp: number;
  successful_request_id: string | null;
  status: 'pending' | 'error' | 'ok' | 'redirect';
  error_code: string | null;
  error_message: string | null;
  location_original: string | null;
  location_timestamp: number | null;
};

export function renderListVersions(db: DB, eta: Eta, url: string): string {
  const versions = db
    .prepare<[string, string], VersionRow>(
      `SELECT rv.timestamp,
              rv.successful_request_id,
              CASE
                WHEN rv.successful_request_id IS NOT NULL AND sr.location IS NOT NULL THEN 'redirect'
                WHEN rv.successful_request_id IS NOT NULL THEN 'ok'
                WHEN le.error_code IS NOT NULL THEN 'error'
                ELSE 'pending'
              END AS status,
              le.error_code,
              le.error_message,
              sr.location_original,
              sr.location_timestamp
       FROM resource_version rv
       LEFT JOIN request sr ON sr.id = rv.successful_request_id
       LEFT JOIN (
         SELECT r.resource_version_url,
                r.resource_version_timestamp,
                re.error_code,
                re.error_message,
                ROW_NUMBER() OVER (
                  PARTITION BY r.resource_version_url, r.resource_version_timestamp
                  ORDER BY r.created_at DESC, re.id DESC
                ) AS rn
         FROM request r
         JOIN request_errors re ON re.request_id = r.id
         WHERE r.resource_version_url = ?
       ) le ON le.resource_version_url = rv.url
           AND le.resource_version_timestamp = rv.timestamp
           AND le.rn = 1
       WHERE rv.url = ?
       ORDER BY rv.timestamp`,
    )
    .all(url, url);

  return (
    eta.render('./list_versions', { url, versions }) ??
    '<h1>Template error</h1>'
  );
}
