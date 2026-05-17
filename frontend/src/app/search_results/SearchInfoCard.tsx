'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { StatusBadge } from '@/components/StatusBadge';
import type { SearchInfo } from '@/lib/api';

interface Props {
  search: SearchInfo;
  isPending: boolean;
}

export function SearchInfoCard({ search, isPending }: Props) {
  const pct =
    search.file_count > 0
      ? Math.round((search.scanned_file_count / search.file_count) * 100)
      : 0;

  return (
    <Card className="mb-4">
      <CardContent className="py-3 space-y-1 text-sm">
        <p>
          <strong>Search ID:</strong> {search.id}
        </p>
        <p>
          <strong>Created:</strong> {search.created_at}
        </p>
        <p className="flex items-center gap-2">
          <strong>Status:</strong> <StatusBadge status={search.status} />
        </p>
        {isPending && (
          <div className="mt-2">
            <div className="flex justify-between text-xs text-muted-foreground mb-1">
              <span>Scanning files…</span>
              <span>
                {search.scanned_file_count} / {search.file_count} ({pct}%)
              </span>
            </div>
            <Progress value={pct} indeterminate={isPending} className="h-2" />
          </div>
        )}
        {search.status === 'error' && (
          <p className="text-destructive">
            <strong>Error:</strong> {search.error_message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
