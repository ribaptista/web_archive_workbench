import type { ContextWindow, ReactionType } from '../shared';

export interface SearchInfo {
  id: number;
  created_at: string;
  status: string;
  file_count: number;
  scanned_file_count: number;
  error_message: string | null;
}

export interface Condition {
  id: number;
  regex: string;
  not_regex_nearby: string | null;
}

/** Domain entry inside a SearchResultsData payload. */
export interface SearchDomain {
  name: string;
}

export type FileResult = {
  id: number;
  request_id: string;
  resource_version_url: string;
  resource_version_timestamp: number;
  body_digest: string;
  match_count: number;
  duplicate_count: number;
  context_digest: string;
} & ({ fileError: string } | { contextWindows: ContextWindow[] });

export interface Cursor {
  timestamp: number;
  requestId: string;
}

export interface SearchResultsData {
  search: SearchInfo;
  conditions: Condition[];
  domains: SearchDomain[];
  files: FileResult[];
  totalFiles: number;
  nextCursor: Cursor | null;
  searchId: number;
  similarTo: string | null;
  isPending: boolean;
  filterDomains: string[];
  filterConditionIds: number[];
  filterReactionTypeIds: number[];
  reactionTypes: ReactionType[];
  activeReactions: string[];
  similarGroupReactions: Record<string, number[]>;
  countsByDomain: Record<string, number>;
  countsByCondition: Record<number, number>;
  countsByReaction: Record<number, number>;
}
