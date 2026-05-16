import path from 'path';
import type { Eta } from 'eta';
import { buildAssetPath } from '../request/paths';
import fs from 'fs';
import { SearchRepository } from './repository';
import { ReactionRepository } from '../reaction/repository';
import { RequestRepository } from '../request/repository';
import { CdxRepository } from '../cdx/repository';

const RESULTS_PAGE_SIZE = 10;
const CONTEXT_LENGTH = 256;

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
  searchRepo: SearchRepository,
  reactionRepo: ReactionRepository,
  cdxRepo: CdxRepository,
  reqRepo: RequestRepository,
  baseFolder: string,
  similarTo?: string,
  filterDomains?: string[],
  filterConditionIds?: number[],
  filterReactionTypeIds?: number[],
) {
  const search = t('search', () => searchRepo.findById(searchId));

  if (!search) {
    return null;
  }

  const conditions = t('conditions', () =>
    searchRepo.findConditionsBySearchId(searchId),
  );

  const searchScopeDomains = t('searchScopeDomains', () =>
    searchRepo.findDomainsBySearchId(searchId),
  );
  const domains =
    searchScopeDomains.length > 0
      ? searchScopeDomains
      : t('cdx_file_all', () => cdxRepo.findAllDomains());

  const activeDomainIds = filterDomains?.length ? filterDomains : null;
  const activeConditionIds = filterConditionIds?.length
    ? filterConditionIds
    : null;
  const activeReactionTypeIds = filterReactionTypeIds?.length
    ? filterReactionTypeIds
    : null;

  const domainParams: string[] = activeDomainIds ?? [];
  const conditionParams: number[] = activeConditionIds ?? [];
  const reactionParams: number[] = activeReactionTypeIds ?? [];

  const hasCursor =
    cursorTimestamp !== undefined && cursorRequestId !== undefined;

  const fileFilter = {
    searchId,
    similarTo,
    domainFilter: activeDomainIds ?? undefined,
    conditionFilter: activeConditionIds ?? undefined,
    reactionFilter: activeReactionTypeIds ?? undefined,
    cursor: hasCursor
      ? { timestamp: cursorTimestamp!, requestId: cursorRequestId! }
      : undefined,
  };

  const totalFiles = t('totalFiles', () => searchRepo.countFiles(fileFilter));

  const files = t('files', () => searchRepo.findFilesPage(fileFilter));

  const filesWithData = t('filesWithData', () =>
    files.map((file) => {
      const cdxEntry = reqRepo.findCdxInfoByRequestId(file.request_id);
      const rawMatches = searchRepo.findMatchesByFileId(
        file.id,
        activeConditionIds,
      );

      let fileContent: string | null = null;
      let fileError: string | null = null;
      if (!cdxEntry?.domain || !file.body_digest) {
        fileError = `Missing domain or body_digest for request_id=${file.request_id}`;
        console.error(`[search ${searchId}] ${fileError}`);
      } else {
        const filePath = buildAssetPath(baseFolder, file.body_digest) + '.text';
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

  const reactionTypes = t('reactionTypes', () => reactionRepo.findAllTypes());

  // Active reactions for this page's exact url+timestamp entries
  const activeReactions: Set<string> =
    filesWithData.length > 0
      ? new Set(
          t('activeReactions', () =>
            reactionRepo.findActiveForPages(filesWithData),
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
        searchRepo.findSimilarGroupReactions(digestsWithDupes, searchId),
      );
      for (const row of rows) {
        (similarGroupReactions[row.context_digest] ??= []).push(
          row.reaction_type_id,
        );
      }
    }
  }

  const facetParams = {
    searchId,
    domainFilter: activeDomainIds ?? undefined,
    conditionFilter: activeConditionIds ?? undefined,
    reactionFilter: activeReactionTypeIds ?? undefined,
  };

  const countsByDomain = similarTo
    ? {}
    : Object.fromEntries(
        t('countsByDomain', () => searchRepo.countByDomain(facetParams)).map(
          (row) => [row.domain_name, row.count],
        ),
      );

  const countsByConditionRows = similarTo
    ? []
    : t('countsByCondition', () => searchRepo.countByCondition(facetParams));

  const countsByReactionRows = similarTo
    ? []
    : t('countsByReaction', () =>
        searchRepo.countByReactionType({
          searchId,
          domainFilter: activeDomainIds ?? undefined,
          conditionFilter: activeConditionIds ?? undefined,
        }),
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
  searchRepo: SearchRepository,
  reactionRepo: ReactionRepository,
  cdxRepo: CdxRepository,
  reqRepo: RequestRepository,
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
    searchRepo,
    reactionRepo,
    cdxRepo,
    reqRepo,
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
