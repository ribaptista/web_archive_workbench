'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Spinner } from '@/components/ui/spinner';
import { PageContainer } from '@/components/PageContainer';
import { ErrorMessage } from '@/components/ui/error-message';
import { PathBreadcrumb } from '@/components/PathBreadcrumb';
import type { BreadcrumbPart } from '@/components/PathBreadcrumb';
import { VersionRow } from './VersionRow';
import { fetchListVersions } from '@/lib/api';
import { resourcesRoute } from '@/lib/routes';
import { useInfiniteScroll } from '@/lib/useInfiniteScroll';

export default function ListVersionsPageClient() {
  const router = useRouter();
  const params = useSearchParams();
  const originalUrl = params.get('originalUrl');
  const url = originalUrl ?? params.get('url') ?? '';

  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbPart[]>([]);

  const {
    entries: versions,
    loading,
    loadingMore,
    error,
    sentinelRef,
  } = useInfiniteScroll({
    enabled: !!url,
    resetKey: `${url}|${originalUrl ?? ''}`,
    fetchPage: (cursor: number | null) =>
      fetchListVersions({
        url,
        originalUrl: originalUrl ?? undefined,
        cursor,
      }).then((d) => ({
        entries: d.versions,
        nextCursor: d.nextCursor,
        breadcrumbs: d.breadcrumbs,
      })),
    onFirstPage: (d) => setBreadcrumbs(d.breadcrumbs),
  });

  if (!url) return <ErrorMessage message="Missing url parameter" />;
  if (error) return <ErrorMessage message={error} />;
  if (loading) return <Spinner />;

  return (
    <PageContainer>
      <PathBreadcrumb
        className="mb-4"
        crumbs={breadcrumbs}
        rootLabel="All domains"
        onRootClick={() => router.push(resourcesRoute())}
        onCrumbClick={(path, level) => router.push(resourcesRoute(path, level))}
      />

      <h1 className="text-xl font-bold mb-1">Versions</h1>
      <p className="text-muted-foreground text-sm mb-4 break-all">{url}</p>

      {versions.length === 0 ? (
        <p className="text-muted-foreground">No versions found.</p>
      ) : (
        <ul className="divide-y border rounded-md">
          {versions.map((v) => (
            <VersionRow key={`${v.url}@${v.timestamp}`} v={v} />
          ))}
        </ul>
      )}

      {/* Sentinel — triggers next page load when scrolled into view */}
      <div ref={sentinelRef} className="py-4 flex justify-center">
        {loadingMore && <Spinner />}
      </div>
    </PageContainer>
  );
}
