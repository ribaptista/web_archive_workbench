import fs from 'fs';
import path from 'path';
import type { Database as DB } from 'better-sqlite3';
import type { Eta } from 'eta';
import { nestedIdPath } from './id-path';

const RESULTS_PAGE_SIZE = 50;
const CONTEXT_LENGTH = 256;

interface SearchRow {
  id: number;
  created_at: string;
  char_encoding: string;
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

export function renderSearchResults(
  searchId: number,
  page: number,
  db: DB,
  eta: Eta,
  baseFolder: string,
  similarTo?: string,
  filterDomains?: string[],
  filterConditionIds?: number[],
  filterReactionTypeIds?: number[],
): string {
  const search = db
    .prepare<[number], SearchRow>(
      `SELECT id, created_at, char_encoding, status,
              file_count, scanned_file_count, error_name, error_message
       FROM search WHERE id = ?`,
    )
    .get(searchId);

  if (!search) {
    return '<h1>Search not found</h1>';
  }

  const conditions = db
    .prepare<[number], ConditionRow>(
      `SELECT id, regex, not_regex_nearby, context_size
       FROM search_condition WHERE search_id = ? ORDER BY id`,
    )
    .all(searchId);

  const searchScopeDomains = db
    .prepare<[number], DomainRow>(
      `SELECT cf.id, cf.domain
       FROM search_domain sd
       JOIN cdx_file cf ON cf.id = sd.cdx_file_id
       WHERE sd.search_id = ?
       ORDER BY cf.domain`,
    )
    .all(searchId);
  const domains: DomainRow[] =
    searchScopeDomains.length > 0
      ? searchScopeDomains
      : db
          .prepare<
            [],
            DomainRow
          >(`SELECT id, domain FROM cdx_file ORDER BY domain`)
          .all();

  const activeDomainIds = filterDomains?.length ? filterDomains : null;
  const activeConditionIds = filterConditionIds?.length
    ? filterConditionIds
    : null;

  const domainJoin = activeDomainIds
    ? `INNER JOIN resource_version_source rvs_filter
         ON rvs_filter.url = r.resource_version_url
        AND rvs_filter.timestamp = r.resource_version_timestamp`
    : '';
  const domainWhere = activeDomainIds
    ? `AND rvs_filter.cdx_id IN (${activeDomainIds.map(() => '?').join(',')})`
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
         WHERE rx.body_digest = r.body_digest
           AND rx.reaction_type_id IN (${activeReactionTypeIds.map(() => '?').join(',')})
       )`
    : '';

  const domainParams: string[] = activeDomainIds ?? [];
  const conditionParams: number[] = activeConditionIds ?? [];
  const reactionParams: number[] = activeReactionTypeIds ?? [];

  const totalFiles = similarTo
    ? (db
        .prepare<unknown[], { count: number }>(
          `SELECT COUNT(*) as count
           FROM search_file sf
           INNER JOIN request r ON r.id = sf.request_id
           ${domainJoin}
           WHERE sf.search_id = ? AND sf.context_digest = ?
           ${domainWhere} ${conditionExistsWhere} ${reactionExistsWhere}`,
        )
        .get(
          searchId,
          similarTo,
          ...domainParams,
          ...conditionParams,
          ...reactionParams,
        )?.count ?? 0)
    : (db
        .prepare<unknown[], { count: number }>(
          `SELECT COUNT(DISTINCT sf.context_digest) AS count
           FROM search_file sf
           INNER JOIN request r ON r.id = sf.request_id
           ${domainJoin}
           WHERE sf.search_id = ? AND sf.match_count > 0
           ${domainWhere} ${conditionExistsWhere} ${reactionExistsWhere}`,
        )
        .get(searchId, ...domainParams, ...conditionParams, ...reactionParams)
        ?.count ?? 0);

  const totalPages = Math.max(1, Math.ceil(totalFiles / RESULTS_PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const offset = (safePage - 1) * RESULTS_PAGE_SIZE;

  const files = similarTo
    ? db
        .prepare<unknown[], SearchFileRow>(
          `SELECT sf.id,
                  sf.request_id,
                  r.body_digest,
                  sf.match_count,
                  1 AS duplicate_count,
                  sf.context_digest
           FROM search_file sf
           INNER JOIN request r ON r.id = sf.request_id
           ${domainJoin}
           WHERE sf.search_id = ?
           AND sf.context_digest = ?
           ${domainWhere} ${conditionExistsWhere} ${reactionExistsWhere}
           ORDER BY r.resource_version_timestamp DESC
           LIMIT ?
           OFFSET ?`,
        )
        .all(
          searchId,
          similarTo,
          ...domainParams,
          ...conditionParams,
          ...reactionParams,
          RESULTS_PAGE_SIZE,
          offset,
        )
    : db
        .prepare<unknown[], SearchFileRow>(
          `WITH ranked AS (
             SELECT
               sf.id,
               sf.context_digest,
               sf.match_count,
               r.id AS rid,
               r.body_digest,
               r.resource_version_timestamp AS timestamp,
               COUNT(*) OVER (PARTITION BY sf.context_digest) AS duplicate_count,
               ROW_NUMBER() OVER (
                 PARTITION BY sf.context_digest
                 ORDER BY r.resource_version_timestamp DESC
               ) AS rn
             FROM search_file sf
             INNER JOIN request r ON r.id = sf.request_id
             ${domainJoin}
             WHERE sf.search_id = ?
             AND sf.match_count > 0
             ${domainWhere} 
             ${conditionExistsWhere}
             ${reactionExistsWhere}
           )
           SELECT
             id,
             rid AS request_id,
             body_digest,
             match_count,
             duplicate_count,
             context_digest
           FROM ranked
           WHERE rn = 1
           ORDER BY timestamp DESC
           LIMIT ? OFFSET ?`,
        )
        .all(
          searchId,
          ...domainParams,
          ...conditionParams,
          ...reactionParams,
          RESULTS_PAGE_SIZE,
          offset,
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

  const filesWithData = files.map((file) => {
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
        fileContent = fs.readFileSync(
          filePath,
          search.char_encoding as BufferEncoding,
        );
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
      original: cdxEntry?.original ?? '',
      timestamp: cdxEntry?.timestamp ?? '',
      fileError,
      contextWindows,
    };
  });

  const reactionTypes = db
    .prepare<
      [],
      ReactionTypeRow
    >(`SELECT id, label, emoji FROM reaction_type ORDER BY id`)
    .all();

  const bodyDigests = [
    ...new Set(filesWithData.map((f) => f.body_digest).filter(Boolean)),
  ];
  const activeReactions: Set<string> =
    bodyDigests.length > 0
      ? new Set(
          db
            .prepare<
              unknown[],
              { reaction_type_id: number; body_digest: string }
            >(
              `SELECT reaction_type_id, body_digest
               FROM reaction
               WHERE body_digest IN (${bodyDigests.map(() => '?').join(',')})`,
            )
            .all(...bodyDigests)
            .map((r) => `${r.body_digest}:${r.reaction_type_id}`),
        )
      : new Set();

  const html = eta.render('./search_results', {
    search,
    conditions,
    domains,
    files: filesWithData,
    highlightMatches,
    totalFiles,
    totalPages,
    currentPage: safePage,
    searchId,
    similarTo: similarTo ?? null,
    isPending: search.status === 'pending' || search.status === 'running',
    filterDomains: activeDomainIds ?? [],
    filterConditionIds: activeConditionIds ?? [],
    filterReactionTypeIds: activeReactionTypeIds ?? [],
    reactionTypes,
    activeReactions: [...activeReactions],
  });

  return html ?? '<h1>Template rendering error</h1>';
}
