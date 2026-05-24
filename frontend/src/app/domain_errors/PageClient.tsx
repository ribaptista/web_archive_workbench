'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { PageContainer } from '@/components/PageContainer';
import { Spinner } from '@/components/ui/spinner';
import { ErrorMessage } from '@/components/ui/error-message';
import { Button } from '@/components/ui/button';
import { ToggleGroupWithSelectAll } from '@/components/ToggleGroupWithSelectAll';
import { DomainErrorList } from './DomainErrorList';
import { fetchDomainErrorFilters, fetchDomainErrors } from '@/lib/api';
import type { FilterOption, ErrorCursor } from '@/lib/api';
import { useInfiniteScroll } from '@/lib/useInfiniteScroll';
import { domainErrorsRoute } from '@/lib/routes';
import { collapseIfAllSelected } from '@/lib/selection';

export default function DomainErrorsPageClient() {
  const router = useRouter();
  const params = useSearchParams();
  const domain = params.get('domain') ?? '';

  // Applied filters come directly from the URL
  const appliedCodes = useMemo(() => params.getAll('error_code[]'), [params]);
  const appliedNames = useMemo(() => params.getAll('error_name[]'), [params]);

  // Filter options loaded from the API
  const [filterOptions, setFilterOptions] = useState<FilterOption[]>([]);

  // Distinct codes and names for filter pills — derived early so the sync
  // effects below can use them as the "all" fallback.
  const distinctCodes = useMemo(
    () => [...new Set(filterOptions.map((f) => f.error_code))],
    [filterOptions],
  );
  const distinctNames = useMemo(
    () => [...new Set(filterOptions.map((f) => f.error_name))],
    [filterOptions],
  );

  // Local (uncommitted) selections — synced from URL whenever URL changes
  const [selectedCodes, setSelectedCodes] = useState<Set<string>>(
    new Set(appliedCodes),
  );
  const [selectedNames, setSelectedNames] = useState<Set<string>>(
    new Set(appliedNames),
  );

  // Keep local selections in sync when URL params change (e.g. back/forward navigation).
  // Empty applied array means "no filter" (= all), so fall back to all distinct options.
  useEffect(() => {
    setSelectedCodes(
      appliedCodes.length > 0 ? new Set(appliedCodes) : new Set(distinctCodes),
    );
  }, [appliedCodes, distinctCodes]);
  useEffect(() => {
    setSelectedNames(
      appliedNames.length > 0 ? new Set(appliedNames) : new Set(distinctNames),
    );
  }, [appliedNames, distinctNames]);

  // Load filter options once per domain; default local selections to "all"
  // when no filter is in the URL. We deliberately depend on `domain` only —
  // the URL-key reads decide *initial* seeding and must not retrigger this
  // effect when the user edits filters.
  const seedRef = useRef({
    codes: appliedCodes,
    names: appliedNames,
  });
  useEffect(() => {
    seedRef.current = { codes: appliedCodes, names: appliedNames };
  });
  useEffect(() => {
    if (!domain) return;
    fetchDomainErrorFilters(domain)
      .then((opts) => {
        setFilterOptions(opts);
        const allCodes = [...new Set(opts.map((f) => f.error_code))];
        const allNames = [...new Set(opts.map((f) => f.error_name))];
        if (seedRef.current.codes.length === 0)
          setSelectedCodes(new Set(allCodes));
        if (seedRef.current.names.length === 0)
          setSelectedNames(new Set(allNames));
      })
      .catch(() => {});
  }, [domain]);

  const { entries, loading, loadingMore, error, sentinelRef } =
    useInfiniteScroll({
      enabled: !!domain,
      resetKey: `${domain}|${JSON.stringify(appliedCodes)}|${appliedNames.join(',')}`,
      fetchPage: (cursor: ErrorCursor | null) =>
        fetchDomainErrors({
          domain,
          errorCodes: appliedCodes,
          errorNames: appliedNames,
          cursor,
        }),
    });

  function applyFilters() {
    const codes = collapseIfAllSelected(selectedCodes, distinctCodes);
    const names = collapseIfAllSelected(selectedNames, distinctNames);
    router.push(domainErrorsRoute(domain, codes, names), { scroll: false });
  }

  if (!domain) return <ErrorMessage message="Missing domain parameter" />;
  if (error) return <ErrorMessage message={error} />;
  if (loading) return <Spinner />;

  return (
    <PageContainer>
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
              items={distinctCodes.map((c) => ({
                id: c,
                label: c || '(no code)',
              }))}
              selected={selectedCodes}
              onChange={setSelectedCodes}
            />
            <ToggleGroupWithSelectAll
              label="Error Name"
              items={distinctNames.map((n) => ({
                id: n,
                label: n,
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
    </PageContainer>
  );
}
