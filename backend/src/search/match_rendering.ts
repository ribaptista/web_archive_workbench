import { SearchMatchRow } from './repository';

interface ContextMatch extends SearchMatchRow {
  offset_in_context: number;
}

export interface ContextWindow {
  context: string;
  matches: ContextMatch[];
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function highlightMatches(
  context: string,
  matches: { offset_in_context: number; match_length: number }[],
): string {
  const sorted = [...matches].sort(
    (a, b) => a.offset_in_context - b.offset_in_context,
  );
  let result = '';
  let pos = 0;
  for (const m of sorted) {
    result += escapeHtml(context.slice(pos, m.offset_in_context));
    result += `<strong>${escapeHtml(context.slice(m.offset_in_context, m.offset_in_context + m.match_length))}</strong>`;
    pos = m.offset_in_context + m.match_length;
  }
  result += escapeHtml(context.slice(pos));
  return result;
}

const MAX_MERGED_CONTEXT_LENGTH = 256;

export function mergeContextWindows(
  fileContent: string,
  rawMatches: SearchMatchRow[],
  contextLength: number,
): ContextWindow[] {
  if (rawMatches.length === 0) return [];

  const sorted = [...rawMatches].sort(
    (a, b) => a.match_offset - b.match_offset,
  );
  const windows: {
    ctxStart: number;
    ctxEnd: number;
    matches: SearchMatchRow[];
  }[] = [];

  for (const m of sorted) {
    const ctxStart = Math.max(0, m.match_offset - contextLength);
    const ctxEnd = Math.min(
      fileContent.length,
      m.match_offset + m.match_length + contextLength,
    );
    if (
      windows.length > 0 &&
      ctxStart <= windows[windows.length - 1].ctxEnd &&
      ctxEnd - windows[windows.length - 1].ctxStart <= MAX_MERGED_CONTEXT_LENGTH
    ) {
      const last = windows[windows.length - 1];
      last.ctxEnd = Math.max(last.ctxEnd, ctxEnd);
      last.matches.push(m);
    } else {
      windows.push({ ctxStart, ctxEnd, matches: [m] });
    }
  }

  return windows.map(({ ctxStart, ctxEnd, matches }) => ({
    context: fileContent.slice(ctxStart, ctxEnd),
    matches: matches.map((m) => ({
      ...m,
      offset_in_context: m.match_offset - ctxStart,
    })),
  }));
}
