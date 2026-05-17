'use client';

export const dynamic = 'force-dynamic';

import {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
  Suspense,
} from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { ErrorMessage } from '@/components/ui/error-message';
import { Button } from '@/components/ui/button';
import { ToggleGroupWithSelectAll } from '@/components/ToggleGroupWithSelectAll';
import { DomainErrorList } from './DomainErrorList';
import type { ErrorEntry } from './DomainErrorList';
import { fetchDomainErrorFilters, fetchDomainErrors } from '@/lib/api';
import type { FilterOption, ErrorCursor } from '@/lib/api';
import { domainErrorsRoute } from '@/lib/routes';
import { allSelected } from '@/lib/utils';

function DomainErrorsInner() {
  const router = useRouter();
  const params = useSearchParams();
  const domain = params.get('domain') ?? '';

  // Applied filters come directly from the URL
  const appliedCodes = useMemo(() => params.getAll('error_code[]'), [params]);
  const appliedNames = useMemo(() => params.getAll('error_name[]'), [params]);

  // Filter options loaded from the API
  const [filterOptions, setFilterOptions] = useState<FilterOption[]>([]);

  // Local (uncommitted) selections — synced from URL whenever URL changes
  const [selectedCodes, setSelectedCodes] = useState<Set<string>>(
    new Set(appliedCodes),
  );
  const [selectedNames, setSelectedNames] = useState<Set<string>>(
    new Set(appliedNames),
  );

  // Keep local selections in sync when URL params change (e.g. back/forward navigation)
  useEffect(() => {
    setSelectedCodes(new Set(appliedCodes));
  }, [appliedCodes.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setSelectedNames(new Set(appliedNames));
  }, [appliedNames.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  // Infinite scroll state
  const [entries, setEntries] = useState<ErrorEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<ErrorCursor | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Load filter options once; default local selections to "all" when no filter is in the URL
  useEffect(() => {
    if (!domain) return;
    fetchDomainErrorFilters(domain)
      .then((opts) => {
        setFilterOptions(opts);
        const allCodes = [...new Set(opts.map((f) => f.error_code))];
        const allNames = [...new Set(opts.map((f) => f.error_name))];
        if (appliedCodes.length === 0) setSelectedCodes(new Set(allCodes));
        if (appliedNames.length === 0) setSelectedNames(new Set(allNames));
      })
      .catch((e) => setError(e.message));
  }, [domain]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchPage = useCallback(
    (cursor: ErrorCursor | null, append: boolean) => {
      (append ? setLoadingMore : setLoading)(true);
      fetchDomainErrors({
        domain,
        errorCodes: appliedCodes,
        errorNames: appliedNames,
        cursor,
      })
        .then((data) => {
          setEntries((prev) =>
            append ? [...prev, ...data.entries] : data.entries,
          );
          setNextCursor(data.nextCursor);
        })
        .catch((e) => setError(e.message))
        .finally(() => (append ? setLoadingMore : setLoading)(false));
    },
    [domain, appliedCodes.join(','), appliedNames.join(',')],
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
    const codes = allSelected(selectedCodes, distinctCodes)
      ? new Set<string>()
      : selectedCodes;
    const names = allSelected(selectedNames, distinctNames)
      ? new Set<string>()
      : selectedNames;
    router.push(domainErrorsRoute(domain, codes, names), { scroll: false });
  }

  // Distinct codes and names for filter pills
  const distinctCodes = [...new Set(filterOptions.map((f) => f.error_code))];
  const distinctNames = [...new Set(filterOptions.map((f) => f.error_name))];

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
          <CardHeader className="py-2 px-4 font-semibold text-sm">
            Filter Errors
          </CardHeader>
          <CardContent className="py-3 space-y-3">
            <ToggleGroupWithSelectAll
              label="Error Code"
              items={distinctCodes.map((c) => ({ id: c, label: c }))}
              selected={selectedCodes}
              onChange={setSelectedCodes}
            />
            <ToggleGroupWithSelectAll
              label="Error Name"
              items={distinctNames.map((n) => ({
                id: n,
                label: n || '(no name)',
              }))}
              selected={selectedNames}
              onChange={setSelectedNames}
            />
            <Button size="sm" onClick={applyFilters}>
              Apply Filters
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Results table */}
      <DomainErrorList entries={entries} />

      {/* Sentinel for infinite scroll */}
      <div ref={sentinelRef} className="py-4 flex justify-center">
        {loadingMore && <Spinner />}
      </div>
    </div>
  );
}

export default function DomainErrorsPage() {
  return (
    <Suspense>
      <DomainErrorsInner />
    </Suspense>
  );
}
