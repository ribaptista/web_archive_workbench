import type { ReactNode } from 'react';

/**
 * Standard page wrapper: centered, max-width, vertical padding.
 * Use as the outermost element of every top-level page.
 */
export function PageContainer({ children }: { children: ReactNode }) {
  return (
    <div className="container max-w-5xl py-8 mx-auto px-4">{children}</div>
  );
}
