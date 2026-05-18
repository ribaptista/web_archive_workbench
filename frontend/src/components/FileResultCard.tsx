'use client';

import { useState } from 'react';
import { replayUrl } from '@/lib/replay';
import { formatTimestamp } from '@/lib/format';
import { reactionKey } from '@/lib/reaction_key';
import { DynamicIcon } from '@/components/ui/dynamic-icon';
import { HighlightedContext } from '@/components/HighlightedContext';
import { Card, CardContent } from '@/components/ui/card';
import { Toggle } from '@/components/ui/toggle';
import { Badge } from '@/components/ui/badge';
import type {
  ContextWindow,
  MatchedCondition,
  ReactionType,
} from '@/lib/api/shared';

export interface FileResultCardProps {
  bodyDigest: string;
  resourceVersionUrl: string;
  resourceVersionTimestamp: number;
  matchCount?: number;
  duplicateCount?: number;
  contextWindows?: ContextWindow[];
  fileError?: string;
  reactionTypes: ReactionType[];
  activeReactions: Set<string>;
  onToggleReaction: (
    url: string,
    timestamp: number,
    reactionTypeId: number,
  ) => void;
  onSimilarClick?: () => void;
  matchedConditions?: MatchedCondition[];
  similarGroupReactionTypeIds?: number[];
}

export function FileResultCard({
  resourceVersionUrl,
  resourceVersionTimestamp,
  matchCount,
  duplicateCount,
  contextWindows,
  fileError,
  reactionTypes,
  activeReactions,
  onToggleReaction,
  onSimilarClick,
  matchedConditions,
  similarGroupReactionTypeIds,
}: FileResultCardProps) {
  return (
    <Card>
      <CardContent className="py-3">
        <div>
          <div className="min-w-0">
            <div className="mb-2">
              <a
                className="font-semibold break-all text-primary underline"
                href={replayUrl(resourceVersionTimestamp, resourceVersionUrl)}
                target="_blank"
                rel="noopener noreferrer"
              >
                {resourceVersionUrl}
              </a>
              {onSimilarClick && (duplicateCount ?? 0) > 1 && (
                <button
                  className="text-xs text-primary underline ml-2"
                  onClick={onSimilarClick}
                >
                  +{(duplicateCount ?? 0) - 1} similar
                </button>
              )}
              <div className="text-muted-foreground text-xs mt-1">
                {formatTimestamp(String(resourceVersionTimestamp))}
                {matchCount !== undefined && (
                  <>
                    {' '}
                    — {matchCount} match{matchCount !== 1 ? 'es' : ''}
                  </>
                )}
              </div>
            </div>
            {matchedConditions && matchedConditions.length > 0 && (
              <div className="my-3">
                <p className="text-xs text-muted-foreground mb-1">
                  Matched search conditions
                </p>
                <div className="flex flex-wrap gap-1">
                  {matchedConditions.map((c) => (
                    <Badge
                      key={c.id}
                      variant="secondary"
                      className="font-mono text-xs font-normal"
                    >
                      {c.regex}
                      {c.not_regex_nearby && (
                        <span className="text-muted-foreground ml-1">
                          · not near {c.not_regex_nearby}
                        </span>
                      )}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {fileError && (
              <p className="text-destructive text-xs">
                <strong>Data error:</strong> {fileError}
              </p>
            )}
            {contextWindows && contextWindows.length > 0 && (
              <ContextWindowList windows={contextWindows} />
            )}
          </div>
          {reactionTypes.length > 0 && (
            <div className="flex flex-col gap-1 mt-2">
              <div className="flex flex-row flex-wrap gap-1">
                {reactionTypes.map((rt) => {
                  const isActive = activeReactions.has(
                    reactionKey(
                      resourceVersionUrl,
                      resourceVersionTimestamp,
                      rt.id,
                    ),
                  );
                  return (
                    <Toggle
                      key={rt.id}
                      pressed={isActive}
                      onPressedChange={() =>
                        onToggleReaction(
                          resourceVersionUrl,
                          resourceVersionTimestamp,
                          rt.id,
                        )
                      }
                      aria-label={rt.label}
                      size="sm"
                      className="aria-pressed:bg-primary/10 aria-pressed:text-primary data-[state=on]:bg-primary/10 data-[state=on]:text-primary"
                    >
                      <DynamicIcon name={rt.icon} active={isActive} />
                      {rt.label !== 'Like' && <span>{rt.label}</span>}
                    </Toggle>
                  );
                })}
              </div>
              {similarGroupReactionTypeIds &&
                similarGroupReactionTypeIds.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {reactionTypes
                      .filter((rt) =>
                        similarGroupReactionTypeIds.includes(rt.id),
                      )
                      .map((rt) => rt.label)
                      .join(', ')}{' '}
                    in similar results
                  </p>
                )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

const CONTEXT_WINDOWS_PREVIEW = 2;

function ContextWindowList({ windows }: { windows: ContextWindow[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible =
    expanded || windows.length <= CONTEXT_WINDOWS_PREVIEW
      ? windows
      : windows.slice(0, CONTEXT_WINDOWS_PREVIEW);
  const hiddenMatches = windows
    .slice(visible.length)
    .reduce((sum, w) => sum + w.matches.length, 0);

  return (
    <>
      <ul className="space-y-1">
        {visible.map((win, i) => (
          <li key={i} className="text-sm whitespace-pre-wrap break-all">
            <HighlightedContext window={win} />
          </li>
        ))}
      </ul>
      {hiddenMatches > 0 && (
        <button
          className="text-xs text-primary underline mt-1"
          onClick={() => setExpanded(true)}
        >
          Show {hiddenMatches} more match{hiddenMatches !== 1 ? 'es' : ''}
        </button>
      )}
      {expanded && windows.length > CONTEXT_WINDOWS_PREVIEW && (
        <button
          className="text-xs text-primary underline mt-1"
          onClick={() => setExpanded(false)}
        >
          Show less
        </button>
      )}
    </>
  );
}
