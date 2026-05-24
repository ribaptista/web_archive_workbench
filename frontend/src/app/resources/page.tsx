export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import ResourcesPageClient from './PageClient';

export default function ResourcesPage() {
  return (
    <Suspense
      fallback={
        <div className="p-4 text-sm text-muted-foreground">Loading...</div>
      }
    >
      <ResourcesPageClient />
    </Suspense>
  );
}
