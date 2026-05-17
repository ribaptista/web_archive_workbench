'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { Spinner } from '@/components/ui/spinner';
import { PageContainer } from '@/components/PageContainer';
import { ErrorMessage } from '@/components/ui/error-message';
import { fetchDomainStats } from '@/lib/api';
import type { DomainStats } from '@/lib/api';
import { DomainStatsCard } from './DomainStatsCard';

export default function DomainsPage() {
  const [domains, setDomains] = useState<DomainStats[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDomainStats()
      .then(setDomains)
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <ErrorMessage message={error} />;
  if (domains === null) return <Spinner />;

  return (
    <PageContainer>
      <h1 className="text-2xl font-bold mb-6">Domains</h1>

      {domains && domains.length === 0 && (
        <p className="text-muted-foreground">No domains found.</p>
      )}

      {domains && domains.length > 0 && (
        <div className="space-y-3">
          {domains.map((d) => (
            <DomainStatsCard key={d.name} d={d} />
          ))}
        </div>
      )}
    </PageContainer>
  );
}
