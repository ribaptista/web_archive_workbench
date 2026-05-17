"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { DomainStats } from "@/lib/api";

export function DomainStatsCard({ d }: { d: DomainStats }) {
  return (
    <Card>
      <CardHeader className="py-3 px-4 pb-0">
        <p className="font-semibold">{d.name}</p>
      </CardHeader>
      <CardContent className="px-4 py-3 flex flex-wrap gap-2">
        <Badge variant="secondary">{d.resources} resources</Badge>
        <Badge variant="default">{d.successful_entry_count} downloaded</Badge>
        {d.errored_entry_count > 0 && (
          <Badge variant="destructive" className="cursor-pointer p-0">
            <a
              href={`/domain_errors?domain=${encodeURIComponent(d.name)}`}
              className="px-2.5 py-0.5 block"
            >
              {d.errored_entry_count} errored
            </a>
          </Badge>
        )}
        {d.pending_entry_count > 0 && (
          <Badge variant="outline">{d.pending_entry_count} pending</Badge>
        )}
      </CardContent>
    </Card>
  );
}
