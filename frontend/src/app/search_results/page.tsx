"use client";

export const dynamic = "force-dynamic";

import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ErrorMessage } from "@/components/ui/error-message";
import { SearchInfoCard } from "./SearchInfoCard";
import { ResultsFilters, type AppliedFilters } from "./ResultsFilters";
import { ResultsList } from "./ResultsList";
import { useCursorHistory } from "./useCursorHistory";
import { useSearchResults } from "./useSearchResults";
import type { FileResult } from "./types";

function SearchResultsInner() {
  const router = useRouter();
  const params = useSearchParams();
  const searchId = Number(params.get("search_id"));
  const similarTo = params.get("similar_to") ?? undefined;
  const filterDomains = useMemo(() => params.getAll("domain[]"), [params]);
  const filterConditionIds = useMemo(() => params.getAll("condition_id[]").map(Number), [params]);
  const filterReactionTypeIds = useMemo(() => params.getAll("reaction_type_id[]").map(Number), [params]);

  const { currentCursor, hasPrev, push: pushCursor, pop: popCursor, reset: resetCursor } = useCursorHistory(params);

  const resultsRef = useRef<HTMLHeadingElement>(null);
  const [filterInvisible, setFilterInvisible] = useState(false);
  const [filterLoading, setFilterLoading] = useState(false);

  const {
    data, error, loading, setLoading, reload,
    autoRefresh, setAutoRefresh,
    activeReactions, toggleReaction,
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

  function filterSuffix() {
    const parts: string[] = [];
    for (const id of filterDomains) parts.push(`domain[]=${encodeURIComponent(id)}`);
    for (const id of filterConditionIds) parts.push(`condition_id[]=${id}`);
    for (const id of filterReactionTypeIds) parts.push(`reaction_type_id[]=${id}`);
    return parts.length ? `&${parts.join("&")}` : "";
  }

  function applyFilters(f: AppliedFilters) {
    const u = new URLSearchParams();
    u.set("search_id", String(searchId));
    if (similarTo) u.set("similar_to", similarTo);
    for (const d of f.domains) u.append("domain[]", d);
    for (const id of f.conditionIds) u.append("condition_id[]", String(id));
    for (const id of f.reactionTypeIds) u.append("reaction_type_id[]", String(id));
    resetCursor();
    setLoading(true);
    setFilterLoading(true);
    router.push(`/search_results?${u}`, { scroll: false });
  }

  function goNext() {
    if (!data?.nextCursor) return;
    const next = data.nextCursor;
    pushCursor(next);
    const u = new URLSearchParams(params.toString());
    u.set("cursor_timestamp", String(next.timestamp));
    u.set("cursor_request_id", next.requestId);
    router.push(`/search_results?${u}`, { scroll: false });
    resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function goPrev() {
    const prev = popCursor();
    const u = new URLSearchParams(params.toString());
    if (prev) {
      u.set("cursor_timestamp", String(prev.timestamp));
      u.set("cursor_request_id", prev.requestId);
    } else {
      u.delete("cursor_timestamp");
      u.delete("cursor_request_id");
    }
    router.push(`/search_results?${u}`, { scroll: false });
    resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function navigate(url: string, resetCursorOnNav = false, scrollToResults = false) {
    if (scrollToResults) {
      flushSync(() => setFilterInvisible(true));
      const el = resultsRef.current;
      if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 16 });
    }
    setLoading(true);
    if (resetCursorOnNav) resetCursor();
    router.push(url, { scroll: false });
  }

  function onSimilarClick(file: FileResult) {
    navigate(
      `/search_results?search_id=${searchId}&similar_to=${file.context_digest}${filterSuffix()}`,
      true,
      true,
    );
  }

  function onBackToDedup() {
    navigate(`/search_results?search_id=${searchId}${filterSuffix()}`, true);
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
    <div className="container max-w-5xl py-8 mx-auto px-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Search Results</h1>
        {data.isPending && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={reload}>↻ Refresh</Button>
            <Button
              variant={autoRefresh ? "default" : "outline"}
              size="sm"
              onClick={() => setAutoRefresh((v) => !v)}
            >
              Auto Refresh: {autoRefresh ? "On" : "Off"}
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
    </div>
  );
}

export default function SearchResultsPage() {
  return <SearchResultsInner />;
}
