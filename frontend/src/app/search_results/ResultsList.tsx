'use client';

import type { RefObject } from 'react';
import { FileResultCard } from '@/components/FileResultCard';
import { CursorPagination } from '@/components/CursorPagination';
import type { FileResult, SearchResultsData } from '@/lib/api';

interface Props {
  data: SearchResultsData;
  loading: boolean;
  filterLoading: boolean;
  similarTo: string | undefined;
  filterReactionTypeIds: number[];
  activeReactions: Set<string>;
  headingRef: RefObject<HTMLHeadingElement | null>;
  pagination: {
    hasPrev: boolean;
    hasNext: boolean;
    onPrev: () => void;
    onNext: () => void;
  };
  onToggleReaction: (
    url: string,
    timestamp: number,
    reactionTypeId: number,
  ) => void;
  onSimilarClick: (file: FileResult) => void;
  onBackToDedup: () => void;
}

export function ResultsList({
  data,
  loading,
  filterLoading,
  similarTo,
  filterReactionTypeIds,
  activeReactions,
  headingRef,
  pagination,
  onToggleReaction,
  onSimilarClick,
  onBackToDedup,
}: Props) {
  const { files, totalFiles } = data;
  const showDuplicateCounts = !similarTo && filterReactionTypeIds.length === 0;

  return (
    <>
      <h2
        ref={headingRef}
        className={`text-base font-semibold mb-2 transition-opacity ${filterLoading ? 'opacity-50' : ''}`}
      >
        Files with Matches ({totalFiles})
      </h2>

      <div
        className={`transition-opacity ${loading ? 'opacity-50 pointer-events-none' : ''}`}
      >
        {similarTo && (
          <div className="bg-muted text-muted-foreground text-sm rounded px-3 py-2 mb-3">
            Showing all results with context digest: <code>{similarTo}</code>
            {' — '}
            <button className="underline" onClick={onBackToDedup}>
              Back to deduplicated results
            </button>
          </div>
        )}

        <div className="mb-3">
          <CursorPagination {...pagination} />
        </div>

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
                matchCount={file.match_count}
                duplicateCount={
                  showDuplicateCounts ? file.duplicate_count : undefined
                }
                contextWindows={
                  'contextWindows' in file ? file.contextWindows : undefined
                }
                fileError={'fileError' in file ? file.fileError : undefined}
                reactionTypes={data.reactionTypes}
                activeReactions={activeReactions}
                onToggleReaction={onToggleReaction}
                similarGroupReactionTypeIds={
                  showDuplicateCounts && file.context_digest
                    ? data.similarGroupReactions[file.context_digest]
                    : undefined
                }
                onSimilarClick={
                  showDuplicateCounts && file.duplicate_count > 1
                    ? () => onSimilarClick(file)
                    : undefined
                }
              />
            ))}
          </div>
        )}

        <div className="mt-3">
          <CursorPagination {...pagination} />
        </div>
      </div>
    </>
  );
}
