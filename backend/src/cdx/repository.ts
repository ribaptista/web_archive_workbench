import type { Database as DB } from 'better-sqlite3';
import { getPathParts } from '../http/url';

// ── Domain ────────────────────────────────────────────────────────────────────

export interface DomainRow {
  name: string;
}

export interface DomainStatsRow {
  name: string;
  resources: number;
  successful_entry_count: number;
  errored_entry_count: number;
  pending_entry_count: number;
}

// ── Error filters ─────────────────────────────────────────────────────────────

export interface ErrorFilterRow {
  error_code: string;
  error_name: string;
}

// ── Error entries (paginated) ─────────────────────────────────────────────────

export interface ErrorVersionRow {
  url: string;
  timestamp: number;
  last_errored_request_id: string;
}

export interface ErrorRequestRow {
  request_id: string;
  error_code: string;
  error_name: string;
  error_message: string;
}

export interface ErrorsPageParams {
  domainName: string;
  filterCodes: string[];
  filterNames: string[];
  cursorUrl: string | null;
  cursorTs: number | null;
  pageSize: number;
}

export interface ErrorsPageResult {
  versions: ErrorVersionRow[];
  errorsByRequestId: Map<string, ErrorRequestRow[]>;
}

// ── Resource version state ────────────────────────────────────────────────────

export interface ResourceVersionStateRow {
  successful_request_id: string | null;
  last_errored_request_id: string | null;
}

// ── List versions ─────────────────────────────────────────────────────────────

export interface VersionPageRow {
  url: string;
  timestamp: number;
  successful_request_id: string | null;
  status: 'pending' | 'error' | 'ok' | 'redirect';
  error_code: string | null;
  error_message: string | null;
  location_original: string | null;
  location_timestamp: number | null;
}

// ── Resources (tree) ──────────────────────────────────────────────────────────

export interface TreeNodeRow {
  path: string;
  level: number;
  is_leaf: number;
}

// ── Retry / pending task queries ──────────────────────────────────────────────

export interface ReplayCdxRow {
  timestamp: number;
  mimetype: string;
  body_digest: string;
  domain: string;
  terminal_original: string;
  location_original: string | null;
  location_timestamp: number | null;
}

export interface ReplayCdxRow {
  timestamp: number;
  mimetype: string;
  body_digest: string;
  domain: string;
  terminal_original: string;
  location_original: string | null;
  location_timestamp: number | null;
}

export interface PendingCountRow {
  domain_name: string;
  n: number;
}

export type PendingTaskCounts = {
  total: number;
  byDomainId: Map<string, number>;
};

export type FetchPendingOptions = {
  skipErrors?: string[];
  skipErrorMessages?: string[];
};

export interface PendingEntryRow {
  url: string;
  timestamp: number;
  domain_name: string;
}

export interface RetryEntryRow {
  url: string;
  timestamp: number;
  domain_name: string;
  normalized_name: string;
}

export class CdxRepository {
  constructor(private readonly db: DB) {}

  // ── Domain ──────────────────────────────────────────────────────────────────

  insertOrIgnoreDomain(
    name: string,
    runId: string,
    normalizedName: string,
  ): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO domain (name, run_id, normalized_name) VALUES (?, ?, ?)`,
      )
      .run(name, runId, normalizedName);
  }

  findAllDomains(): DomainRow[] {
    return this.db
      .prepare<[], DomainRow>(`SELECT name FROM domain ORDER BY name`)
      .all();
  }

  findDomainNamesIn(names: string[]): string[] {
    if (names.length === 0) return [];
    const placeholders = names.map(() => '?').join(', ');
    return this.db
      .prepare<string[], { name: string }>(
        `SELECT name FROM domain WHERE name IN (${placeholders})`,
      )
      .all(...names)
      .map((r) => r.name);
  }

  findDomainsStats(): DomainStatsRow[] {
    return this.db
      .prepare<[], DomainStatsRow>(
        `SELECT name, entry_total_count AS resources,
                successful_entry_count,
                errored_entry_count,
                pending_entry_count
         FROM domain
         ORDER BY name`,
      )
      .all();
  }

  incrementDomainEntryCount(domainName: string): void {
    this.db
      .prepare(
        `UPDATE domain
         SET entry_total_count = entry_total_count + 1,
             pending_entry_count = pending_entry_count + 1
         WHERE name = ?`,
      )
      .run(domainName);
  }

  updateDomainCounters(
    successDelta: number,
    errorDelta: number,
    pendingDelta: number,
    url: string,
    timestamp: number,
  ): void {
    this.db
      .prepare(
        `UPDATE domain
         SET successful_entry_count = successful_entry_count + ?,
             errored_entry_count    = errored_entry_count    + ?,
             pending_entry_count    = pending_entry_count    + ?
         WHERE name = (
           SELECT domain_name FROM resource_version_source
           WHERE url = ? AND timestamp = ?
           LIMIT 1
         )`,
      )
      .run(successDelta, errorDelta, pendingDelta, url, timestamp);
  }

  // ── Error filters & paged errors ────────────────────────────────────────────

  findErrorFilters(domainName: string): ErrorFilterRow[] {
    return this.db
      .prepare<[string], ErrorFilterRow>(
        `SELECT DISTINCT re.error_code, re.error_name
         FROM resource_version rv
         JOIN resource_version_source rvs ON rvs.url = rv.url AND rvs.timestamp = rv.timestamp
         JOIN request_errors re ON re.request_id = rv.last_errored_request_id
         WHERE rvs.domain_name = ?
           AND rv.last_errored_request_id IS NOT NULL
         ORDER BY re.error_code, re.error_name`,
      )
      .all(domainName);
  }

  findErrorVersionsPage(params: ErrorsPageParams): ErrorVersionRow[] {
    const {
      domainName,
      filterCodes,
      filterNames,
      cursorUrl,
      cursorTs,
      pageSize,
    } = params;
    const hasCodeFilter = filterCodes.length > 0;
    const hasNameFilter = filterNames.length > 0;

    const codeFilterSql = hasCodeFilter
      ? `AND re.error_code IN (${filterCodes.map(() => '?').join(',')})`
      : '';
    const nameFilterSql = hasNameFilter
      ? `AND re.error_name IN (${filterNames.map(() => '?').join(',')})`
      : '';

    const sql = `
      SELECT rv.url, rv.timestamp, rv.last_errored_request_id
      FROM resource_version rv
      JOIN resource_version_source rvs ON rvs.url = rv.url AND rvs.timestamp = rv.timestamp
      JOIN request_errors re ON re.request_id = rv.last_errored_request_id
      WHERE rvs.domain_name = ?
        AND rv.last_errored_request_id IS NOT NULL
        ${codeFilterSql}
        ${nameFilterSql}
        AND (? IS NULL OR rv.url > ? OR (rv.url = ? AND rv.timestamp > ?))
      GROUP BY rv.url, rv.timestamp
      ORDER BY rv.url, rv.timestamp
      LIMIT ?`;

    return this.db
      .prepare<unknown[], ErrorVersionRow>(sql)
      .all(
        domainName,
        ...filterCodes,
        ...filterNames,
        cursorUrl,
        cursorUrl,
        cursorUrl,
        cursorTs,
        pageSize,
      );
  }

  findErrorsByRequestIds(requestIds: string[]): ErrorRequestRow[] {
    if (requestIds.length === 0) return [];
    const placeholders = requestIds.map(() => '?').join(',');
    return this.db
      .prepare<unknown[], ErrorRequestRow>(
        `SELECT request_id, error_code, error_name, error_message
         FROM request_errors
         WHERE request_id IN (${placeholders})`,
      )
      .all(...requestIds);
  }

  // ── CDX source ───────────────────────────────────────────────────────────────

  insertOrIgnoreCdxSource(baseUrl: string, replayBaseUrl: string): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO cdx_source (base_url, replay_base_url) VALUES (?, ?)`,
      )
      .run(baseUrl, replayBaseUrl);
  }

  findCdxSourceId(baseUrl: string): number {
    const row = this.db
      .prepare<
        [string],
        { id: number }
      >(`SELECT id FROM cdx_source WHERE base_url = ?`)
      .get(baseUrl);
    if (!row) throw new Error(`cdx_source not found for base_url=${baseUrl}`);
    return row.id;
  }

  // ── CDX entry ────────────────────────────────────────────────────────────────

  insertOrIgnoreCdxEntry(params: {
    runId: string;
    domainName: string;
    line: number;
    urlKey: string | null;
    timestamp: number | null;
    original: string | null;
    mimetype: string | null;
    statusCode: number | null;
    digest: string | null;
    length: number | null;
    raw: string;
    isValid: number;
    cdxSourceId: number;
  }): { changes: number } {
    return this.db
      .prepare(
        `INSERT OR IGNORE INTO cdx_entry (
           run_id, domain_name, line, url_key, timestamp, original,
           mimetype, status_code, digest, length, raw, is_valid, cdx_source_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        params.runId,
        params.domainName,
        params.line,
        params.urlKey,
        params.timestamp,
        params.original,
        params.mimetype,
        params.statusCode,
        params.digest,
        params.length,
        params.raw,
        params.isValid,
        params.cdxSourceId,
      ) as { changes: number };
  }

  countCdxEntryByRawAndDomain(raw: string, domainName: string): number {
    const row = this.db
      .prepare<
        [string, string],
        { n: number }
      >(`SELECT COUNT(*) AS n FROM cdx_entry ce WHERE ce.raw = ? AND ce.domain_name = ?`)
      .get(raw, domainName);
    return row?.n ?? 0;
  }

  // ── Resource ─────────────────────────────────────────────────────────────────

  insertOrIgnoreResource(url: string, normalizedUrl: string): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO resource (url, normalized_url) VALUES (?, ?)`,
      )
      .run(url, normalizedUrl);
  }

  // ── Resource version ─────────────────────────────────────────────────────────

  insertOrIgnoreResourceVersion(
    url: string,
    timestamp: number,
  ): { changes: number } {
    return this.db
      .prepare(
        `INSERT OR IGNORE INTO resource_version (url, timestamp) VALUES (?, ?)`,
      )
      .run(url, timestamp) as { changes: number };
  }

  getResourceVersionState(
    url: string,
    timestamp: number,
  ): ResourceVersionStateRow | undefined {
    return this.db
      .prepare<[string, number], ResourceVersionStateRow>(
        `SELECT successful_request_id, last_errored_request_id
         FROM resource_version WHERE url = ? AND timestamp = ?`,
      )
      .get(url, timestamp);
  }

  setSuccessfulRequest(
    requestId: string,
    url: string,
    timestamp: number,
    prevSuccessfulId: string | null,
    prevErroredId: string | null,
  ): { changes: number } {
    return this.db
      .prepare(
        `UPDATE resource_version
         SET successful_request_id = ?, last_errored_request_id = NULL
         WHERE url = ? AND timestamp = ?
           AND successful_request_id IS ?
           AND last_errored_request_id IS ?`,
      )
      .run(requestId, url, timestamp, prevSuccessfulId, prevErroredId) as {
      changes: number;
    };
  }

  setLastErroredRequest(
    requestId: string,
    url: string,
    timestamp: number,
    prevSuccessfulId: string | null,
    prevErroredId: string | null,
  ): { changes: number } {
    return this.db
      .prepare(
        `UPDATE resource_version
         SET last_errored_request_id = ?
         WHERE url = ? AND timestamp = ?
           AND successful_request_id IS ?
           AND last_errored_request_id IS ?`,
      )
      .run(requestId, url, timestamp, prevSuccessfulId, prevErroredId) as {
      changes: number;
    };
  }

  findResourceVersionsPage(
    normalizedUrl: string,
    afterTimestamp: number,
    limit: number,
  ): VersionPageRow[] {
    return this.db
      .prepare<[string, number, number], VersionPageRow>(
        `SELECT rv.timestamp,
                res.url,
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
      .all(normalizedUrl, afterTimestamp, limit);
  }

  // ── Resource version source ───────────────────────────────────────────────────

  insertOrIgnoreResourceVersionSource(
    url: string,
    timestamp: number,
    domainName: string,
  ): { changes: number } {
    return this.db
      .prepare(
        `INSERT OR IGNORE INTO resource_version_source (url, timestamp, domain_name) VALUES (?, ?, ?)`,
      )
      .run(url, timestamp, domainName) as { changes: number };
  }

  // ── Tree node ────────────────────────────────────────────────────────────────

  insertTreeNodePaths(originals: string[]): void {
    const seen: Set<string> = new Set();
    const stmt = this.db.prepare<[string, number]>(`
      INSERT INTO tree_node (path, level) VALUES (?, ?)
      ON CONFLICT DO NOTHING
    `);
    for (const original of originals) {
      const parts = getPathParts(original);
      for (let i = 0; i < parts.length; i++) {
        const path = parts.slice(0, i + 1).join('');
        if (!seen.has(path)) {
          seen.add(path);
          stmt.run(path, i);
        }
      }
    }
  }

  findTreeNodesPage(
    filterPath: string | null,
    filterLevel: number,
    afterPath: string,
    limit: number,
  ): TreeNodeRow[] {
    if (filterPath === null) {
      return this.db
        .prepare<[string, number], TreeNodeRow>(
          `SELECT tn.path, tn.level,
                  CASE WHEN EXISTS (SELECT 1 FROM resource WHERE normalized_url = tn.path)
                       THEN 1 ELSE 0 END AS is_leaf
           FROM tree_node tn
           WHERE tn.level = 0
             AND tn.path > ?
           ORDER BY tn.path
           LIMIT ?`,
        )
        .all(afterPath, limit);
    }
    return this.db
      .prepare<[number, string, string, number], TreeNodeRow>(
        `SELECT tn.path, tn.level,
                CASE WHEN EXISTS (SELECT 1 FROM resource WHERE normalized_url = tn.path)
                     THEN 1 ELSE 0 END AS is_leaf
         FROM tree_node tn
         WHERE tn.level = ?
           AND tn.path LIKE ? ESCAPE '\\'
           AND tn.path > ?
         ORDER BY tn.path
         LIMIT ?`,
      )
      .all(
        filterLevel + 1,
        filterPath.replace(/[%_\\]/g, '\\$&') + '%',
        afterPath,
        limit,
      );
  }

  // ── Pending / retry task queries ─────────────────────────────────────────────

  countPendingByDomains(params: {
    domainIds: string[];
    fetchPendingOptions?: FetchPendingOptions;
  }): PendingCountRow[] {
    const { domainIds, fetchPendingOptions = {} } = params;
    const { skipErrors = [], skipErrorMessages = [] } = fetchPendingOptions;
    if (domainIds.length === 0) return [];
    const domainPlaceholders = domainIds.map(() => '?').join(', ');
    const skipErrorExistsClause = buildSkipErrorClause(
      skipErrors,
      skipErrorMessages,
    );
    const skipParams = [...skipErrors, ...skipErrorMessages];
    return this.db
      .prepare<unknown[], PendingCountRow>(
        `SELECT rvs.domain_name, COUNT(*) AS n
         FROM resource_version rv
         JOIN resource_version_source rvs ON rvs.url = rv.url AND rvs.timestamp = rv.timestamp
         WHERE rvs.domain_name IN (${domainPlaceholders})
           AND rv.successful_request_id IS NULL
           ${skipErrorExistsClause}
         GROUP BY rvs.domain_name`,
      )
      .all(...domainIds, ...skipParams);
  }

  countPendingTasks(
    domains: string[],
    fetchPendingOptions: FetchPendingOptions = {},
  ): PendingTaskCounts {
    if (domains.length === 0) {
      return { total: 0, byDomainId: new Map<string, number>() };
    }
    const { skipErrors = [], skipErrorMessages = [] } = fetchPendingOptions;
    const rows = this.countPendingByDomains({
      domainIds: domains,
      fetchPendingOptions,
    });
    const byDomainId = new Map<string, number>();
    for (const domainId of domains) byDomainId.set(domainId, 0);
    let total = 0;
    for (const row of rows) {
      byDomainId.set(row.domain_name, row.n);
      total += row.n;
    }
    return { total, byDomainId };
  }

  samplePendingEntries(params: {
    domainId: string;
    fetchPendingOptions?: FetchPendingOptions;
    limit: number;
  }): PendingEntryRow[] {
    const { domainId, fetchPendingOptions = {}, limit } = params;
    const { skipErrors = [], skipErrorMessages = [] } = fetchPendingOptions;
    const skipErrorExistsClause = buildSkipErrorClause(
      skipErrors,
      skipErrorMessages,
    );
    const skipParams = [...skipErrors, ...skipErrorMessages];
    return this.db
      .prepare<unknown[], PendingEntryRow>(
        `SELECT rvs.url, rvs.timestamp, rvs.domain_name
         FROM resource_version rv
         JOIN resource_version_source rvs ON rvs.url = rv.url AND rvs.timestamp = rv.timestamp
         WHERE rvs.domain_name = ?
           AND rv.successful_request_id IS NULL
           ${skipErrorExistsClause}
         LIMIT ?`,
      )
      .all(domainId, ...skipParams, limit);
  }

  findRetryTasksPage(params: {
    domainIds: string[];
    runId: string;
    fetchPendingOptions?: FetchPendingOptions;
    limit: number;
  }): RetryEntryRow[] {
    const { domainIds, runId, fetchPendingOptions = {}, limit } = params;
    const { skipErrors = [], skipErrorMessages = [] } = fetchPendingOptions;
    const domainPlaceholders = domainIds.map(() => '?').join(', ');
    const skipErrorExistsClause = buildSkipErrorClause(
      skipErrors,
      skipErrorMessages,
    );
    const skipParams = [...skipErrors, ...skipErrorMessages];
    return this.db
      .prepare<unknown[], RetryEntryRow>(
        `SELECT rvs.domain_name, rvs.url, rvs.timestamp, d.normalized_name
         FROM resource_version rv
         JOIN resource_version_source rvs ON rvs.url = rv.url AND rvs.timestamp = rv.timestamp
         JOIN domain d ON d.name = rvs.domain_name
         WHERE rvs.domain_name IN (${domainPlaceholders})
           AND rv.successful_request_id IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM request r
             WHERE r.run_id = ?
               AND r.resource_version_url = rv.url
               AND r.resource_version_timestamp = rv.timestamp
           )
           ${skipErrorExistsClause}
         ORDER BY rvs.domain_name, rvs.url, rvs.timestamp
         LIMIT ?`,
      )
      .all(...domainIds, runId, ...skipParams, limit);
  }

  /** Count HTML candidates for search scoping (used by run_search_handler). */
  countHtmlCandidates(domainIds: string[]): number {
    const domainExistsClause = buildDomainExistsClause(domainIds);
    const row = this.db
      .prepare<string[], { count: number }>(
        `SELECT COUNT(*) AS count
         FROM request r
         WHERE r.mimetype = 'text/html'
           AND r.location IS NULL
           AND r.is_successful = 1
         ${domainExistsClause}`,
      )
      .get(...domainIds);
    return row?.count ?? 0;
  }

  /** Page of HTML candidates for the search scan worker. */
  findHtmlCandidatesPage(params: {
    cursorUrl: string;
    cursorTimestamp: number;
    domainIds: string[];
    limit: number;
  }): HtmlCandidateRow[] {
    const { cursorUrl, cursorTimestamp, domainIds, limit } = params;
    const domainExistsClause = buildDomainExistsClause(domainIds);
    return this.db
      .prepare<unknown[], HtmlCandidateRow>(
        `SELECT r.resource_version_url,
                r.resource_version_timestamp,
                r.id AS request_id,
                r.body_digest
         FROM resource_version rv
         JOIN request r ON r.id = rv.successful_request_id
         WHERE rv.successful_request_id IS NOT NULL
           AND (r.resource_version_url, r.resource_version_timestamp) > (?, ?)
           AND r.mimetype = 'text/html'
           AND r.location IS NULL
           ${domainExistsClause}
         ORDER BY r.resource_version_url, r.resource_version_timestamp
         LIMIT ?`,
      )
      .all(cursorUrl, cursorTimestamp, ...domainIds, limit);
  }

  // ── Replay lookup ────────────────────────────────────────────────────────────

  findReplayCdxByOriginal(
    original: string,
    timestamp: number,
  ): ReplayCdxRow | undefined {
    return this.db
      .prepare<[string, number], ReplayCdxRow>(
        `SELECT rv.timestamp, r.mimetype, r.body_digest, rvs.domain_name AS domain,
                rv.url AS terminal_original, r.location_original, r.location_timestamp
         FROM resource_version rv
         JOIN request r ON r.id = rv.successful_request_id
         JOIN resource_version_source rvs ON rvs.url = rv.url AND rvs.timestamp = rv.timestamp
         WHERE rv.url = ?
           AND r.body_digest IS NOT NULL
         ORDER BY ABS(rv.timestamp - ?)
         LIMIT 1`,
      )
      .get(original, timestamp);
  }

  findReplayCdxByNormalizedUrl(
    normalizedUrl: string,
    timestamp: number,
  ): ReplayCdxRow[] {
    return this.db
      .prepare<[string, number], ReplayCdxRow>(
        `SELECT rv.timestamp, r.mimetype, r.body_digest, rvs.domain_name AS domain,
                rv.url AS terminal_original, r.location_original, r.location_timestamp
         FROM resource r2
         JOIN resource_version rv ON rv.url = r2.url
         JOIN request r ON r.id = rv.successful_request_id
         JOIN resource_version_source rvs ON rvs.url = rv.url AND rvs.timestamp = rv.timestamp
         WHERE r2.normalized_url = ?
           AND r.body_digest IS NOT NULL
         ORDER BY ABS(rv.timestamp - ?)
         LIMIT 2`,
      )
      .all(normalizedUrl, timestamp);
  }
}

export interface HtmlCandidateRow {
  resource_version_url: string;
  resource_version_timestamp: number;
  request_id: string;
  body_digest: string;
}

// ── helpers ────────────────────────────────────────────────────────────────────

export function buildDomainExistsClause(domainIds: string[]): string {
  if (domainIds.length === 0) return '';
  const placeholders = domainIds.map(() => '?').join(', ');
  return `AND EXISTS (
        SELECT 1
        FROM resource_version_source rvs
        WHERE r.resource_version_url = rvs.url
          AND r.resource_version_timestamp = rvs.timestamp
          AND rvs.domain_name IN (${placeholders})
      )`;
}

export function buildSkipErrorClause(
  skipErrors: string[],
  skipErrorMessages: string[],
): string {
  const filters = [
    ...skipErrors.map(() => `re.error_code = ?`),
    ...skipErrorMessages.map(() => `re.error_message LIKE ?`),
  ].join(' OR ');
  if (!filters) return '';
  return `AND NOT EXISTS (
    SELECT 1 FROM request_errors re
    JOIN request r ON r.id = re.request_id
    WHERE r.resource_version_url = rv.url
      AND r.resource_version_timestamp = rv.timestamp
      AND (${filters})
  )`;
}
