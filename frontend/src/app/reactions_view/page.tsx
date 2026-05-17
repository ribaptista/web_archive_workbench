'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { NumberedPagination } from '@/components/NumberedPagination';
import { FileResultCard } from '@/components/FileResultCard';
import { Spinner } from '@/components/ui/spinner';
import { ErrorMessage } from '@/components/ui/error-message';
import { ToggleGroupWithSelectAll } from '@/components/ToggleGroupWithSelectAll';
import { ToggleIconGroup } from '@/components/ToggleIconGroup';
import {
  fetchReactionsView,
  toggleReaction as apiToggleReaction,
} from '@/lib/api';
import { toast } from 'sonner';
import { reactionsViewRoute } from '@/lib/routes';
import { allSelected } from '@/lib/utils';
import type { ReactionsViewData } from '@/lib/api';

function ReactionsViewInner() {
  const router = useRouter();
  const params = useSearchParams();
  const reactionTypeId = Number(params.get('reaction_type_id') ?? '1');
  const page = Number(params.get('page') ?? '1');
  const filterDomains = params.getAll('domain[]');
  // Stable string for use in dependency arrays — avoids infinite loop from new array refs
  const filterDomainsKey = filterDomains.join(',');

  const [data, setData] = useState<ReactionsViewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeReactions, setActiveReactions] = useState<Set<string>>(
    new Set(),
  );
  const [localDomains, setLocalDomains] = useState<Set<string>>(
    new Set(filterDomains),
  );

  const load = useCallback(() => {
    fetchReactionsView(
      reactionTypeId,
      page,
      filterDomainsKey ? filterDomainsKey.split(',') : [],
    )
      .then((d) => {
        setData(d);
        setActiveReactions(new Set(d.activeReactions));
        setLocalDomains(
          new Set(filterDomainsKey ? filterDomainsKey.split(',') : []),
        );
      })
      .catch((e) => setError(e.message));
  }, [reactionTypeId, page, filterDomainsKey]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleReaction(url: string, timestamp: number, rtId: number) {
    const key = `${url}|${timestamp}:${rtId}`;
    const isActive = activeReactions.has(key);
    const result = await apiToggleReaction(
      url,
      timestamp,
      rtId,
      !isActive,
    ).catch((e: Error) => {
      toast.error(e.message ?? 'Failed to toggle reaction');
      return null;
    });
    if (!result) return;
    setActiveReactions((prev) => {
      const next = new Set(prev);
      for (const rt of data?.reactionTypes ?? [])
        next.delete(`${url}|${timestamp}:${rt.id}`);
      for (const id of result.activeReactionTypeIds)
        next.add(`${url}|${timestamp}:${id}`);
      return next;
    });
  }

  function applyDomainFilter(newDomains: Set<string>) {
    const allDomainIds = (data?.domains ?? []).map((d) => d.id);
    const domains = allSelected(newDomains, allDomainIds)
      ? new Set<string>()
      : newDomains;
    router.push(reactionsViewRoute(reactionTypeId, 1, domains));
  }

  function buildPageUrl(p: number) {
    const u = new URLSearchParams(params.toString());
    u.set('page', String(p));
    return `/reactions_view?${u}`;
  }

  if (error) return <ErrorMessage message={error} />;
  if (data === null) return <Spinner />;

  const reactionTypes = data?.reactionTypes ?? [];
  const domains = data?.domains ?? [];
  const {
    files = [],
    totalFiles = 0,
    totalPages = 1,
    currentPage = 1,
  } = data ?? {};

  return (
    <div className="container max-w-5xl py-8 mx-auto px-4">
      <h1 className="text-2xl font-bold mb-4">Reactions</h1>

      {/* Reaction type selector */}
      <div className="mb-4">
        <ToggleIconGroup
          items={reactionTypes.map((rt) => ({
            id: rt.id,
            label: rt.label,
            icon: rt.icon,
          }))}
          selected={new Set([reactionTypeId])}
          onChange={(next) => {
            const added = [...next].find((id) => id !== reactionTypeId);
            if (added != null)
              router.push(`/reactions_view?reaction_type_id=${added}&page=1`);
          }}
        />
      </div>

      {/* Domain filter */}
      <div className="mb-6">
        <ToggleGroupWithSelectAll
          label="Domains"
          items={domains.map((d) => ({ id: d.id, label: d.domain }))}
          selected={localDomains}
          onChange={(next) => {
            setLocalDomains(next);
            applyDomainFilter(next);
          }}
        />
      </div>

      <h2 className="text-base font-semibold mb-3">
        {totalFiles} result{totalFiles !== 1 ? 's' : ''}
      </h2>

      {/* Pagination top */}
      <NumberedPagination
        currentPage={currentPage}
        totalPages={totalPages}
        buildPageUrl={buildPageUrl}
        onNavigate={router.push}
        className="mb-3"
      />

      {data && files.length === 0 ? (
        <p className="text-muted-foreground">No reactions found.</p>
      ) : (
        <div className="space-y-3">
          {files.map((file) => {
            const key = `${file.resource_version_url}|${file.resource_version_timestamp}`;
            return (
              <FileResultCard
                key={key}
                bodyDigest=""
                resourceVersionUrl={file.resource_version_url}
                resourceVersionTimestamp={file.resource_version_timestamp}
                reactionTypes={reactionTypes}
                activeReactions={activeReactions}
                onToggleReaction={toggleReaction}
                matchedConditions={data?.matchedConditions[key]}
              />
            );
          })}
        </div>
      )}

      {/* Pagination bottom */}
      <NumberedPagination
        currentPage={currentPage}
        totalPages={totalPages}
        buildPageUrl={buildPageUrl}
        onNavigate={router.push}
        className="mt-3"
      />
    </div>
  );
}

export default function ReactionsViewPage() {
  return <ReactionsViewInner />;
}
