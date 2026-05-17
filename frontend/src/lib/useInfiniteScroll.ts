'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface PageShape {
  entries: readonly unknown[];
  nextCursor: unknown;
}

interface Options<P extends PageShape> {
  /**
   * Fetches one page. Called with `null` for the first page, then with the
   * cursor returned by the previous page. May return extra fields (e.g.
   * breadcrumbs) accessible via `onFirstPage`.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fetchPage: (cursor: any) => Promise<P>;
  /**
   * Called once whenever a fresh first page (cursor=null) arrives. Use this
   * to capture per-listing metadata returned alongside `entries`.
   */
  onFirstPage?: (data: P) => void;
  /**
   * When false the hook stays idle (no first-page load, no observer). Useful
   * when a required URL parameter is still missing.
   */
  enabled?: boolean;
  /**
   * Changing this value resets state and refetches the first page.
   * Pass a stable string built from the filter inputs.
   */
  resetKey: string;
}

interface Result<T> {
  entries: T[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  /** Attach to a sentinel element rendered below the list. */
  sentinelRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Cursor-based infinite scroll. Owns the entries / nextCursor / loading state
 * and an IntersectionObserver attached via `sentinelRef`.
 */
export function useInfiniteScroll<P extends PageShape>({
  fetchPage,
  onFirstPage,
  enabled = true,
  resetKey,
}: Options<P>): Result<P['entries'][number]> {
  type T = P['entries'][number];
  type C = P['nextCursor'];

  const [entries, setEntries] = useState<T[]>([]);
  const [nextCursor, setNextCursor] = useState<C | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Keep the latest callbacks in refs so the load callback identity stays
  // stable across renders.
  const fetchPageRef = useRef(fetchPage);
  fetchPageRef.current = fetchPage;
  const onFirstPageRef = useRef(onFirstPage);
  onFirstPageRef.current = onFirstPage;

  const load = useCallback((cursor: C | null, append: boolean) => {
    (append ? setLoadingMore : setLoading)(true);
    fetchPageRef
      .current(cursor)
      .then((data) => {
        if (!append) onFirstPageRef.current?.(data);
        setEntries((prev) =>
          append ? [...prev, ...(data.entries as T[])] : (data.entries as T[]),
        );
        setNextCursor(data.nextCursor as C | null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => (append ? setLoadingMore : setLoading)(false));
  }, []);

  // First page (and reset) whenever the key changes.
  useEffect(() => {
    if (!enabled) return;
    setEntries([]);
    setNextCursor(null);
    setError(null);
    load(null, false);
  }, [enabled, resetKey, load]);

  // Observe sentinel — load next page when it scrolls into view.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !enabled) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && nextCursor !== null && !loadingMore) {
        load(nextCursor, true);
      }
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [nextCursor, loadingMore, enabled, load]);

  return { entries, loading, loadingMore, error, sentinelRef };
}
