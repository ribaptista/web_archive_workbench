'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Spinner } from '@/components/ui/spinner';
import { PageContainer } from '@/components/PageContainer';
import { ErrorMessage } from '@/components/ui/error-message';
import { Button } from '@/components/ui/button';
import { fetchSearches, deleteSearch } from '@/lib/api';
import type { Search, SearchesData } from '@/lib/api';
import { SearchCard } from './SearchCard';

export default function SearchesPage() {
  const router = useRouter();
  const [data, setData] = useState<SearchesData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const load = useCallback(() => {
    fetchSearches()
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!autoRefresh || !data?.hasRunning) return;
    const id = setTimeout(load, 3000);
    return () => clearTimeout(id);
  }, [autoRefresh, data, load]);

  async function handleDelete(id: number) {
    if (!confirm(`Delete search #${id} and all its results?`)) return;
    await deleteSearch(id);
    load();
  }

  if (error) return <ErrorMessage message={error} />;
  if (data === null) return <Spinner />;

  return (
    <PageContainer>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">All Searches</h1>
        <div className="flex gap-2">
          {data.hasRunning && (
            <>
              <Button variant="outline" size="sm" onClick={load}>
                ↻ Refresh
              </Button>
              <Button
                variant={autoRefresh ? 'default' : 'outline'}
                size="sm"
                onClick={() => setAutoRefresh((v) => !v)}
              >
                Auto Refresh: {autoRefresh ? 'On' : 'Off'}
              </Button>
            </>
          )}
          <Button size="sm" onClick={() => router.push('/search_form')}>
            + New Search
          </Button>
        </div>
      </div>
      {data.searches.length === 0 && (
        <p className="text-muted-foreground">No searches yet.</p>
      )}

      <div className="space-y-3">
        {data.searches.map((s) => (
          <SearchCard key={s.id} s={s} onDelete={handleDelete} />
        ))}
      </div>
    </PageContainer>
  );
}
