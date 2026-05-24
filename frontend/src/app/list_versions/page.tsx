export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import ListVersionsPageClient from './ListVersionsPageClient';

export default function ListVersionsPage() {
  return (
    <Suspense
      fallback={
        <div className="p-4 text-sm text-muted-foreground">Loading...</div>
      }
    >
      <ListVersionsPageClient />
    </Suspense>
  );
}
