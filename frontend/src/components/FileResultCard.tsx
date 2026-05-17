'use client';

import * as LucideIcons from 'lucide-react';
import { replayUrl } from '@/lib/replay';
import { Card, CardContent } from '@/components/ui/card';
import { Toggle } from '@/components/ui/toggle';
import { Badge } from '@/components/ui/badge';

export interface ContextMatch {
  offset_in_context: number;
  match_length: number;
}

export interface ContextWindow {
  context: string;
  matches: ContextMatch[];
}

export interface ReactionType {
  id: number;
  label: string;
  icon: string;
}

export function DynamicIcon({
  name,
  active,
}: {
  name: string;
  active: boolean;
}) {
  const Icon = (LucideIcons as Record<string, unknown>)[name] as
    | React.ElementType
    | undefined;
  if (!Icon) return <span className="text-xs">{name}</span>;
  const fillable = [
    'Heart',
    'Star',
    'Bookmark',
    'ThumbsUp',
    'ThumbsDown',
  ].includes(name);
  return (
    <Icon
      size={16}
      fill={fillable && active ? 'currentColor' : 'none'}
      strokeWidth={fillable && active ? 0 : active ? 2.5 : 1.5}
    />
  );
}

export function highlightContext(win: ContextWindow): React.ReactNode {
  const { context, matches } = win;
  const sorted = [...matches].sort(
    (a, b) => a.offset_in_context - b.offset_in_context,
  );
  const parts: React.ReactNode[] = [];
  let pos = 0;
  sorted.forEach((m, i) => {
    if (m.offset_in_context > pos)
      parts.push(
        <span key={`t${i}`}>{context.slice(pos, m.offset_in_context)}</span>,
      );
    parts.push(
      <strong key={`m${i}`}>
        {context.slice(
          m.offset_in_context,
          m.offset_in_context + m.match_length,
        )}
      </strong>,
    );
    pos = m.offset_in_context + m.match_length;
  });
  if (pos < context.length)
    parts.push(<span key="tail">{context.slice(pos)}</span>);
  return <>{parts}</>;
}

export function formatTimestamp(ts: string): string {
  if (ts.length === 14)
    return `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;
  return ts;
}

export interface MatchedCondition {
  id: number;
  regex: string;
  not_regex_nearby: string | null;
}

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
  bodyDigest,
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
  const reactionKey = (rtId: number) =>
    `${resourceVersionUrl}|${resourceVersionTimestamp}:${rtId}`;
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
              <ul className="space-y-1">
                {contextWindows.map((win, i) => (
                  <li key={i} className="text-sm whitespace-pre-wrap break-all">
                    {highlightContext(win)}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {reactionTypes.length > 0 && (
            <div className="flex flex-col gap-1 mt-2">
              <div className="flex flex-row flex-wrap gap-1">
                {reactionTypes.map((rt) => {
                  const isActive = activeReactions.has(reactionKey(rt.id));
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
