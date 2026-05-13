"use client";

export const dynamic = 'force-dynamic';

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { ErrorMessage } from "@/components/ui/error-message";

interface RunArg {
  arg_name: string;
  arg_value: string;
}

interface DomainCount {
  domain: string;
  count: number;
}

interface ErrorType {
  domain: string;
  error_name: string | null;
  error_code: string;
  count: number;
}

interface RunStats {
  id: string;
  created_at: string;
  args: RunArg[];
  new_cdx_entry_count: number;
  requested_total: number;
  requested_by_domain: DomainCount[];
  downloaded_total: number;
  downloaded_by_domain: DomainCount[];
  errors_total: number;
  errors_by_domain: DomainCount[];
  errors_by_type: ErrorType[];
}

export default function RunsPage() {
  const [runs, setRuns] = useState<RunStats[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/runs")
      .then((r) => {
        if (!r.ok) throw new Error(r.statusText);
        return r.json();
      })
      .then(setRuns)
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <ErrorMessage message={error} />;
  if (runs === null) return <Spinner />;

  return (
    <div className="container max-w-5xl py-8 mx-auto px-4">
      <h1 className="text-2xl font-bold mb-6">Runs</h1>

      {runs && runs.length === 0 && (
        <p className="text-muted-foreground">No runs found.</p>
      )}

      {runs && runs.length > 0 && (
        <div className="space-y-4">
          {runs.map((run) => (
            <Card key={run.id}>
              <CardHeader className="py-3 px-4 pb-2">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="font-mono text-sm font-semibold truncate">{run.id}</p>
                  <p className="text-xs text-muted-foreground whitespace-nowrap">{run.created_at}</p>
                </div>
                {run.args.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {run.args.map((a, i) => (
                      <Badge key={i} variant="secondary" className="font-mono text-xs font-normal">
                        {a.arg_name}={a.arg_value}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-3">

                {/* CDX entries */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-28 shrink-0">New CDX entries</span>
                  <Badge variant="outline">{run.new_cdx_entry_count}</Badge>
                </div>

                {/* Requested */}
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs text-muted-foreground w-28 shrink-0">Requested</span>
                    <Badge variant="outline">{run.requested_total}</Badge>
                  </div>
                  {run.requested_by_domain.length > 1 && (
                    <div className="flex flex-wrap gap-1 ml-[7.5rem]">
                      {run.requested_by_domain.map((d) => (
                        <Badge key={d.domain} variant="secondary" className="text-xs font-normal">
                          {d.domain}: {d.count}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>

                {/* Downloaded */}
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs text-muted-foreground w-28 shrink-0">Downloaded</span>
                    <Badge variant="default">{run.downloaded_total}</Badge>
                  </div>
                  {run.downloaded_by_domain.length > 1 && (
                    <div className="flex flex-wrap gap-1 ml-[7.5rem]">
                      {run.downloaded_by_domain.map((d) => (
                        <Badge key={d.domain} variant="secondary" className="text-xs font-normal">
                          {d.domain}: {d.count}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>

                {/* Errors */}
                {run.errors_total > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs text-muted-foreground w-28 shrink-0">Errors</span>
                      <Badge variant="destructive">{run.errors_total}</Badge>
                    </div>
                    {run.errors_by_domain.filter((d) => d.count > 0).map((d) => {
                      const domainErrors = run.errors_by_type.filter((e) => e.domain === d.domain);
                      return (
                        <div key={d.domain} className="ml-[7.5rem] mb-2">
                          <Badge variant="secondary" className="text-xs font-normal mb-1">
                            {d.domain}: {d.count}
                          </Badge>
                          {domainErrors.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {domainErrors.map((e, i) => (
                                <Badge key={i} variant="outline" className="font-mono text-xs font-normal">
                                  {e.error_name ? `${e.error_name} ` : ""}{e.error_code}: {e.count}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
