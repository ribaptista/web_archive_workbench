import { fetchJson } from './fetch_json';

export interface RunArg {
  arg_name: string;
  arg_value: string;
}

export interface DomainCount {
  domain: string;
  count: number;
}

export interface ErrorType {
  domain: string;
  error_name: string;
  error_code: string;
  count: number;
}

export interface RunStats {
  id: string;
  created_at: string;
  args: RunArg[];
  new_entry_count: number;
  requested_total: number;
  requested_by_domain: DomainCount[];
  downloaded_total: number;
  downloaded_by_domain: DomainCount[];
  errors_total: number;
  errors_by_domain: DomainCount[];
  errors_by_type: ErrorType[];
}

export async function fetchRuns(): Promise<RunStats[]> {
  return fetchJson<RunStats[]>('/api/runs/');
}
