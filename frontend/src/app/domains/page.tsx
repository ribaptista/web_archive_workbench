"use client";

export const dynamic = 'force-dynamic';

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { ErrorMessage } from "@/components/ui/error-message";

interface DomainStats {
  name: string;
  resources: number;
  successful_entry_count: number;
  errored_entry_count: number;
  pending_entry_count: number;
}

export default function DomainsPage() {
  const [domains, setDomains] = useState<DomainStats[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/domains/stats")
      .then((r) => {
        if (!r.ok) throw new Error(r.statusText);
        return r.json();
      })
      .then(setDomains)
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <ErrorMessage message={error} />;
  if (domains === null) return <Spinner />;

  return (
    <div className="container max-w-5xl py-8 mx-auto px-4">
      <h1 className="text-2xl font-bold mb-6">Domains</h1>

      {domains && domains.length === 0 && (
        <p className="text-muted-foreground">No domains found.</p>
      )}

      {domains && domains.length > 0 && (
        <div className="space-y-3">
          {domains.map((d) => (
            <Card key={d.name}>
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
          ))}
        </div>
      )}
    </div>
  );
}
