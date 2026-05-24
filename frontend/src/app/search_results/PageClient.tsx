'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { PageContainer } from '@/components/PageContainer';
import { Spinner } from '@/components/ui/spinner';
import { ErrorMessage } from '@/components/ui/error-message';
import { SearchInfoCard } from './SearchInfoCard';
import { ResultsFilters, type AppliedFilters } from './ResultsFilters';
import { ResultsList } from './ResultsList';
import { useCursorHistory } from './useCursorHistory';
import { useSearchResults } from './useSearchResults';
import { searchResultsRoute } from '@/lib/routes';
import { useScrollOnNavigate } from '@/lib/useScrollOnNavigate';
import type { FileResult } from '@/lib/api';

export default function SearchResultsPageClient() {
  const router = useRouter();
  const params = useSearchParams();
  const searchId = Number(params.get('search_id'));
  const similarTo = params.get('similar_to') ?? undefined;
  const filterDomains = useMemo(() => params.getAll('domain[]'), [params]);
  const filterConditionIds = useMemo(
    () => params.getAll('condition_id[]').map(Number),
    [params],
  );
  const filterReactionTypeIds = useMemo(
    () => params.getAll('reaction_type_id[]').map(Number),
    [params],
  );

  const {
    currentCursor,
    hasPrev,
    push: pushCursor,
    pop: popCursor,
    reset: resetCursor,
  } = useCursorHistory(params);

  const resultsRef = useRef<HTMLHeadingElement>(null);
  const [filterInvisible, setFilterInvisible] = useState(false);
  const [filterLoading, setFilterLoading] = useState(false);

  const {
    data,
    error,
    loading,
    setLoading,
    reload,
    autoRefresh,
    setAutoRefresh,
    activeReactions,
    toggleReaction,
  } = useSearchResults({
    searchId,
    searchParams: params,
    currentCursor,
    similarTo,
    filterDomains,
    filterConditionIds,
    filterReactionTypeIds,
  });

  // Reset transient page-level flags whenever fresh data arrives.
  useEffect(() => {
    if (data) {
      setFilterLoading(false);
      setFilterInvisible(false);
    }
  }, [data]);

  function applyFilters(f: AppliedFilters) {
    resetCursor();
    const nextUrl = searchResultsRoute({
      searchId,
      similarTo,
      domains: f.domains,
      conditionIds: f.conditionIds,
      reactionTypeIds: f.reactionTypeIds,
    });
    const currentUrl = `${window.location.pathname}${window.location.search}`;
    if (nextUrl === currentUrl) {
      // URL didn't change — router.push would be a no-op; reload manually.
      setFilterLoading(true);
      reload();
      return;
    }
    setLoading(true);
    setFilterLoading(true);
    router.push(nextUrl, { scroll: false });
  }

  function goNext() {
    if (!data?.nextCursor) return;
    const next = data.nextCursor;
    pushCursor(next);
    router.push(
      searchResultsRoute({
        searchId,
        similarTo,
        domains: filterDomains,
        conditionIds: filterConditionIds,
        reactionTypeIds: filterReactionTypeIds,
        cursor: { timestamp: next.timestamp, requestId: next.requestId },
      }),
      { scroll: false },
    );
    resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function goPrev() {
    const prev = popCursor();
    router.push(
      searchResultsRoute({
        searchId,
        similarTo,
        domains: filterDomains,
        conditionIds: filterConditionIds,
        reactionTypeIds: filterReactionTypeIds,
        cursor: prev
          ? { timestamp: prev.timestamp, requestId: prev.requestId }
          : null,
      }),
      { scroll: false },
    );
    resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const scrollToResults = useScrollOnNavigate(resultsRef);

  function navigate(url: string, resetCursorOnNav = false, doScroll = false) {
    if (doScroll) scrollToResults(() => setFilterInvisible(true));
    setLoading(true);
    if (resetCursorOnNav) resetCursor();
    router.push(url, { scroll: false });
  }

  function onSimilarClick(file: FileResult) {
    navigate(
      searchResultsRoute({
        searchId,
        similarTo: file.context_digest,
        domains: filterDomains,
        conditionIds: filterConditionIds,
        reactionTypeIds: filterReactionTypeIds,
      }),
      true,
      true,
    );
  }

  function onBackToDedup() {
    navigate(
      searchResultsRoute({
        searchId,
        domains: filterDomains,
        conditionIds: filterConditionIds,
        reactionTypeIds: filterReactionTypeIds,
      }),
      true,
    );
  }

  if (!searchId) return <ErrorMessage message="Missing search_id" />;
  if (error) return <ErrorMessage message={error} />;
  if (data === null) return <Spinner />;

  const pagination = {
    hasPrev,
    hasNext: !!data.nextCursor,
    onPrev: goPrev,
    onNext: goNext,
  };

  return (
    <PageContainer>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Search Results</h1>
        {data.isPending && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={reload}>
              ↻ Refresh
            </Button>
            <Button
              variant={autoRefresh ? 'default' : 'outline'}
              size="sm"
              onClick={() => setAutoRefresh((v) => !v)}
            >
              Auto Refresh: {autoRefresh ? 'On' : 'Off'}
            </Button>
          </div>
        )}
      </div>

      <SearchInfoCard search={data.search} isPending={data.isPending} />

      {!similarTo && (
        <ResultsFilters
          data={data}
          loading={loading}
          invisible={filterInvisible}
          onApply={applyFilters}
        />
      )}

      <ResultsList
        data={data}
        loading={loading}
        filterLoading={filterLoading}
        similarTo={similarTo}
        filterReactionTypeIds={filterReactionTypeIds}
        activeReactions={activeReactions}
        headingRef={resultsRef}
        pagination={pagination}
        onToggleReaction={toggleReaction}
        onSimilarClick={onSimilarClick}
        onBackToDedup={onBackToDedup}
      />
    </PageContainer>
  );
}
