/**
 * Helpers for the multi-select filter pattern used on the search-results,
 * reactions-view, and domain-errors pages.
 *
 * The convention is: an empty selection means "no filter applied" (i.e. all
 * results pass). Conversely, an explicit "select all" is collapsed back to an
 * empty set so that filtering does not narrow anything and the URL stays
 * short.
 */

/** Returns true when every item in `all` is present in `set`. */
export function allSelected(set: Set<string>, all: string[]): boolean {
  return all.length > 0 && all.every((v) => set.has(v));
}

/**
 * When every option is selected, returns an empty set (meaning "no filter").
 * Otherwise returns the original selection. Used to keep URLs short when a
 * filter would not actually narrow results.
 */
export function collapseIfAllSelected(
  set: Set<string>,
  all: string[],
): Set<string> {
  return allSelected(set, all) ? new Set<string>() : set;
}
