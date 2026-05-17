'use client';

import { useCallback, type RefObject } from 'react';
import { flushSync } from 'react-dom';

/**
 * Returns a `scrollIntoTarget(beforeScroll)` callback that:
 *
 *   1. Synchronously flushes the React updates queued inside `beforeScroll`
 *      so any DOM changes (e.g. hiding a filter panel) are applied first.
 *   2. Scrolls so the top of `targetRef.current` sits `offsetTop` pixels
 *      below the viewport top.
 *
 * Useful when a click both updates UI state *and* should bring a list back
 * into view: scrolling before the flush would target a stale position.
 */
export function useScrollOnNavigate(
  targetRef: RefObject<HTMLElement | null>,
  offsetTop = 16,
) {
  return useCallback(
    (beforeScroll?: () => void) => {
      if (beforeScroll) flushSync(beforeScroll);
      const el = targetRef.current;
      if (!el) return;
      window.scrollTo({
        top: el.getBoundingClientRect().top + window.scrollY - offsetTop,
      });
    },
    [targetRef, offsetTop],
  );
}
