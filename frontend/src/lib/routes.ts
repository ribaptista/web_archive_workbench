/**
 * Centralized route builders for all app pages.
 * Each function returns a relative URL string ready for router.push().
 */

export function resourcesRoute(path?: string, level?: number): string {
  if (path === undefined) return '/resources';
  const u = new URLSearchParams({ path });
  if (level !== undefined) u.set('level', String(level));
  return `/resources?${u}`;
}

export function listVersionsRoute(url: string): string {
  return `/list_versions?url=${encodeURIComponent(url)}`;
}

export interface SearchResultsCursor {
  timestamp: number | string;
  requestId: string;
}

export interface SearchResultsRouteParams {
  searchId: number | string;
  similarTo?: string | null;
  domains?: Iterable<string>;
  conditionIds?: Iterable<number | string>;
  reactionTypeIds?: Iterable<number | string>;
  cursor?: SearchResultsCursor | null;
}

export function searchResultsRoute({
  searchId,
  similarTo,
  domains,
  conditionIds,
  reactionTypeIds,
  cursor,
}: SearchResultsRouteParams): string {
  const u = new URLSearchParams();
  u.set('search_id', String(searchId));
  if (similarTo) u.set('similar_to', similarTo);
  if (domains) for (const d of domains) u.append('domain[]', d);
  if (conditionIds)
    for (const id of conditionIds) u.append('condition_id[]', String(id));
  if (reactionTypeIds)
    for (const id of reactionTypeIds)
      u.append('reaction_type_id[]', String(id));
  if (cursor) {
    u.set('cursor_timestamp', String(cursor.timestamp));
    u.set('cursor_request_id', cursor.requestId);
  }
  return `/search_results?${u}`;
}

export function reactionsViewRoute(
  reactionTypeId: number,
  page: number,
  selectedDomains: Set<string>,
): string {
  const u = new URLSearchParams({
    reaction_type_id: String(reactionTypeId),
    page: String(page),
  });
  for (const id of selectedDomains) u.append('domain[]', id);
  return `/reactions_view?${u}`;
}

export function domainErrorsRoute(
  domain: string,
  selectedCodes: Set<string>,
  selectedNames: Set<string>,
): string {
  const u = new URLSearchParams({ domain });
  for (const code of selectedCodes) u.append('error_code[]', code);
  for (const name of selectedNames) u.append('error_name[]', name);
  return `/domain_errors?${u}`;
}
