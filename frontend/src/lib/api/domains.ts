import { fetchJson } from './fetch_json';

export interface Domain {
  name: string;
}

export async function fetchDomains(): Promise<Domain[]> {
  return fetchJson<Domain[]>('/api/domains/');
}

export interface DomainStats {
  name: string;
  resources: number;
  successful_entry_count: number;
  errored_entry_count: number;
  pending_entry_count: number;
}

export async function fetchDomainStats(): Promise<DomainStats[]> {
  return fetchJson<DomainStats[]>('/api/domains/stats');
}

export interface FilterOption {
  error_code: string;
  error_name: string;
}

export async function fetchDomainErrorFilters(
  domain: string,
): Promise<FilterOption[]> {
  return fetchJson<FilterOption[]>(
    `/api/domains/error_filters?domain=${encodeURIComponent(domain)}`,
  );
}

export interface ErrorCursor {
  url: string;
  timestamp: number;
}

export interface ErrorDetail {
  error_code: string;
  error_name: string;
  error_message: string;
}

export interface ErrorEntry {
  url: string;
  timestamp: number;
  errors: ErrorDetail[];
}

export interface DomainErrorsParams {
  domain: string;
  errorCodes?: string[];
  errorNames?: string[];
  cursor?: ErrorCursor | null;
}

export interface DomainErrorsData {
  domain: string;
  entries: ErrorEntry[];
  nextCursor: ErrorCursor | null;
}

export async function fetchDomainErrors(
  params: DomainErrorsParams,
): Promise<DomainErrorsData> {
  const q = new URLSearchParams({ domain: params.domain });
  for (const code of params.errorCodes ?? []) q.append('error_code[]', code);
  for (const name of params.errorNames ?? []) q.append('error_name[]', name);
  if (params.cursor) {
    q.set('cursor_url', params.cursor.url);
    q.set('cursor_ts', String(params.cursor.timestamp));
  }
  return fetchJson<DomainErrorsData>(`/api/domains/errors?${q}`);
}
