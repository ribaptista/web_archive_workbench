import type {
  ReactionType,
  MatchedCondition,
} from '@/components/FileResultCard';

export interface ReactionToggleResult {
  activeReactionTypeIds: number[];
}

export async function toggleReaction(
  url: string,
  timestamp: number,
  reactionTypeId: number,
  active: boolean,
): Promise<ReactionToggleResult> {
  const res = await fetch('/api/reactions/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      resource_version_url: url,
      resource_version_timestamp: timestamp,
      reaction_type_id: reactionTypeId,
      active,
    }),
  });
  if (!res.ok) throw new Error(res.statusText);
  return res.json();
}

export interface ReactionsViewFile {
  resource_version_url: string;
  resource_version_timestamp: number;
  request_id: string;
}

export interface ReactionsViewData {
  files: ReactionsViewFile[];
  totalFiles: number;
  totalPages: number;
  currentPage: number;
  reactionTypes: ReactionType[];
  domains: { id: string; domain: string }[];
  activeReactions: string[];
  matchedConditions: Record<string, MatchedCondition[]>;
}

export async function fetchReactionsView(
  reactionTypeId: number,
  page: number,
  filterDomains: string[],
): Promise<ReactionsViewData> {
  const q = new URLSearchParams({
    reaction_type_id: String(reactionTypeId),
    page: String(page),
  });
  for (const d of filterDomains) q.append('domain[]', d);
  const res = await fetch(`/api/reactions/?${q}`);
  if (!res.ok) throw new Error(res.statusText);
  return res.json();
}
