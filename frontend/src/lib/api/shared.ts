/**
 * Shared API payload types used by more than one resource concern
 * (e.g. ContextWindow appears in search results; ReactionType in both
 * search results and reactions_view).
 */

export interface ContextMatch {
  offset_in_context: number;
  match_length: number;
}

export interface ContextWindow {
  context: string;
  matches: ContextMatch[];
}

export interface ReactionType {
  id: number;
  label: string;
  icon: string;
}

export interface MatchedCondition {
  id: number;
  regex: string;
  not_regex_nearby: string | null;
}
