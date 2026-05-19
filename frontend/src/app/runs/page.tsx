'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { PageContainer } from '@/components/PageContainer';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { ErrorMessage } from '@/components/ui/error-message';
import { fetchRuns } from '@/lib/api';
import type { RunStats } from '@/lib/api';
import { BadgeStatisticsCard } from '@/components/BadgeStatisticsCard';

export default function RunsPage() {
  const [runs, setRuns] = useState<RunStats[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchRuns()
      .then(setRuns)
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <ErrorMessage message={error} />;
  if (runs === null) return <Spinner />;

  return (
    <PageContainer>
      <h1 className="text-2xl font-bold mb-6">Runs</h1>

      {runs && runs.length === 0 && (
        <p className="text-muted-foreground">No runs found.</p>
      )}

      {runs && runs.length > 0 && (
        <div className="space-y-4">
          {runs.map((run) => {
            const errorsByDomain = run.errors_by_domain
              .filter((d) => d.count > 0)
              .map((d) => ({
                name: d.domain,
                count: d.count,
                subcategories: run.errors_by_type
                  .filter((e) => e.domain === d.domain)
                  .map((e) => ({
                    name: `${e.error_name} ${e.error_code || '(no code)'}`,
                    count: e.count,
                  })),
              }));

            return (
              <Card key={run.id}>
                <CardHeader className="py-3 px-4 pb-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="font-mono text-sm font-semibold truncate">
                      {run.id}
                    </p>
                    <p className="text-xs text-muted-foreground whitespace-nowrap">
                      {run.created_at}
                    </p>
                  </div>
                  {run.args.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {run.args.map((a, i) => (
                        <Badge
                          key={i}
                          variant="secondary"
                          className="font-mono text-xs font-normal"
                        >
                          {a.arg_name}={a.arg_value}
                        </Badge>
                      ))}
                    </div>
                  )}
                </CardHeader>
                <CardContent className="px-4 pb-4 space-y-3">
                  <BadgeStatisticsCard
                    label="New CDX entries"
                    total={run.new_entry_count}
                  />
                  <BadgeStatisticsCard
                    label="Requested"
                    total={run.requested_total}
                    byCategory={run.requested_by_domain.map((d) => ({
                      name: d.domain,
                      count: d.count,
                    }))}
                  />
                  <BadgeStatisticsCard
                    label="Downloaded"
                    total={run.downloaded_total}
                    variant="default"
                    byCategory={run.downloaded_by_domain.map((d) => ({
                      name: d.domain,
                      count: d.count,
                    }))}
                  />

                  {run.errors_total > 0 && (
                    <BadgeStatisticsCard
                      label="Errors"
                      total={run.errors_total}
                      variant="destructive"
                      byCategory={errorsByDomain}
                    />
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </PageContainer>
  );
}
