"use client";

export const dynamic = 'force-dynamic';

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { ErrorMessage } from "@/components/ui/error-message";

interface ErrorDetail {
  error_code: string;
  error_name: string | null;
  error_message: string;
}

interface ErrorEntry {
  url: string;
  timestamp: number;
  errors: ErrorDetail[];
}

interface ErrorsData {
  domain: string;
  entries: ErrorEntry[];
  nextCursor: { url: string; timestamp: number } | null;
}

// Matches the backend sentinel for NULL error_name values
const NULL_NAME_SENTINEL = "__null__";

interface FilterOption {
  error_code: string;
  error_name: string | null;
}

function DomainErrorsInner() {
  const router = useRouter();
  const params = useSearchParams();
  const domain = params.get("domain") ?? "";

  // Applied filters come directly from the URL
  const appliedCodes = useMemo(() => params.getAll("error_code[]"), [params]);
  const appliedNames = useMemo(() => params.getAll("error_name[]"), [params]);

  // Filter options loaded from the API
  const [filterOptions, setFilterOptions] = useState<FilterOption[]>([]);

  // Local (uncommitted) selections — synced from URL whenever URL changes
  const [selectedCodes, setSelectedCodes] = useState<Set<string>>(new Set(appliedCodes));
  const [selectedNames, setSelectedNames] = useState<Set<string>>(new Set(appliedNames));

  // Keep local selections in sync when URL params change (e.g. back/forward navigation)
  useEffect(() => { setSelectedCodes(new Set(appliedCodes)); }, [appliedCodes.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setSelectedNames(new Set(appliedNames)); }, [appliedNames.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  // Infinite scroll state
  const [entries, setEntries] = useState<ErrorEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<{ url: string; timestamp: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Load filter options once; default local selections to "all" when no filter is in the URL
  useEffect(() => {
    if (!domain) return;
    fetch(`/api/domain_error_filters?domain=${encodeURIComponent(domain)}`)
      .then((r) => {
        if (!r.ok) throw new Error(r.statusText);
        return r.json() as Promise<FilterOption[]>;
      })
      .then((opts) => {
        setFilterOptions(opts);
        const allCodes = [...new Set(opts.map((f) => f.error_code))];
        const hasNullName = opts.some((f) => f.error_name === null);
        const allNames = [
          ...new Set(opts.map((f) => f.error_name).filter((n): n is string => n !== null)),
          ...(hasNullName ? [NULL_NAME_SENTINEL] : []),
        ];
        if (appliedCodes.length === 0) setSelectedCodes(new Set(allCodes));
        if (appliedNames.length === 0) setSelectedNames(new Set(allNames));
      })
      .catch(() => {/* non-fatal */});
  }, [domain]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchPage = useCallback(
    (cursor: { url: string; timestamp: number } | null, append: boolean) => {
      const q = new URLSearchParams({ domain });
      for (const code of appliedCodes) q.append("error_code[]", code);
      for (const name of appliedNames) q.append("error_name[]", name);
      if (cursor) {
        q.set("cursor_url", cursor.url);
        q.set("cursor_ts", String(cursor.timestamp));
      }
      (append ? setLoadingMore : setLoading)(true);
      fetch(`/api/domain_errors?${q}`)
        .then((r) => {
          if (!r.ok) throw new Error(r.statusText);
          return r.json() as Promise<ErrorsData>;
        })
        .then((data) => {
          setEntries((prev) => (append ? [...prev, ...data.entries] : data.entries));
          setNextCursor(data.nextCursor);
        })
        .catch((e) => setError(e.message))
        .finally(() => (append ? setLoadingMore : setLoading)(false));
    },
    [domain, appliedCodes.join(","), appliedNames.join(",")],
  );

  // Reset + refetch when applied filters change
  useEffect(() => {
    if (!domain) return;
    setEntries([]);
    setNextCursor(null);
    setError(null);
    fetchPage(null, false);
  }, [fetchPage, domain]);

  // IntersectionObserver for infinite scroll
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && nextCursor !== null && !loadingMore) {
        fetchPage(nextCursor, true);
      }
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [nextCursor, loadingMore, fetchPage]);

  function applyFilters() {
    const u = new URLSearchParams({ domain });
    const allSelected = (set: Set<string>, all: string[]) =>
      all.length > 0 && all.every((v) => set.has(v));
    if (!allSelected(selectedCodes, distinctCodes))
      for (const code of selectedCodes) u.append("error_code[]", code);
    if (!allSelected(selectedNames, distinctNames))
      for (const name of selectedNames) u.append("error_name[]", name);
    router.push(`/domain_errors?${u}`, { scroll: false });
  }

  // Distinct codes and names for filter pills
  const distinctCodes = [...new Set(filterOptions.map((f) => f.error_code))];
  const hasNullName = filterOptions.some((f) => f.error_name === null);
  const distinctNames = [
    ...new Set(filterOptions.map((f) => f.error_name).filter((n): n is string => n !== null)),
    ...(hasNullName ? [NULL_NAME_SENTINEL] : []),
  ];
  const isCodeActive = (code: string) => selectedCodes.has(code);
  const isNameActive = (name: string) => selectedNames.has(name);

  if (!domain) return <ErrorMessage message="Missing domain parameter" />;
  if (error) return <ErrorMessage message={error} />;
  if (loading) return <Spinner />;

  return (
    <div className="container max-w-5xl py-8 mx-auto px-4">
      <h1 className="text-2xl font-bold mb-1">Errors</h1>
      <p className="text-muted-foreground text-sm mb-6">{domain}</p>

      {/* Filter panel */}
      {filterOptions.length > 0 && (
        <Card className="mb-6">
          <CardHeader className="py-2 px-4 font-semibold text-sm">Filter Errors</CardHeader>
          <CardContent className="py-3 space-y-3">
            {distinctCodes.length > 0 && (
              <div>
                <div className="flex items-baseline justify-between mb-1">
                  <p className="text-xs font-semibold">Error Code</p>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-xs"
                      disabled={selectedCodes.size === distinctCodes.length}
                      onClick={() => setSelectedCodes(new Set(distinctCodes))}
                    >
                      Select all
                    </Button>
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-xs"
                      disabled={selectedCodes.size === 0}
                      onClick={() => setSelectedCodes(new Set())}
                    >
                      Select none
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {distinctCodes.map((code) => (
                    <Button
                      key={code}
                      type="button"
                      variant={isCodeActive(code) ? "default" : "outline"}
                      size="sm"
                      onClick={() =>
                        setSelectedCodes((prev) => {
                          const next = new Set(prev);
                          if (next.has(code)) next.delete(code); else next.add(code);
                          return next;
                        })
                      }
                    >
                      {code}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {distinctNames.length > 0 && (
              <div>
                <div className="flex items-baseline justify-between mb-1">
                  <p className="text-xs font-semibold">Error Name</p>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-xs"
                      disabled={selectedNames.size === distinctNames.length}
                      onClick={() => setSelectedNames(new Set(distinctNames))}
                    >
                      Select all
                    </Button>
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-xs"
                      disabled={selectedNames.size === 0}
                      onClick={() => setSelectedNames(new Set())}
                    >
                      Select none
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {distinctNames.map((name) => (
                    <Button
                      key={name}
                      type="button"
                      variant={isNameActive(name) ? "default" : "outline"}
                      size="sm"
                      onClick={() =>
                        setSelectedNames((prev) => {
                          const next = new Set(prev);
                          if (next.has(name)) next.delete(name); else next.add(name);
                          return next;
                        })
                      }
                    >
                      {name === NULL_NAME_SENTINEL ? "(no name)" : name}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            <Button size="sm" onClick={applyFilters}>Apply Filters</Button>
          </CardContent>
        </Card>
      )}

      {/* Results table */}
      {entries.length === 0 ? (
        <p className="text-muted-foreground">No errors found.</p>
      ) : (
        <div className="border rounded-md overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2 font-semibold">URL</th>
                <th className="text-left px-3 py-2 font-semibold whitespace-nowrap">Timestamp</th>
                <th className="text-left px-3 py-2 font-semibold whitespace-nowrap">Error Code</th>
                <th className="text-left px-3 py-2 font-semibold whitespace-nowrap">Error Name</th>
                <th className="text-left px-3 py-2 font-semibold">Message</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {entries.map((entry) =>
                entry.errors.map((e, ei) => (
                  <tr key={`${entry.url}|${entry.timestamp}|${ei}`} className="hover:bg-muted/40">
                    {ei === 0 ? (
                      <>
                        <td className="px-3 py-2 break-all max-w-xs align-top" rowSpan={entry.errors.length}>
                          <span className="text-muted-foreground">{entry.url}</span>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap font-mono text-xs" rowSpan={entry.errors.length}>
                          {entry.timestamp}
                        </td>
                      </>
                    ) : null}
                    <td className="px-3 py-2 whitespace-nowrap">
                      <code className="text-xs text-destructive">{e.error_code}</code>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs">{e.error_name ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground max-w-sm truncate" title={e.error_message}>
                      {e.error_message}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Sentinel for infinite scroll */}
      <div ref={sentinelRef} className="py-4 flex justify-center">
        {loadingMore && <Spinner />}
      </div>
    </div>
  );
}

export default function DomainErrorsPage() {
  return <DomainErrorsInner />;
}
