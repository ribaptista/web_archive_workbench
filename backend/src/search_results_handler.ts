import path from 'path';
import type { Database as DB } from 'better-sqlite3';
import type { Eta } from 'eta';
import { nestedIdPath } from './id-path';
import fs from 'fs';

const RESULTS_PAGE_SIZE = 10;
const CONTEXT_LENGTH = 256;

interface SearchRow {
  id: number;
  created_at: string;
  status: string;
  file_count: number;
  scanned_file_count: number;
  error_name: string | null;
  error_message: string | null;
}

interface ConditionRow {
  id: number;
  regex: string;
  not_regex_nearby: string | null;
  context_size: number;
}

interface SearchFileRow {
  id: number;
  request_id: string;
  body_digest: string;
  match_count: number;
  duplicate_count: number;
  context_digest: string | null;
  resource_version_url: string;
  resource_version_timestamp: number;
}

interface MatchRow {
  id: number;
  search_condition_id: number;
  match_offset: number;
  match_length: number;
}

interface ContextMatch extends MatchRow {
  offset_in_context: number;
}

interface ContextWindow {
  context: string;
  matches: ContextMatch[];
}

interface CdxEntryRow {
  original: string;
  timestamp: string;
  domain: string;
}

interface DomainRow {
  id: string;
  domain: string;
}

interface ReactionTypeRow {
  id: number;
  label: string;
  emoji: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function highlightMatches(
  context: string,
  matches: { offset_in_context: number; match_length: number }[],
): string {
  const sorted = [...matches].sort(
    (a, b) => a.offset_in_context - b.offset_in_context,
  );
  let result = '';
  let pos = 0;
  for (const m of sorted) {
    result += escapeHtml(context.slice(pos, m.offset_in_context));
    result += `<strong>${escapeHtml(context.slice(m.offset_in_context, m.offset_in_context + m.match_length))}</strong>`;
    pos = m.offset_in_context + m.match_length;
  }
  result += escapeHtml(context.slice(pos));
  return result;
}

function mergeContextWindows(
  fileContent: string,
  rawMatches: MatchRow[],
  contextLength: number,
): ContextWindow[] {
  if (rawMatches.length === 0) return [];

  const sorted = [...rawMatches].sort(
    (a, b) => a.match_offset - b.match_offset,
  );
  const windows: { ctxStart: number; ctxEnd: number; matches: MatchRow[] }[] =
    [];

  for (const m of sorted) {
    const ctxStart = Math.max(0, m.match_offset - contextLength);
    const ctxEnd = Math.min(
      fileContent.length,
      m.match_offset + m.match_length + contextLength,
    );
    if (windows.length > 0 && ctxStart <= windows[windows.length - 1].ctxEnd) {
      const last = windows[windows.length - 1];
      last.ctxEnd = Math.max(last.ctxEnd, ctxEnd);
      last.matches.push(m);
    } else {
      windows.push({ ctxStart, ctxEnd, matches: [m] });
    }
  }

  return windows.map(({ ctxStart, ctxEnd, matches }) => ({
    context: fileContent.slice(ctxStart, ctxEnd),
    matches: matches.map((m) => ({
      ...m,
      offset_in_context: m.match_offset - ctxStart,
    })),
  }));
}

function t<T>(label: string, fn: () => T): T {
  const start = Date.now();
  const result = fn();
  console.log(`[search_results] ${label}: ${Date.now() - start}ms`);
  return result;
}

export function getSearchResultsData(
  searchId: number,
  cursorTimestamp: number | undefined,
  cursorRequestId: string | undefined,
  db: DB,
  baseFolder: string,
  similarTo?: string,
  filterDomains?: string[],
  filterConditionIds?: number[],
  filterReactionTypeIds?: number[],
) {
  const search = t('search', () =>
    db
      .prepare<[number], SearchRow>(
        `SELECT id, created_at, status,
              file_count, scanned_file_count, error_name, error_message
       FROM search WHERE id = ?`,
      )
      .get(searchId),
  );

  if (!search) {
    return null;
  }

  const conditions = t('conditions', () =>
    db
      .prepare<[number], ConditionRow>(
        `SELECT id, regex, not_regex_nearby, context_size
       FROM search_condition WHERE search_id = ? ORDER BY id`,
      )
      .all(searchId),
  );

  const searchScopeDomains = t('searchScopeDomains', () =>
    db
      .prepare<[number], DomainRow>(
        `SELECT cf.id, cf.domain
       FROM search_domain sd
       JOIN cdx_file cf ON cf.id = sd.cdx_file_id
       WHERE sd.search_id = ?
       ORDER BY cf.domain`,
      )
      .all(searchId),
  );
  const domains: DomainRow[] =
    searchScopeDomains.length > 0
      ? searchScopeDomains
      : t('cdx_file_all', () =>
          db
            .prepare<
              [],
              DomainRow
            >(`SELECT id, domain FROM cdx_file ORDER BY domain`)
            .all(),
        );

  const activeDomainIds = filterDomains?.length ? filterDomains : null;
  const activeConditionIds = filterConditionIds?.length
    ? filterConditionIds
    : null;

  const domainExistsWhere = activeDomainIds
    ? `AND EXISTS (
         SELECT 1 FROM resource_version_source rvs
         WHERE rvs.url = r.resource_version_url
           AND rvs.timestamp = r.resource_version_timestamp
           AND rvs.cdx_id IN (${activeDomainIds.map(() => '?').join(',')})
       )`
    : '';
  const conditionExistsWhere = activeConditionIds
    ? `AND EXISTS (
         SELECT 1 FROM search_match sm
         WHERE sm.search_file_id = sf.id
           AND sm.search_condition_id IN (${activeConditionIds.map(() => '?').join(',')})
       )`
    : '';
  const activeReactionTypeIds = filterReactionTypeIds?.length
    ? filterReactionTypeIds
    : null;
  const reactionExistsWhere = activeReactionTypeIds
    ? `AND EXISTS (
         SELECT 1 FROM reaction rx
         WHERE rx.resource_version_url = sf.resource_version_url
           AND rx.resource_version_timestamp = sf.resource_version_timestamp
           AND rx.reaction_type_id IN (${activeReactionTypeIds.map(() => '?').join(',')})
       )`
    : '';

  const domainParams: string[] = activeDomainIds ?? [];
  const conditionParams: number[] = activeConditionIds ?? [];
  const reactionParams: number[] = activeReactionTypeIds ?? [];

  const hasCursor =
    cursorTimestamp !== undefined && cursorRequestId !== undefined;
  const cursorWhere = hasCursor
    ? `AND (r.resource_version_timestamp, sf.request_id) < (?, ?)`
    : '';
  const cursorParams: (number | string)[] = hasCursor
    ? [cursorTimestamp!, cursorRequestId!]
    : [];

  const totalFiles = similarTo
    ? (t('totalFiles(similarTo)', () =>
        db
          .prepare<unknown[], { count: number }>(
            `SELECT COUNT(*) as count
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
          ),
      )?.count ?? 0)
    : (t('totalFiles', () =>
        db
          .prepare<unknown[], { count: number }>(
            `SELECT COUNT(*) AS count
           FROM search_file sf
           INNER JOIN request r ON r.id = sf.request_id
           WHERE sf.search_id = ?
             ${activeReactionTypeIds ? '' : 'AND sf.is_duplicate_context_digest = 0'}
           ${domainExistsWhere} ${conditionExistsWhere} ${reactionExistsWhere}`,
          )
          .get(
            searchId,
            ...domainParams,
            ...conditionParams,
            ...reactionParams,
          ),
      )?.count ?? 0);

  const files = similarTo
    ? t('files(similarTo)', () =>
        db
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
           WHERE sf.search_id = ?
           AND sf.context_digest = ?
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
          ),
      )
    : t('files', () =>
        db
          .prepare<unknown[], SearchFileRow>(
            `SELECT
               sf.id,
               sf.request_id,
               r.body_digest,
               sf.match_count,
               sf.context_digest,
               sf.resource_version_url,
               r.resource_version_timestamp,
               ${
                 activeReactionTypeIds
                   ? '1'
                   : `(SELECT COUNT(*) FROM search_file sf2
                WHERE sf2.context_digest = sf.context_digest AND sf2.search_id = ?)`
               } AS duplicate_count
             FROM search_file sf
             INNER JOIN request r ON r.id = sf.request_id
             WHERE sf.search_id = ?
               ${activeReactionTypeIds ? '' : 'AND sf.is_duplicate_context_digest = 0'}
               ${domainExistsWhere}
               ${conditionExistsWhere}
               ${reactionExistsWhere}
               ${cursorWhere}
             ORDER BY r.resource_version_timestamp DESC, sf.request_id DESC
             LIMIT ?`,
          )
          .all(
            ...(activeReactionTypeIds ? [] : [searchId]),
            searchId,
            ...domainParams,
            ...conditionParams,
            ...reactionParams,
            ...cursorParams,
            RESULTS_PAGE_SIZE,
          ),
      );

  const matchConditionWhere = activeConditionIds
    ? `AND search_condition_id IN (${activeConditionIds.map(() => '?').join(',')})`
    : '';
  const matchStmt = db.prepare<unknown[], MatchRow>(
    `SELECT id, search_condition_id, match_offset, match_length
     FROM search_match
     WHERE search_file_id = ?
       ${matchConditionWhere}
     ORDER BY id`,
  );
  const cdxStmt = db.prepare<[string], CdxEntryRow>(
    `SELECT r.resource_version_url AS original,
            r.resource_version_timestamp AS timestamp,
            cf.domain
     FROM request r
     JOIN resource_version_source rvs
       ON rvs.url = r.resource_version_url
      AND rvs.timestamp = r.resource_version_timestamp
     JOIN cdx_file cf ON cf.id = rvs.cdx_id
     WHERE r.id = ?
     LIMIT 1`,
  );

  const filesWithData = t('filesWithData', () =>
    files.map((file) => {
      const cdxEntry = cdxStmt.get(file.request_id);
      const rawMatches = matchStmt.all(file.id, ...conditionParams);

      let fileContent: string | null = null;
      let fileError: string | null = null;
      if (!cdxEntry?.domain || !file.body_digest) {
        fileError = `Missing domain or body_digest for request_id=${file.request_id}`;
        console.error(`[search ${searchId}] ${fileError}`);
      } else {
        const filePath =
          nestedIdPath(path.join(baseFolder, 'assets'), file.body_digest, 2) +
          '.text';
        try {
          fileContent = fs.readFileSync(filePath, 'utf8');
        } catch (err) {
          fileError = `Could not read plain_text file: ${(err as Error).message}`;
          console.error(`[search ${searchId}] ${fileError}`);
        }
      }

      const contextWindows =
        fileContent === null
          ? []
          : mergeContextWindows(fileContent, rawMatches, CONTEXT_LENGTH);

      return {
        ...file,
        resource_version_url: file.resource_version_url,
        resource_version_timestamp: file.resource_version_timestamp,
        original: cdxEntry?.original ?? '',
        timestamp: cdxEntry?.timestamp ?? '',
        fileError,
        contextWindows,
      };
    }),
  );

  const reactionTypes = t('reactionTypes', () =>
    db
      .prepare<
        [],
        ReactionTypeRow
      >(`SELECT id, label, emoji FROM reaction_type ORDER BY id`)
      .all(),
  );

  // Active reactions for this page's exact url+timestamp entries
  const activeReactions: Set<string> =
    filesWithData.length > 0
      ? new Set(
          t('activeReactions', () =>
            db
              .prepare<
                unknown[],
                {
                  reaction_type_id: number;
                  resource_version_url: string;
                  resource_version_timestamp: number;
                }
              >(
                `SELECT reaction_type_id, resource_version_url, resource_version_timestamp
               FROM reaction
               WHERE (resource_version_url, resource_version_timestamp) IN (${filesWithData.map(() => '(?,?)').join(',')})`,
              )
              .all(
                ...filesWithData.flatMap((f) => [
                  f.resource_version_url,
                  f.resource_version_timestamp,
                ]),
              ),
          ).map(
            (r) =>
              `${r.resource_version_url}|${r.resource_version_timestamp}:${r.reaction_type_id}`,
          ),
        )
      : new Set();

  // For non-similarTo view: for files that are non-duplicate representatives,
  // check if any item in their context_digest group has a reaction
  const similarGroupReactions: Record<string, number[]> = {};
  if (!similarTo && !activeReactionTypeIds && filesWithData.length > 0) {
    const digestsWithDupes = filesWithData
      .filter((f) => (f.duplicate_count ?? 0) > 1 && f.context_digest)
      .map((f) => f.context_digest as string);
    if (digestsWithDupes.length > 0) {
      const rows = t('similarGroupReactions', () =>
        db
          .prepare<
            unknown[],
            { context_digest: string; reaction_type_id: number }
          >(
            `SELECT DISTINCT sf2.context_digest, rx.reaction_type_id
             FROM search_file sf2
             INNER JOIN reaction rx
               ON rx.resource_version_url = sf2.resource_version_url
              AND rx.resource_version_timestamp = sf2.resource_version_timestamp
             WHERE sf2.context_digest IN (${digestsWithDupes.map(() => '?').join(',')})
               AND sf2.search_id = ?`,
          )
          .all(...digestsWithDupes, searchId),
      );
      for (const row of rows) {
        (similarGroupReactions[row.context_digest] ??= []).push(
          row.reaction_type_id,
        );
      }
    }
  }

  const baseParams = [searchId, ...domainParams, ...conditionParams];
  const allParams = [...baseParams, ...reactionParams];

  const countsByDomain = similarTo
    ? {}
    : Object.fromEntries(
        t('countsByDomain', () =>
          db
            .prepare<unknown[], { cdx_id: string; count: number }>(
              `SELECT rvs.cdx_id, COUNT(*) AS count
             FROM search_file sf
             INNER JOIN request r ON r.id = sf.request_id
             INNER JOIN resource_version_source rvs
               ON rvs.url = r.resource_version_url AND rvs.timestamp = r.resource_version_timestamp
             WHERE sf.search_id = ?
               AND sf.is_duplicate_context_digest = 0
             ${activeDomainIds ? `AND rvs.cdx_id IN (${activeDomainIds.map(() => '?').join(',')})` : ''}
             ${conditionExistsWhere} ${reactionExistsWhere}
             GROUP BY rvs.cdx_id`,
            )
            .all(...allParams),
        ).map((row) => [row.cdx_id, row.count]),
      );

  const countsByConditionRows = similarTo
    ? []
    : t('countsByCondition', () =>
        db
          .prepare<unknown[], { search_condition_id: number; count: number }>(
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
          .all(...allParams),
      );

  const countsByReactionRows = similarTo
    ? []
    : t('countsByReaction', () =>
        db
          .prepare<unknown[], { reaction_type_id: number; count: number }>(
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
          .all(...baseParams),
      );

  const lastFile = files.length > 0 ? files[files.length - 1] : null;
  const nextCursor =
    files.length === RESULTS_PAGE_SIZE && lastFile
      ? {
          timestamp: lastFile.resource_version_timestamp,
          requestId: lastFile.request_id,
        }
      : null;

  return {
    search,
    conditions,
    domains,
    files: filesWithData,
    totalFiles,
    nextCursor,
    searchId,
    similarTo: similarTo ?? null,
    isPending: search.status === 'pending' || search.status === 'running',
    filterDomains: activeDomainIds ?? [],
    filterConditionIds: activeConditionIds ?? [],
    filterReactionTypeIds: activeReactionTypeIds ?? [],
    reactionTypes,
    activeReactions: [...activeReactions],
    similarGroupReactions,
    countsByDomain,
    countsByCondition: Object.fromEntries(
      countsByConditionRows.map((r) => [r.search_condition_id, r.count]),
    ),
    countsByReaction: Object.fromEntries(
      countsByReactionRows.map((r) => [r.reaction_type_id, r.count]),
    ),
  };
}

export function renderSearchResults(
  searchId: number,
  cursorTimestamp: number | undefined,
  cursorRequestId: string | undefined,
  db: DB,
  eta: Eta,
  baseFolder: string,
  similarTo?: string,
  filterDomains?: string[],
  filterConditionIds?: number[],
  filterReactionTypeIds?: number[],
): string {
  const data = getSearchResultsData(
    searchId,
    cursorTimestamp,
    cursorRequestId,
    db,
    baseFolder,
    similarTo,
    filterDomains,
    filterConditionIds,
    filterReactionTypeIds,
  );
  if (!data) return '<h1>Search not found</h1>';
  const html = eta.render('./search_results', { ...data, highlightMatches });
  return html ?? '<h1>Template rendering error</h1>';
}
