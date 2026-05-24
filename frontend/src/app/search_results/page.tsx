export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import SearchResultsPageClient from './PageClient';

export default function SearchResultsPage() {
  return (
    <Suspense
      fallback={
        <div className="p-4 text-sm text-muted-foreground">Loading...</div>
      }
    >
      <SearchResultsPageClient />
    </Suspense>
  );
}
