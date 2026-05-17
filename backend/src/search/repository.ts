import type { Database as DB } from 'better-sqlite3';
import type {
  SearchCondition,
  SearchConditionInput,
  SearchMetadata,
  FileMatch,
  FileMatches,
} from './types';

// ── Search ────────────────────────────────────────────────────────────────────

export interface SearchSummaryRow {
  id: number;
  created_at: string;
  status: string;
  file_count: number;
  scanned_file_count: number;
  error_message: string | null;
  match_file_count: number;
}

export interface SearchRow {
  id: number;
  created_at: string;
  status: string;
  file_count: number;
  scanned_file_count: number;
  error_name: string | null;
  error_message: string | null;
}

export interface SearchConditionRow {
  id: number;
  regex: string;
  not_regex_nearby: string | null;
  context_size: number;
}

export interface SearchConditionSummaryRow {
  regex: string;
  not_regex_nearby: string | null;
}

export interface SearchDomainRow {
  name: string;
}

export interface SearchDomainSummaryRow {
  domain: string;
}

// ── Search file ───────────────────────────────────────────────────────────────

export interface SearchFileRow {
  id: number;
  request_id: string;
  body_digest: string;
  match_count: number;
  duplicate_count: number;
  context_digest: string | null;
  resource_version_url: string;
  resource_version_timestamp: number;
}

export interface SearchMatchRow {
  id: number;
  search_condition_id: number;
  match_offset: number;
  match_length: number;
}

// ── Counts ────────────────────────────────────────────────────────────────────

export interface DomainCountRow {
  domain_name: string;
  count: number;
}

export interface ConditionCountRow {
  search_condition_id: number;
  count: number;
}

export interface ReactionCountRow {
  reaction_type_id: number;
  count: number;
}

export interface SimilarGroupReactionRow {
  context_digest: string;
  reaction_type_id: number;
}

// ── Filters for search file queries ──────────────────────────────────────────

export interface SearchFilesFilter {
  searchId: number;
  similarTo?: string;
  domainFilter?: string[];
  conditionFilter?: number[];
  reactionFilter?: number[];
  cursor?: { timestamp: number; requestId: string };
}

export interface HtmlCandidateRow {
  resource_version_url: string;
  resource_version_timestamp: number;
  request_id: string;
  body_digest: string;
}

export class SearchRepository {
  constructor(private readonly db: DB) {}

  // ── Search lifecycle ─────────────────────────────────────────────────────────

  insertSearch(fileCount: number): number {
    const result = this.db
      .prepare<[number]>(
        `INSERT INTO search (status, file_count, scanned_file_count)
         VALUES ('pending', ?, 0)`,
      )
      .run(fileCount);
    return result.lastInsertRowid as number;
  }

  setSearchStatus(status: string, searchId: number): void {
    this.db
      .prepare(`UPDATE search SET status = ? WHERE id = ?`)
      .run(status, searchId);
  }

  setSearchError(message: string, searchId: number): void {
    this.db
      .prepare(
        `UPDATE search SET status = 'error', error_message = ? WHERE id = ?`,
      )
      .run(message, searchId);
  }

  incrementScannedCount(increment: number, searchId: number): void {
    this.db
      .prepare(
        `UPDATE search SET scanned_file_count = scanned_file_count + ? WHERE id = ?`,
      )
      .run(increment, searchId);
  }

  deleteSearch(searchId: number): void {
    this.db.prepare(`DELETE FROM search WHERE id = ?`).run(searchId);
  }

  // ── Search queries ───────────────────────────────────────────────────────────

  findSummaries(): SearchSummaryRow[] {
    return this.db
      .prepare<[], SearchSummaryRow>(
        `SELECT s.id, s.created_at, s.status, s.file_count, s.scanned_file_count,
                s.error_message,
                COUNT(DISTINCT sf.context_digest) AS match_file_count
         FROM search s
         LEFT JOIN search_file sf ON sf.search_id = s.id
         GROUP BY s.id
         ORDER BY s.created_at DESC`,
      )
      .all();
  }

  findById(searchId: number): SearchRow | undefined {
    return this.db
      .prepare<[number], SearchRow>(
        `SELECT id, created_at, status, file_count, scanned_file_count,
                error_name, error_message
         FROM search WHERE id = ?`,
      )
      .get(searchId);
  }

  // ── Conditions ───────────────────────────────────────────────────────────────

  findConditionsBySearchId(searchId: number): SearchConditionRow[] {
    return this.db
      .prepare<[number], SearchConditionRow>(
        `SELECT id, regex, not_regex_nearby, context_size
         FROM search_condition WHERE search_id = ? ORDER BY id`,
      )
      .all(searchId);
  }

  findConditionSummariesBySearchId(
    searchId: number,
  ): SearchConditionSummaryRow[] {
    return this.db
      .prepare<[number], SearchConditionSummaryRow>(
        `SELECT regex, not_regex_nearby FROM search_condition
         WHERE search_id = ? ORDER BY id`,
      )
      .all(searchId);
  }

  insertCondition(
    searchId: number,
    regex: string,
    notRegexNearby: string | null,
    contextSize: number,
  ): number {
    const result = this.db
      .prepare<[number, string, string | null, number]>(
        `INSERT INTO search_condition (search_id, regex, not_regex_nearby, context_size)
         VALUES (?, ?, ?, ?)`,
      )
      .run(searchId, regex, notRegexNearby, contextSize);
    return result.lastInsertRowid as number;
  }

  // ── Domains ──────────────────────────────────────────────────────────────────

  findDomainsBySearchId(searchId: number): SearchDomainRow[] {
    return this.db
      .prepare<[number], SearchDomainRow>(
        `SELECT sd.domain_name AS name FROM search_domain sd
         WHERE sd.search_id = ? ORDER BY sd.domain_name`,
      )
      .all(searchId);
  }

  findDomainSummariesBySearchId(searchId: number): SearchDomainSummaryRow[] {
    return this.db
      .prepare<[number], SearchDomainSummaryRow>(
        `SELECT sd.domain_name AS domain FROM search_domain sd
         WHERE sd.search_id = ? ORDER BY sd.id`,
      )
      .all(searchId);
  }

  insertDomain(searchId: number, domainName: string): void {
    this.db
      .prepare<
        [number, string]
      >(`INSERT INTO search_domain (search_id, domain_name) VALUES (?, ?)`)
      .run(searchId, domainName);
  }

  insertDomains(searchId: number, domainNames: string[]): void {
    if (domainNames.length === 0) return;
    const stmt = this.db.prepare<[number, string]>(
      `INSERT INTO search_domain (search_id, domain_name) VALUES (?, ?)`,
    );
    this.db.transaction(() => {
      for (const name of domainNames) stmt.run(searchId, name);
    })();
  }

  initSearch(
    conditionInputs: SearchConditionInput[],
    domainNames: string[],
    total: number,
    contextSize: number,
  ): SearchMetadata {
    return this.db.transaction(() => {
      const searchId = this.insertSearch(total);
      this.insertDomains(searchId, domainNames);
      const conditions: SearchCondition[] = conditionInputs.map((input) => {
        const notRegex = input.notRegexNearby?.source ?? null;
        const id = this.insertCondition(
          searchId,
          input.regex.source,
          notRegex,
          contextSize,
        );
        return {
          id,
          regex: input.regex,
          notRegexNearby: input.notRegexNearby ?? null,
          contextSize,
        };
      });
      return { searchId, domainNames, conditions };
    })();
  }

  // ── Search file ───────────────────────────────────────────────────────────────

  countFiles(filter: SearchFilesFilter): number {
    const {
      searchId,
      similarTo,
      domainFilter,
      conditionFilter,
      reactionFilter,
    } = filter;
    const {
      domainExistsWhere,
      conditionExistsWhere,
      reactionExistsWhere,
      domainParams,
      conditionParams,
      reactionParams,
    } = buildFilterClauses(domainFilter, conditionFilter, reactionFilter);

    if (similarTo) {
      const row = this.db
        .prepare<unknown[], { count: number }>(
          `SELECT COUNT(*) AS count
           FROM search_file sf
           INNER JOIN request r ON r.id = sf.request_id
           WHERE sf.search_id = ? AND sf.context_digest = ?
           ${domainExistsWhere} ${conditionExistsWhere} ${reactionExistsWhere}`,
        )
        .get(
          searchId,
          similarTo,
          ...domainParams,
          ...conditionParams,
          ...reactionParams,
        );
      return row?.count ?? 0;
    }

    const row = this.db
      .prepare<unknown[], { count: number }>(
        `SELECT COUNT(*) AS count
         FROM search_file sf
         INNER JOIN request r ON r.id = sf.request_id
         WHERE sf.search_id = ?
           ${reactionFilter?.length ? '' : 'AND sf.is_duplicate_context_digest = 0'}
         ${domainExistsWhere} ${conditionExistsWhere} ${reactionExistsWhere}`,
      )
      .get(searchId, ...domainParams, ...conditionParams, ...reactionParams);
    return row?.count ?? 0;
  }

  findFilesPage(filter: SearchFilesFilter): SearchFileRow[] {
    const {
      searchId,
      similarTo,
      domainFilter,
      conditionFilter,
      reactionFilter,
      cursor,
    } = filter;
    const {
      domainExistsWhere,
      conditionExistsWhere,
      reactionExistsWhere,
      domainParams,
      conditionParams,
      reactionParams,
    } = buildFilterClauses(domainFilter, conditionFilter, reactionFilter);

    const hasCursor = cursor !== undefined;
    const cursorWhere = hasCursor
      ? `AND (r.resource_version_timestamp, sf.request_id) < (?, ?)`
      : '';
    const cursorParams: (number | string)[] = hasCursor
      ? [cursor!.timestamp, cursor!.requestId]
      : [];

    const RESULTS_PAGE_SIZE = 10;

    if (similarTo) {
      return this.db
        .prepare<unknown[], SearchFileRow>(
          `SELECT sf.id,
                  sf.request_id,
                  r.body_digest,
                  sf.match_count,
                  1 AS duplicate_count,
                  sf.context_digest,
                  sf.resource_version_url,
                  r.resource_version_timestamp
           FROM search_file sf
           INNER JOIN request r ON r.id = sf.request_id
           WHERE sf.search_id = ? AND sf.context_digest = ?
           ${domainExistsWhere} ${conditionExistsWhere} ${reactionExistsWhere}
           ${cursorWhere}
           ORDER BY r.resource_version_timestamp DESC, sf.request_id DESC
           LIMIT ?`,
        )
        .all(
          searchId,
          similarTo,
          ...domainParams,
          ...conditionParams,
          ...reactionParams,
          ...cursorParams,
          RESULTS_PAGE_SIZE,
        );
    }

    const hasReactionFilter = (reactionFilter?.length ?? 0) > 0;
    const duplicateCountExpr = hasReactionFilter
      ? `1`
      : `(SELECT COUNT(*) FROM search_file sf2
              WHERE sf2.context_digest = sf.context_digest AND sf2.search_id = ?)`;

    return this.db
      .prepare<unknown[], SearchFileRow>(
        `SELECT sf.id,
                sf.request_id,
                r.body_digest,
                sf.match_count,
                sf.context_digest,
                sf.resource_version_url,
                r.resource_version_timestamp,
                ${duplicateCountExpr} AS duplicate_count
         FROM search_file sf
         INNER JOIN request r ON r.id = sf.request_id
         WHERE sf.search_id = ?
           ${hasReactionFilter ? '' : 'AND sf.is_duplicate_context_digest = 0'}
           ${domainExistsWhere}
           ${conditionExistsWhere}
           ${reactionExistsWhere}
           ${cursorWhere}
         ORDER BY r.resource_version_timestamp DESC, sf.request_id DESC
         LIMIT ?`,
      )
      .all(
        ...(hasReactionFilter ? [] : [searchId]),
        searchId,
        ...domainParams,
        ...conditionParams,
        ...reactionParams,
        ...cursorParams,
        RESULTS_PAGE_SIZE,
      );
  }

  findMatchesByFileId(
    searchFileId: number,
    conditionFilter: number[] | null,
  ): SearchMatchRow[] {
    const conditionWhere =
      conditionFilter && conditionFilter.length > 0
        ? `AND search_condition_id IN (${conditionFilter.map(() => '?').join(',')})`
        : '';
    return this.db
      .prepare<unknown[], SearchMatchRow>(
        `SELECT id, search_condition_id, match_offset, match_length
         FROM search_match
         WHERE search_file_id = ?
           ${conditionWhere}
         ORDER BY id`,
      )
      .all(searchFileId, ...(conditionFilter ?? []));
  }

  // ── Count facets ─────────────────────────────────────────────────────────────

  countByDomain(params: {
    searchId: number;
    domainFilter?: string[];
    conditionFilter?: number[];
    reactionFilter?: number[];
  }): DomainCountRow[] {
    const { searchId, domainFilter, conditionFilter, reactionFilter } = params;
    const { domainExistsWhere, conditionExistsWhere, reactionExistsWhere } =
      buildFilterClauses(domainFilter, conditionFilter, reactionFilter);
    const domainParams = domainFilter ?? [];
    const conditionParams = conditionFilter ?? [];
    const reactionParams = reactionFilter ?? [];
    const allParams = [
      searchId,
      ...domainParams,
      ...conditionParams,
      ...reactionParams,
    ];
    const activeDomainIds = domainFilter?.length ? domainFilter : null;
    return this.db
      .prepare<unknown[], DomainCountRow>(
        `SELECT rvs.domain_name, COUNT(*) AS count
         FROM search_file sf
         INNER JOIN request r ON r.id = sf.request_id
         INNER JOIN resource_version_source rvs
           ON rvs.url = r.resource_version_url AND rvs.timestamp = r.resource_version_timestamp
         WHERE sf.search_id = ?
           AND sf.is_duplicate_context_digest = 0
         ${activeDomainIds ? `AND rvs.domain_name IN (${activeDomainIds.map(() => '?').join(',')})` : ''}
         ${conditionExistsWhere} ${reactionExistsWhere}
         GROUP BY rvs.domain_name`,
      )
      .all(...allParams);
  }

  countByCondition(params: {
    searchId: number;
    domainFilter?: string[];
    conditionFilter?: number[];
    reactionFilter?: number[];
  }): ConditionCountRow[] {
    const { searchId, domainFilter, conditionFilter, reactionFilter } = params;
    const { domainExistsWhere, reactionExistsWhere } = buildFilterClauses(
      domainFilter,
      conditionFilter,
      reactionFilter,
    );
    const domainParams = domainFilter ?? [];
    const conditionParams = conditionFilter ?? [];
    const reactionParams = reactionFilter ?? [];
    const allParams = [
      searchId,
      ...domainParams,
      ...conditionParams,
      ...reactionParams,
    ];
    const activeConditionIds = conditionFilter?.length ? conditionFilter : null;
    return this.db
      .prepare<unknown[], ConditionCountRow>(
        `SELECT sm.search_condition_id, COUNT(*) AS count
         FROM search_file sf
         INNER JOIN request r ON r.id = sf.request_id
         INNER JOIN search_match sm ON sm.search_file_id = sf.id
         WHERE sf.search_id = ?
           AND sf.is_duplicate_context_digest = 0
         ${domainExistsWhere}
         ${activeConditionIds ? `AND sm.search_condition_id IN (${activeConditionIds.map(() => '?').join(',')})` : ''}
         ${reactionExistsWhere}
         GROUP BY sm.search_condition_id`,
      )
      .all(...allParams);
  }

  countByReactionType(params: {
    searchId: number;
    domainFilter?: string[];
    conditionFilter?: number[];
  }): ReactionCountRow[] {
    const { searchId, domainFilter, conditionFilter } = params;
    const { domainExistsWhere, conditionExistsWhere } = buildFilterClauses(
      domainFilter,
      conditionFilter,
      undefined,
    );
    const baseParams = [
      searchId,
      ...(domainFilter ?? []),
      ...(conditionFilter ?? []),
    ];
    return this.db
      .prepare<unknown[], ReactionCountRow>(
        `SELECT rx.reaction_type_id, COUNT(*) AS count
         FROM search_file sf
         INNER JOIN request r ON r.id = sf.request_id
         INNER JOIN reaction rx
           ON rx.resource_version_url = sf.resource_version_url
          AND rx.resource_version_timestamp = sf.resource_version_timestamp
         WHERE sf.search_id = ?
         ${domainExistsWhere} ${conditionExistsWhere}
         GROUP BY rx.reaction_type_id`,
      )
      .all(...baseParams);
  }

  findSimilarGroupReactions(
    digests: string[],
    searchId: number,
  ): SimilarGroupReactionRow[] {
    if (digests.length === 0) return [];
    return this.db
      .prepare<unknown[], SimilarGroupReactionRow>(
        `SELECT DISTINCT sf2.context_digest, rx.reaction_type_id
         FROM search_file sf2
         INNER JOIN reaction rx
           ON rx.resource_version_url = sf2.resource_version_url
          AND rx.resource_version_timestamp = sf2.resource_version_timestamp
         WHERE sf2.context_digest IN (${digests.map(() => '?').join(',')})
           AND sf2.search_id = ?`,
      )
      .all(...digests, searchId);
  }

  // ── Search scan writes ────────────────────────────────────────────────────────

  insertFile(params: {
    searchId: number;
    requestId: string;
    url: string;
    timestamp: number;
    matchCount: number;
    contextDigest: string;
  }): number {
    const { searchId, requestId, url, timestamp, matchCount, contextDigest } =
      params;
    const result = this.db
      .prepare<
        [number, string, string, number, number, string, string, number]
      >(
        `INSERT INTO search_file
           (search_id, request_id, resource_version_url, resource_version_timestamp,
            match_count, context_digest, is_duplicate_context_digest)
         VALUES (?, ?, ?, ?, ?,
           ?,
           CASE WHEN EXISTS (
             SELECT 1 FROM search_file sf2
             WHERE sf2.context_digest = ? AND sf2.search_id = ?
           ) THEN 1 ELSE 0 END)`,
      )
      .run(
        searchId,
        requestId,
        url,
        timestamp,
        matchCount,
        contextDigest,
        contextDigest,
        searchId,
      );
    return result.lastInsertRowid as number;
  }

  insertFileError(params: {
    searchId: number;
    requestId: string;
    url: string;
    timestamp: number;
    errorName: string;
    errorMessage: string;
  }): void {
    const { searchId, requestId, url, timestamp, errorName, errorMessage } =
      params;
    this.db
      .prepare<[number, string, string, number, string, string]>(
        `INSERT INTO search_file_error
           (search_id, request_id, resource_version_url, resource_version_timestamp,
            error_name, error_message)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(searchId, requestId, url, timestamp, errorName, errorMessage);
  }

  insertMatch(params: {
    searchFileId: number;
    conditionId: number;
    matchOffset: number;
    matchLength: number;
  }): void {
    const { searchFileId, conditionId, matchOffset, matchLength } = params;
    this.db
      .prepare<[number, number, number, number]>(
        `INSERT INTO search_match
           (search_file_id, search_condition_id, match_offset, match_length)
         VALUES (?, ?, ?, ?)`,
      )
      .run(searchFileId, conditionId, matchOffset, matchLength);
  }

  saveMatches(
    searchId: number,
    candidate: HtmlCandidateRow,
    fileMatches: FileMatches,
  ): void {
    this.db.transaction(() => {
      if (fileMatches.matches.length === 0) return;
      const searchFileId = this.insertFile({
        searchId,
        requestId: candidate.request_id,
        url: candidate.resource_version_url,
        timestamp: candidate.resource_version_timestamp,
        matchCount: fileMatches.matches.length,
        contextDigest: fileMatches.contextDigest,
      });
      for (const m of fileMatches.matches) {
        this.insertMatch({
          searchFileId,
          conditionId: m.conditionId,
          matchOffset: m.matchOffset,
          matchLength: m.matchLength,
        });
      }
    })();
  }

  saveFileError(
    searchId: number,
    candidate: HtmlCandidateRow,
    errorName: string,
    errorMessage: string,
  ): void {
    this.insertFileError({
      searchId,
      requestId: candidate.request_id,
      url: candidate.resource_version_url,
      timestamp: candidate.resource_version_timestamp,
      errorName,
      errorMessage,
    });
  }
}

// ── Filter clause builder ──────────────────────────────────────────────────────

function buildFilterClauses(
  domainFilter?: string[],
  conditionFilter?: number[],
  reactionFilter?: number[],
): {
  domainExistsWhere: string;
  conditionExistsWhere: string;
  reactionExistsWhere: string;
  domainParams: string[];
  conditionParams: number[];
  reactionParams: number[];
} {
  const activeDomainIds = domainFilter?.length ? domainFilter : null;
  const activeConditionIds = conditionFilter?.length ? conditionFilter : null;
  const activeReactionTypeIds = reactionFilter?.length ? reactionFilter : null;

  const domainExistsWhere = activeDomainIds
    ? `AND EXISTS (
         SELECT 1 FROM resource_version_source rvs
         WHERE rvs.url = r.resource_version_url
           AND rvs.timestamp = r.resource_version_timestamp
           AND rvs.domain_name IN (${activeDomainIds.map(() => '?').join(',')})
       )`
    : '';

  const conditionExistsWhere = activeConditionIds
    ? `AND EXISTS (
         SELECT 1 FROM search_match sm
         WHERE sm.search_file_id = sf.id
           AND sm.search_condition_id IN (${activeConditionIds.map(() => '?').join(',')})
       )`
    : '';

  const reactionExistsWhere = activeReactionTypeIds
    ? `AND EXISTS (
         SELECT 1 FROM reaction rx
         WHERE rx.resource_version_url = sf.resource_version_url
           AND rx.resource_version_timestamp = sf.resource_version_timestamp
           AND rx.reaction_type_id IN (${activeReactionTypeIds.map(() => '?').join(',')})
       )`
    : '';

  return {
    domainExistsWhere,
    conditionExistsWhere,
    reactionExistsWhere,
    domainParams: activeDomainIds ?? [],
    conditionParams: activeConditionIds ?? [],
    reactionParams: activeReactionTypeIds ?? [],
  };
}
