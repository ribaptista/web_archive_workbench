'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReadonlyURLSearchParams } from 'next/navigation';
import {
  fetchSearchResults,
  toggleReaction as apiToggleReaction,
} from '@/lib/api';
import type { Cursor, SearchResultsData } from './types';

interface Params {
  searchId: number;
  searchParams: ReadonlyURLSearchParams;
  currentCursor: Cursor | null;
  similarTo: string | undefined;
  filterDomains: string[];
  filterConditionIds: number[];
  filterReactionTypeIds: number[];
}

/**
 * Owns the data-loading lifecycle for the search-results page: building the
 * API URL, fetching, auto-refresh polling while the search is pending, and
 * a small `activeReactions` set kept in sync with each loaded payload.
 */
export function useSearchResults({
  searchId,
  searchParams: _searchParams,
  currentCursor,
  similarTo,
  filterDomains,
  filterConditionIds,
  filterReactionTypeIds,
}: Params) {
  const [data, setData] = useState<SearchResultsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [activeReactions, setActiveReactions] = useState<Set<string>>(
    new Set(),
  );

  // Stable join-keys for the dependency array of `load`.
  const domainsKey = filterDomains.join('\x00');
  const conditionsKey = filterConditionIds.join(',');
  const reactionsKey = filterReactionTypeIds.join(',');

  const load = useCallback(() => {
    if (!searchId) return;
    setLoading(true);
    fetchSearchResults<SearchResultsData>({
      searchId,
      cursorTimestamp: currentCursor?.timestamp,
      cursorRequestId: currentCursor?.requestId,
      similarTo,
      filterDomains,
      filterConditionIds,
      filterReactionTypeIds,
    })
      .then((d) => {
        setData(d);
        setActiveReactions(new Set(d.activeReactions));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    searchId,
    currentCursor,
    similarTo,
    domainsKey,
    conditionsKey,
    reactionsKey,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!autoRefresh || !data?.isPending) return;
    const id = setTimeout(load, 3000);
    return () => clearTimeout(id);
  }, [autoRefresh, data, load]);

  const toggleReaction = useCallback(
    async (url: string, timestamp: number, reactionTypeId: number) => {
      const key = `${url}|${timestamp}:${reactionTypeId}`;
      const isActive = activeReactions.has(key);
      const result = await apiToggleReaction(
        url,
        timestamp,
        reactionTypeId,
        !isActive,
      ).catch(() => null);
      if (!result) return;
      setActiveReactions((prev) => {
        const next = new Set(prev);
        for (const rt of data?.reactionTypes ?? [])
          next.delete(`${url}|${timestamp}:${rt.id}`);
        for (const id of result.activeReactionTypeIds)
          next.add(`${url}|${timestamp}:${id}`);
        return next;
      });
    },
    [activeReactions, data],
  );

  // For callers that need to force a re-fetch (e.g. autoRefresh toggle does
  // not change `load`'s identity).
  const reloadRef = useRef(load);
  reloadRef.current = load;
  const reload = useCallback(() => reloadRef.current(), []);

  return {
    data,
    error,
    loading,
    setLoading,
    reload,
    autoRefresh,
    setAutoRefresh,
    activeReactions,
    toggleReaction,
  };
}
