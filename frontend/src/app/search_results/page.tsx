"use client";

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { flushSync } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { FileResultCard, DynamicIcon } from "@/components/FileResultCard";
import type { ContextWindow, ReactionType } from "@/components/FileResultCard";
import { Spinner } from "@/components/ui/spinner";
import { ErrorMessage } from "@/components/ui/error-message";
import { ToggleGroupWithSelectAll } from "@/components/ToggleGroupWithSelectAll";

interface SearchInfo {
  id: number;
  created_at: string;
  status: string;
  file_count: number;
  scanned_file_count: number;
  error_message: string | null;
}

interface Condition {
  id: number;
  regex: string;
  not_regex_nearby: string | null;
}

interface Domain {
  id: string;
  domain: string;
}

interface FileResult {
  id: number;
  request_id: string;
  resource_version_url: string;
  resource_version_timestamp: number;
  body_digest: string;
  match_count: number;
  duplicate_count: number;
  context_digest: string | null;
  original: string;
  timestamp: string;
  fileError: string | null;
  contextWindows: ContextWindow[];
}

interface SearchResultsData {
  search: SearchInfo;
  conditions: Condition[];
  domains: Domain[];
  files: FileResult[];
  totalFiles: number;
  nextCursor: { timestamp: number; requestId: string } | null;
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

function statusBadge(status: string) {
  if (status === "done") return <Badge>done</Badge>;
  if (status === "running") return <Badge variant="secondary">running</Badge>;
  if (status === "error") return <Badge variant="destructive">error</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

function SearchResultsInner() {
  const router = useRouter();
  const params = useSearchParams();
  const searchId = Number(params.get("search_id"));
  const similarTo = params.get("similar_to") ?? undefined;
  const filterDomains = useMemo(() => params.getAll("domain[]"), [params]);
  const filterConditionIds = useMemo(() => params.getAll("condition_id[]").map(Number), [params]);
  const filterReactionTypeIds = useMemo(() => params.getAll("reaction_type_id[]").map(Number), [params]);

  const cursorTimestampParam = params.get("cursor_timestamp");
  const cursorRequestIdParam = params.get("cursor_request_id");
  const initialCursor = cursorTimestampParam && cursorRequestIdParam
    ? { timestamp: Number(cursorTimestampParam), requestId: cursorRequestIdParam }
    : null;

  const [cursorHistory, setCursorHistory] = useState<Array<{ timestamp: number; requestId: string } | null>>(
    initialCursor ? [null, initialCursor] : [null]
  );
  const currentCursor = cursorHistory[cursorHistory.length - 1];
  const hasPrev = cursorHistory.length > 1;
  const resultsRef = useRef<HTMLHeadingElement>(null);
  const [filterInvisible, setFilterInvisible] = useState(false);

  const [data, setData] = useState<SearchResultsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filterLoading, setFilterLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [activeReactions, setActiveReactions] = useState<Set<string>>(new Set());

  // Local filter state (applied on button click)
  const [localDomains, setLocalDomains] = useState<Set<string>>(new Set(filterDomains));
  const [localConditions, setLocalConditions] = useState<Set<number>>(new Set(filterConditionIds));
  const [localReactions, setLocalReactions] = useState<Set<number>>(new Set(filterReactionTypeIds));

  const buildApiUrl = useCallback(() => {
    const q = new URLSearchParams();
    q.set("search_id", String(searchId));
    if (currentCursor) {
      q.set("cursor_timestamp", String(currentCursor.timestamp));
      q.set("cursor_request_id", currentCursor.requestId);
    }
    if (similarTo) q.set("similar_to", similarTo);
    for (const d of filterDomains) q.append("domain[]", d);
    for (const id of filterConditionIds) q.append("condition_id[]", String(id));
    for (const id of filterReactionTypeIds) q.append("reaction_type_id[]", String(id));
    return `/api/search_results?${q}`;
  }, [searchId, currentCursor, similarTo, filterDomains, filterConditionIds, filterReactionTypeIds]);

  const load = useCallback(() => {
    if (!searchId) return;
    setLoading(true);
    fetch(buildApiUrl())
      .then((r) => {
        if (!r.ok) throw new Error(r.statusText);
        return r.json();
      })
      .then((d: SearchResultsData) => {
        setData(d);
        setActiveReactions(new Set(d.activeReactions));
        setLocalDomains(d.filterDomains.length > 0 ? new Set(d.filterDomains) : new Set(d.domains.map((x: Domain) => x.id)));
        setLocalConditions(d.filterConditionIds.length > 0 ? new Set(d.filterConditionIds) : new Set(d.conditions.map((x: Condition) => x.id)));
        setLocalReactions(new Set(d.filterReactionTypeIds));
        setFilterInvisible(false);
      })
      .catch((e) => setError(e.message))
      .finally(() => { setLoading(false); setFilterLoading(false); });
  }, [buildApiUrl, searchId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!autoRefresh || !data?.isPending) return;
    const id = setTimeout(load, 3000);
    return () => clearTimeout(id);
  }, [autoRefresh, data, load]);

  function applyFilters() {
    const u = new URLSearchParams();
    u.set("search_id", String(searchId));
    if (similarTo) u.set("similar_to", similarTo);
    // If all domains selected (or none deselected), don't include filter
    const allDomains = data?.domains ?? [];
    const allSelected = allDomains.every((d) => localDomains.has(d.id));
    if (!allSelected) for (const id of localDomains) u.append("domain[]", id);
    const allConds = data?.conditions ?? [];
    const allCondsSelected = allConds.every((c) => localConditions.has(c.id));
    if (!allCondsSelected) for (const id of localConditions) u.append("condition_id[]", String(id));
    for (const id of localReactions) u.append("reaction_type_id[]", String(id));
    u.delete("cursor_timestamp");
    u.delete("cursor_request_id");
    setCursorHistory([null]);
    setLoading(true);
    setFilterLoading(true);
    router.push(`/search_results?${u}`, { scroll: false });
  }

  function goNext() {
    if (!data?.nextCursor) return;
    const nextCursor = data.nextCursor;
    setCursorHistory((prev) => [...prev, nextCursor]);
    const u = new URLSearchParams(params.toString());
    u.set("cursor_timestamp", String(nextCursor.timestamp));
    u.set("cursor_request_id", nextCursor.requestId);
    router.push(`/search_results?${u}`, { scroll: false });
    resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function goPrev() {
    const next = cursorHistory.slice(0, -1);
    const prevCursor = next[next.length - 1];
    const u = new URLSearchParams(params.toString());
    if (prevCursor) {
      u.set("cursor_timestamp", String(prevCursor.timestamp));
      u.set("cursor_request_id", prevCursor.requestId);
    } else {
      u.delete("cursor_timestamp");
      u.delete("cursor_request_id");
    }
    setCursorHistory(next);
    router.push(`/search_results?${u}`, { scroll: false });
    resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function navigate(url: string, resetCursor = false, scrollToResults = false) {
    if (scrollToResults) {
      flushSync(() => setFilterInvisible(true));
      const el = resultsRef.current;
      if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 16 });
    }
    setLoading(true);
    if (resetCursor) setCursorHistory([null]);
    router.push(url, { scroll: false });
  }

  async function toggleReaction(url: string, timestamp: number, reactionTypeId: number) {
    const key = `${url}|${timestamp}:${reactionTypeId}`;
    const isActive = activeReactions.has(key);
    const res = await fetch("/reactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resource_version_url: url, resource_version_timestamp: timestamp, reaction_type_id: reactionTypeId, active: !isActive }),
    });
    if (!res.ok) return;
    const result = await res.json();
    setActiveReactions((prev) => {
      const next = new Set(prev);
      for (const rt of data?.reactionTypes ?? []) next.delete(`${url}|${timestamp}:${rt.id}`);
      for (const id of result.activeReactionTypeIds) next.add(`${url}|${timestamp}:${id}`);
      return next;
    });
  }

  if (!searchId) return <ErrorMessage message="Missing search_id" />;
  if (error) return <ErrorMessage message={error} />;
  if (data === null) return <Spinner />;

  const { search, conditions, domains, files, totalFiles } = data ?? {
    search: null, conditions: [], domains: [], files: [], totalFiles: 0,
  };
  const pct = (search?.file_count ?? 0) > 0
    ? Math.round(((search?.scanned_file_count ?? 0) / (search?.file_count ?? 1)) * 100)
    : 0;

  const filterSuffix = () => {
    const parts: string[] = [];
    for (const id of filterDomains) parts.push(`domain[]=${encodeURIComponent(id)}`);
    for (const id of filterConditionIds) parts.push(`condition_id[]=${id}`);
    for (const id of filterReactionTypeIds) parts.push(`reaction_type_id[]=${id}`);
    return parts.length ? `&${parts.join("&")}` : "";
  };

  return (
    <div className="container max-w-5xl py-8 mx-auto px-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Search Results</h1>
        {data?.isPending && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={load}>↻ Refresh</Button>
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

      {/* Search info card */}
      {data && search && (
        <Card className="mb-4">
          <CardContent className="py-3 space-y-1 text-sm">
            <p><strong>Search ID:</strong> {search.id}</p>
            <p><strong>Created:</strong> {search.created_at}</p>
            <p className="flex items-center gap-2"><strong>Status:</strong> {statusBadge(search.status)}</p>
            {data.isPending && (
              <div className="mt-2">
                <div className="flex justify-between text-xs text-muted-foreground mb-1">
                  <span>Scanning files…</span>
                  <span>{search.scanned_file_count} / {search.file_count} ({pct}%)</span>
                </div>
                <Progress value={pct} indeterminate={data.isPending} className="h-2" />
              </div>
            )}
            {search.status === "error" && (
              <p className="text-destructive"><strong>Error:</strong> {search.error_message}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Filters + results */}
      {data && (<>

        {/* Filters */}
        {!similarTo && (
          <Card className={`mb-4 transition-opacity ${filterInvisible ? 'invisible' : ''}`}>
            <CardHeader className="py-2 px-4 font-semibold text-sm">Filter Results</CardHeader>
            <CardContent className={`py-3 space-y-3 transition-opacity ${loading ? "opacity-50 pointer-events-none" : ""}`}>
              {domains.length > 0 && (
                <ToggleGroupWithSelectAll
                  label="Domains"
                  items={domains.map((d) => ({ id: d.id, label: d.domain }))}
                  selected={localDomains}
                  onChange={setLocalDomains}
                  counts={data.countsByDomain}
                />
              )}
              {conditions.length > 0 && (
                <div>
                  <p className="text-xs font-semibold mb-1">Conditions</p>
                  <div className="flex flex-wrap gap-2">
                    {conditions.map((c) => {
                      const count = data.countsByCondition[c.id];
                      return (
                        <Button
                          key={c.id}
                          variant={localConditions.has(c.id) ? "default" : "outline"}
                          size="sm"
                          className="h-auto py-1 flex flex-col items-start"
                          onClick={() =>
                            setLocalConditions((prev) => {
                              const next = new Set(prev);
                              if (next.has(c.id)) next.delete(c.id); else next.add(c.id);
                              return next;
                            })
                          }
                        >
                          <span>{c.regex}{count !== undefined && <span className="ml-1 opacity-60 font-normal">({count})</span>}</span>
                          {c.not_regex_nearby && (
                            <span className={`font-normal text-xs ${localConditions.has(c.id) ? "text-primary-foreground/60" : "text-muted-foreground"}`}>
                              NOT NEAR {c.not_regex_nearby}
                            </span>
                          )}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              )}
              {data.reactionTypes.length > 0 && (
                <div>
                  <p className="text-xs font-semibold mb-1">Only reacted</p>
                  <div className="flex flex-wrap gap-2">
                    {data.reactionTypes.map((rt) => {
                      const count = data.countsByReaction[rt.id];
                      return (
                        <Button
                          key={rt.id}
                          variant={localReactions.has(rt.id) ? "default" : "outline"}
                          size="sm"
                          onClick={() =>
                            setLocalReactions((prev) => {
                              const next = new Set(prev);
                              if (next.has(rt.id)) next.delete(rt.id); else next.add(rt.id);
                              return next;
                            })
                          }
                        >
                          <DynamicIcon name={rt.emoji} active={localReactions.has(rt.id)} />
                          {rt.label}{count !== undefined && <span className="ml-1 opacity-60 font-normal text-xs">({count})</span>}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              )}
              <Button size="sm" onClick={applyFilters}>Update Filters</Button>
            </CardContent>
          </Card>
        )}

        <h2 ref={resultsRef} className={`text-base font-semibold mb-2 transition-opacity ${filterLoading ? "opacity-50" : ""}`}>Files with Matches ({totalFiles})</h2>

        <div className={`transition-opacity ${loading ? "opacity-50 pointer-events-none" : ""}`}>
          {similarTo && (
            <div className="bg-muted text-muted-foreground text-sm rounded px-3 py-2 mb-3">
              Showing all results with context digest: <code>{similarTo}</code>
              {" — "}
              <button
                className="underline"
                onClick={() => navigate(`/search_results?search_id=${searchId}${filterSuffix()}`, true)}
              >
                Back to deduplicated results
              </button>
            </div>
          )}

          {/* Pagination top */}
          {(hasPrev || data?.nextCursor) && (
            <div className="flex gap-1 mb-3">
              <Button variant="outline" size="sm" disabled={!hasPrev} onClick={goPrev}>« Prev</Button>
              <Button variant="outline" size="sm" disabled={!data?.nextCursor} onClick={goNext}>Next »</Button>
            </div>
          )}

          {files.length === 0 ? (
            <p className="text-muted-foreground">No matches found.</p>
          ) : (
            <div className="space-y-3">
              {files.map((file) => (
                <FileResultCard
                  key={file.id}
                  bodyDigest={file.body_digest}
                  resourceVersionUrl={file.resource_version_url}
                  resourceVersionTimestamp={file.resource_version_timestamp}
                  original={file.original}
                  timestamp={file.timestamp}
                  matchCount={file.match_count}
                  duplicateCount={!similarTo && !filterReactionTypeIds.length ? file.duplicate_count : undefined}
                  contextWindows={file.contextWindows}
                  fileError={file.fileError}
                  reactionTypes={data.reactionTypes}
                  activeReactions={activeReactions}
                  onToggleReaction={toggleReaction}
                  similarGroupReactionTypeIds={!similarTo && !filterReactionTypeIds.length && file.context_digest ? data.similarGroupReactions[file.context_digest] : undefined}
                  onSimilarClick={
                    !similarTo && !filterReactionTypeIds.length && file.duplicate_count > 1
                      ? () => navigate(`/search_results?search_id=${searchId}&similar_to=${file.context_digest}${filterSuffix()}`, true, true)
                      : undefined
                  }
                />
              ))}
            </div>
          )}

          {/* Pagination bottom */}
          {(hasPrev || data?.nextCursor) && (
            <div className="flex gap-1 mt-3">
              <Button variant="outline" size="sm" disabled={!hasPrev} onClick={goPrev}>« Prev</Button>
              <Button variant="outline" size="sm" disabled={!data?.nextCursor} onClick={goNext}>Next »</Button>
            </div>
          )}
        </div>
      </>)}
    </div>
  );
}

export default function SearchResultsPage() {
  return <SearchResultsInner />;
}
