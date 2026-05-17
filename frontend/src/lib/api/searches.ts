export interface SearchResultsParams {
  searchId: number;
  cursorTimestamp?: number;
  cursorRequestId?: string;
  similarTo?: string;
  filterDomains?: string[];
  filterConditionIds?: number[];
  filterReactionTypeIds?: number[];
}

export async function fetchSearchResults<T>(
  params: SearchResultsParams,
): Promise<T> {
  const q = new URLSearchParams();
  if (params.cursorTimestamp !== undefined)
    q.set('cursor_timestamp', String(params.cursorTimestamp));
  if (params.cursorRequestId !== undefined)
    q.set('cursor_request_id', params.cursorRequestId);
  if (params.similarTo) q.set('similar_to', params.similarTo);
  for (const d of params.filterDomains ?? []) q.append('domain[]', d);
  for (const id of params.filterConditionIds ?? [])
    q.append('condition_id[]', String(id));
  for (const id of params.filterReactionTypeIds ?? [])
    q.append('reaction_type_id[]', String(id));
  const res = await fetch(`/api/searches/${params.searchId}/results?${q}`);
  if (!res.ok) throw new Error(res.statusText);
  return res.json();
}

export interface SearchCondition {
  regex: string;
  not_regex_nearby: string | null;
}

export interface Search {
  id: number;
  created_at: string;
  status: string;
  file_count: number;
  scanned_file_count: number;
  error_message: string | null;
  match_file_count: number;
  conditions: SearchCondition[];
  domains: string[];
}

export interface SearchesData {
  searches: Search[];
  hasRunning: boolean;
}

export async function fetchSearches(): Promise<SearchesData> {
  const res = await fetch('/api/searches/');
  if (!res.ok) throw new Error(res.statusText);
  return res.json();
}

export interface CreateSearchParams {
  conditions: { regex: string; notRegexNearby: string }[];
  domainIds: string[];
}

export async function createSearch(
  params: CreateSearchParams,
): Promise<{ searchId: number }> {
  const body = new URLSearchParams();
  for (const c of params.conditions) {
    body.append('regex[]', c.regex);
    body.append('not_regex_nearby[]', c.notRegexNearby);
  }
  for (const id of params.domainIds) {
    body.append('cdx_file_id[]', id);
  }
  const res = await fetch('/api/searches/', { method: 'POST', body });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? 'Server error');
  }
  return res.json();
}

export async function deleteSearch(id: number): Promise<void> {
  const res = await fetch(`/api/searches/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(res.statusText);
}
