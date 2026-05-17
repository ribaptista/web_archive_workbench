import type { ContextWindow } from '@/lib/api/shared';

/**
 * Renders a context window with matched substrings wrapped in <strong>.
 */
export function HighlightedContext({ window: win }: { window: ContextWindow }) {
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
