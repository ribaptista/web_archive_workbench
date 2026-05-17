/**
 * Builds the composite key used everywhere to identify "a specific reaction
 * on a specific resource version". Format: `${url}|${timestamp}:${typeId}`.
 *
 * Used as the membership token in the `activeReactions` Set returned by the
 * search-results and reactions-view APIs.
 */
export function reactionKey(
  url: string,
  timestamp: number,
  reactionTypeId: number,
): string {
  return `${url}|${timestamp}:${reactionTypeId}`;
}
