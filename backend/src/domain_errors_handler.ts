import type { Database as DB } from 'better-sqlite3';

const PAGE_SIZE = 100;

type FilterOption = {
  error_code: string;
  error_name: string | null;
};

export function getDomainErrorFilters(db: DB, domain: string): FilterOption[] {
  return db
    .prepare<[string], FilterOption>(
      `SELECT DISTINCT re.error_code, re.error_name
       FROM resource_version rv
       JOIN resource_version_source rvs ON rvs.url = rv.url AND rvs.timestamp = rv.timestamp
       JOIN cdx_file cf ON cf.id = rvs.cdx_id
       JOIN request_errors re ON re.request_id = rv.last_errored_request_id
       WHERE cf.domain = ?
         AND rv.last_errored_request_id IS NOT NULL
       ORDER BY re.error_code, re.error_name`,
    )
    .all(domain);
}

type VersionRow = {
  url: string;
  timestamp: number;
  last_errored_request_id: string;
};

type RequestErrorRow = {
  request_id: string;
  error_code: string;
  error_name: string | null;
  error_message: string;
};

export type ErrorEntry = {
  url: string;
  timestamp: number;
  errors: {
    error_code: string;
    error_name: string | null;
    error_message: string;
  }[];
};

// Sentinel value used in URL params to represent a NULL error_name.
export const NULL_NAME_SENTINEL = '__null__';

export function getDomainErrorsData(
  db: DB,
  domain: string,
  filterCodes: string[],
  filterNames: string[],
  cursorUrl: string | null,
  cursorTs: number | null,
) {
  const hasCodeFilter = filterCodes.length > 0;
  const hasNameFilter = filterNames.length > 0;

  const codeList = hasCodeFilter ? filterCodes.map(() => '?').join(',') : '';

  // Split name filter into non-null values and a flag for IS NULL
  const nonNullFilterNames = filterNames.filter(
    (n) => n !== NULL_NAME_SENTINEL,
  );
  const includeNullName = filterNames.includes(NULL_NAME_SENTINEL);

  let nameFilterSql = '';
  if (hasNameFilter) {
    const parts: string[] = [];
    if (includeNullName) parts.push('re.error_name IS NULL');
    if (nonNullFilterNames.length > 0)
      parts.push(
        `re.error_name IN (${nonNullFilterNames.map(() => '?').join(',')})`,
      );
    nameFilterSql = `AND (${parts.join(' OR ')})`;
  }

  // Step 1: fetch PAGE_SIZE distinct resource_versions (applying filters and cursor here)
  const versionSql = `
    SELECT rv.url, rv.timestamp, rv.last_errored_request_id
    FROM resource_version rv
    JOIN resource_version_source rvs ON rvs.url = rv.url AND rvs.timestamp = rv.timestamp
    JOIN cdx_file cf ON cf.id = rvs.cdx_id
    JOIN request_errors re ON re.request_id = rv.last_errored_request_id
    WHERE cf.domain = ?
      AND rv.last_errored_request_id IS NOT NULL
      ${hasCodeFilter ? `AND re.error_code IN (${codeList})` : ''}
      ${nameFilterSql}
      AND (? IS NULL OR rv.url > ? OR (rv.url = ? AND rv.timestamp > ?))
    GROUP BY rv.url, rv.timestamp
    ORDER BY rv.url, rv.timestamp
    LIMIT ?`;

  const versionBindParams: unknown[] = [
    domain,
    ...filterCodes,
    ...nonNullFilterNames,
    cursorUrl,
    cursorUrl,
    cursorUrl,
    cursorTs,
    PAGE_SIZE,
  ];

  const versions = db
    .prepare<unknown[], VersionRow>(versionSql)
    .all(...versionBindParams);

  if (versions.length === 0) {
    return { domain, entries: [], nextCursor: null };
  }

  // Step 2: fetch all errors for those request IDs (no limit — each version has its own errors)
  const requestIds = versions.map((v) => v.last_errored_request_id);
  const placeholders = requestIds.map(() => '?').join(',');
  const requestErrors = db
    .prepare<unknown[], RequestErrorRow>(
      `SELECT request_id, error_code, error_name, error_message
       FROM request_errors
       WHERE request_id IN (${placeholders})`,
    )
    .all(...requestIds);

  // Group errors by request_id
  const errorsByRequestId = new Map<string, RequestErrorRow[]>();
  for (const re of requestErrors) {
    const arr = errorsByRequestId.get(re.request_id) ?? [];
    arr.push(re);
    errorsByRequestId.set(re.request_id, arr);
  }

  const entries: ErrorEntry[] = versions.map((v) => ({
    url: v.url,
    timestamp: v.timestamp,
    errors: (errorsByRequestId.get(v.last_errored_request_id) ?? []).map(
      (re) => ({
        error_code: re.error_code,
        error_name: re.error_name,
        error_message: re.error_message,
      }),
    ),
  }));

  const lastVersion = versions[versions.length - 1];
  const nextCursor =
    versions.length === PAGE_SIZE
      ? { url: lastVersion.url, timestamp: lastVersion.timestamp }
      : null;

  return { domain, entries, nextCursor };
}
