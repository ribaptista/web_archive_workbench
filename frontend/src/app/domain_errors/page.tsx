'use client';

export const dynamic = 'force-dynamic';

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

export default function DomainErrorsPage() {
  const router = useRouter();
  const params = useSearchParams();
  const domain = params.get('domain') ?? '';

  // Applied filters come directly from the URL
  const appliedCodes = useMemo(() => params.getAll('error_code[]'), [params]);
  const appliedNames = useMemo(() => params.getAll('error_name[]'), [params]);
  const appliedCodesKey = appliedCodes.join(',');
  const appliedNamesKey = appliedNames.join(',');

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
    setSelectedCodes(
      new Set(appliedCodesKey ? appliedCodesKey.split(',') : []),
    );
  }, [appliedCodesKey]);
  useEffect(() => {
    setSelectedNames(
      new Set(appliedNamesKey ? appliedNamesKey.split(',') : []),
    );
  }, [appliedNamesKey]);

  // Load filter options once per domain; default local selections to "all"
  // when no filter is in the URL. We deliberately depend on `domain` only —
  // the URL-key reads decide *initial* seeding and must not retrigger this
  // effect when the user edits filters.
  const seedKeysRef = useRef({
    codes: appliedCodesKey,
    names: appliedNamesKey,
  });
  useEffect(() => {
    seedKeysRef.current = { codes: appliedCodesKey, names: appliedNamesKey };
  });
  useEffect(() => {
    if (!domain) return;
    fetchDomainErrorFilters(domain)
      .then((opts) => {
        setFilterOptions(opts);
        const allCodes = [...new Set(opts.map((f) => f.error_code))];
        const allNames = [...new Set(opts.map((f) => f.error_name))];
        if (!seedKeysRef.current.codes) setSelectedCodes(new Set(allCodes));
        if (!seedKeysRef.current.names) setSelectedNames(new Set(allNames));
      })
      .catch(() => {});
  }, [domain]);

  const { entries, loading, loadingMore, error, sentinelRef } =
    useInfiniteScroll({
      enabled: !!domain,
      resetKey: `${domain}|${appliedCodesKey}|${appliedNamesKey}`,
      fetchPage: (cursor: ErrorCursor | null) =>
        fetchDomainErrors({
          domain,
          errorCodes: appliedCodes,
          errorNames: appliedNames,
          cursor,
        }),
    });

  // Distinct codes and names for filter pills
  const distinctCodes = [...new Set(filterOptions.map((f) => f.error_code))];
  const distinctNames = [...new Set(filterOptions.map((f) => f.error_name))];

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
    </PageContainer>
  );
}
