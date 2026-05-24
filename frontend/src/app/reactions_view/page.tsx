export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import ReactionsViewPageClient from './PageClient';

export default function ReactionsViewPage() {
  return (
    <Suspense
      fallback={
        <div className="p-4 text-sm text-muted-foreground">Loading...</div>
      }
    >
      <ReactionsViewPageClient />
    </Suspense>
  );
}
