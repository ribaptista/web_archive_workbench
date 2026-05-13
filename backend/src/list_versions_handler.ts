import type { Database as DB } from 'better-sqlite3';
import { getPathParts } from './tree-node-utils';

const PAGE_SIZE = 100;

type VersionRow = {
  timestamp: number;
  successful_request_id: string | null;
  status: 'pending' | 'error' | 'ok' | 'redirect';
  error_code: string | null;
  error_message: string | null;
  location_original: string | null;
  location_timestamp: number | null;
};

export function getListVersionsData(
  db: DB,
  url: string,
  cursor: number | null,
) {
  const versions = db
    .prepare<[string, number, number], VersionRow>(
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
       JOIN resource res ON res.url = rv.url
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
       ) le ON le.resource_version_url = rv.url
           AND le.resource_version_timestamp = rv.timestamp
           AND le.rn = 1
       WHERE res.normalized_url = ?
         AND rv.timestamp > ?
       ORDER BY rv.timestamp
       LIMIT ?`,
    )
    .all(url, cursor ?? 0, PAGE_SIZE);

  const nextCursor =
    versions.length === PAGE_SIZE
      ? versions[versions.length - 1].timestamp
      : null;

  const parts = getPathParts(url);
  const breadcrumbs = parts.map((_, i) => ({
    label: parts[i],
    path: parts.slice(0, i + 1).join(''),
    level: i,
  }));

  return { url, versions, nextCursor, breadcrumbs };
}
