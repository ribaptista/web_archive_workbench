'use client';

import { useCallback, useState } from 'react';
import type { ReadonlyURLSearchParams } from 'next/navigation';
import type { Cursor } from './types';

/**
 * Maintains a Prev/Next stack of cursors for paginated results, seeded from
 * the URL's `cursor_timestamp` + `cursor_request_id` params on first render.
 *
 * The caller is responsible for pushing URL changes when navigating; this
 * hook only owns the stack state.
 */
export function useCursorHistory(params: ReadonlyURLSearchParams) {
  const [history, setHistory] = useState<Array<Cursor | null>>(() => {
    const ts = params.get('cursor_timestamp');
    const id = params.get('cursor_request_id');
    return ts && id ? [null, { timestamp: Number(ts), requestId: id }] : [null];
  });

  const currentCursor = history[history.length - 1];
  const hasPrev = history.length > 1;

  const push = useCallback((cursor: Cursor) => {
    setHistory((prev) => [...prev, cursor]);
  }, []);

  const pop = useCallback((): Cursor | null => {
    let popped: Cursor | null = null;
    setHistory((prev) => {
      const next = prev.slice(0, -1);
      popped = next[next.length - 1];
      return next;
    });
    return popped;
  }, []);

  const reset = useCallback(() => setHistory([null]), []);

  return { currentCursor, hasPrev, push, pop, reset };
}
