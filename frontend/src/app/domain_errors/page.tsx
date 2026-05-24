export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import DomainErrorsPageClient from './PageClient';

export default function DomainErrorsPage() {
  return (
    <Suspense
      fallback={
        <div className="p-4 text-sm text-muted-foreground">Loading...</div>
      }
    >
      <DomainErrorsPageClient />
    </Suspense>
  );
}
