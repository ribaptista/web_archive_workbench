'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { PageContainer } from '@/components/PageContainer';
import { ToggleGroupWithSelectAll } from '@/components/ToggleGroupWithSelectAll';
import { ConditionGroup } from './ConditionGroup';
import { validateConditions } from './validateConditions';
import { createSearch, fetchDomains } from '@/lib/api';
import { searchResultsRoute } from '@/lib/routes';
import type { Condition } from './ConditionCard';
import type { Domain } from '@/lib/api';

export default function SearchFormPage() {
  const router = useRouter();
  const [domains, setDomains] = useState<Domain[]>([]);
  const [selectedDomains, setSelectedDomains] = useState<Set<string>>(
    new Set(),
  );
  const [conditions, setConditions] = useState<Condition[]>([
    { regex: '', notRegexNearby: '' },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDomains()
      .then((loaded) => {
        setDomains(loaded);
        setSelectedDomains(new Set(loaded.map((d) => d.name)));
      })
      .catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const validationError = validateConditions(conditions);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    try {
      const data = await createSearch({
        conditions,
        domainIds: Array.from(selectedDomains),
      });
      router.push(searchResultsRoute({ searchId: data.searchId }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PageContainer>
      <h1 className="text-2xl font-bold mb-6">New Search</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        <ConditionGroup value={conditions} onChange={setConditions} />

        <ToggleGroupWithSelectAll
          label="Domains"
          items={domains.map((d) => ({ id: d.name, label: d.name }))}
          selected={selectedDomains}
          onChange={setSelectedDomains}
        />

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button type="submit" disabled={submitting}>
          {submitting ? 'Running…' : 'Run Search'}
        </Button>
      </form>
    </PageContainer>
  );
}
