'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Spinner } from '@/components/ui/spinner';
import { PageContainer } from '@/components/PageContainer';
import { ErrorMessage } from '@/components/ui/error-message';
import { PathBreadcrumb } from '@/components/PathBreadcrumb';
import type { BreadcrumbPart } from '@/components/PathBreadcrumb';
import { fetchResources } from '@/lib/api';
import { resourcesRoute } from '@/lib/routes';
import { useInfiniteScroll } from '@/lib/useInfiniteScroll';
import { ResourceRow } from './ResourceRow';

export default function ResourcesPageClient() {
  const router = useRouter();
  const params = useSearchParams();
  const filterPath = params.get('path') ?? null;
  const filterLevel =
    filterPath !== null ? Number(params.get('level') ?? '0') : 0;

  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbPart[]>([]);

  const {
    entries: nodes,
    loading,
    loadingMore,
    error,
    sentinelRef,
  } = useInfiniteScroll({
    resetKey: `${filterPath ?? ''}|${filterLevel}`,
    fetchPage: (cursor: string | null) =>
      fetchResources({ path: filterPath, level: filterLevel, cursor }).then(
        (d) => ({
          entries: d.nodes,
          nextCursor: d.nextCursor,
          breadcrumbs: d.breadcrumbs,
        }),
      ),
    onFirstPage: (d) => setBreadcrumbs(d.breadcrumbs),
  });

  function navigateTo(path: string, level: number) {
    router.push(resourcesRoute(path, level));
  }

  if (error) return <ErrorMessage message={error} />;
  if (loading) return <Spinner />;

  return (
    <PageContainer>
      <h1 className="text-2xl font-bold mb-4">Resources</h1>

      <PathBreadcrumb
        className="mb-4"
        crumbs={breadcrumbs}
        rootLabel="All domains"
        onRootClick={() => router.push(resourcesRoute())}
        onCrumbClick={navigateTo}
      />

      {nodes.length === 0 ? (
        <p className="text-muted-foreground">No entries found.</p>
      ) : (
        <ul className="divide-y border rounded-md">
          {nodes.map((node) => (
            <ResourceRow key={node.path} node={node} onNavigate={navigateTo} />
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
