"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/ui/spinner";
import { ErrorMessage } from "@/components/ui/error-message";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

interface Condition {
  regex: string;
  not_regex_nearby: string | null;
}

interface Search {
  id: number;
  created_at: string;
  status: string;
  file_count: number;
  scanned_file_count: number;
  error_message: string | null;
  match_file_count: number;
  conditions: Condition[];
  domains: string[];
}

interface SearchesData {
  searches: Search[];
  hasRunning: boolean;
}

function statusBadge(status: string) {
  if (status === "done") return <Badge variant="default">done</Badge>;
  if (status === "running") return <Badge>running</Badge>;
  if (status === "error") return <Badge variant="destructive">error</Badge>;
  return <Badge variant="secondary">{status}</Badge>;
}

export default function SearchesPage() {
  const router = useRouter();
  const [data, setData] = useState<SearchesData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const load = useCallback(() => {
    fetch("/api/searches/")
      .then((r) => {
        if (!r.ok) throw new Error(r.statusText);
        return r.json();
      })
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
    await fetch(`/api/searches/${id}`, { method: "DELETE" });
    load();
  }

  if (error) return <ErrorMessage message={error} />;
  if (data === null) return <Spinner />;

  return (
    <div className="container max-w-5xl py-8 mx-auto px-4">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">All Searches</h1>
        <div className="flex gap-2">
          {data.hasRunning && (
            <>
              <Button variant="outline" size="sm" onClick={load}>
                ↻ Refresh
              </Button>
              <Button
                variant={autoRefresh ? "default" : "outline"}
                size="sm"
                onClick={() => setAutoRefresh((v) => !v)}
              >
                Auto Refresh: {autoRefresh ? "On" : "Off"}
              </Button>
            </>
          )}
          <Button size="sm" onClick={() => router.push("/search_form")}>
            + New Search
          </Button>
        </div>
      </div>
      {data.searches.length === 0 && (
        <p className="text-muted-foreground">No searches yet.</p>
      )}

      <div className="space-y-3">
        {data.searches.map((s) => {
          const pct =
            s.file_count > 0
              ? Math.round((s.scanned_file_count / s.file_count) * 100)
              : 0;
          return (
            <Card key={s.id}>
              <CardContent className="py-3">
                <div className="flex justify-between items-start mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold">Search #{s.id}</span>
                    <span className="text-muted-foreground text-sm">{s.created_at}</span>
                    {statusBadge(s.status)}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => router.push(`/search_results?search_id=${s.id}`)}
                    >
                      View results
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDelete(s.id)}
                    >
                      Delete
                    </Button>
                  </div>
                </div>

                <div className="text-sm mb-1">
                  <span className="text-muted-foreground">Domains: </span>
                  {s.domains.length > 0 ? (
                    s.domains.map((d) => (
                      <Badge key={d} variant="outline" className="mr-1">
                        {d}
                      </Badge>
                    ))
                  ) : (
                    <em>all</em>
                  )}
                </div>

                <div className="text-sm mb-2">
                  <span className="text-muted-foreground">Conditions:</span>
                  <ol className="list-decimal list-inside mt-1 space-y-0.5">
                    {s.conditions.map((c, i) => (
                      <li key={i}>
                        <code>{c.regex}</code>
                        {c.not_regex_nearby && (
                          <> — not nearby: <code>{c.not_regex_nearby}</code></>
                        )}
                      </li>
                    ))}
                  </ol>
                </div>

                {(s.status === "pending" || s.status === "running") && (
                  <div>
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span>Scanning…</span>
                      <span>
                        {s.scanned_file_count} / {s.file_count} ({pct}%)
                      </span>
                    </div>
                    <Progress value={pct} indeterminate className="h-1.5" />
                  </div>
                )}
                {s.status === "error" && (
                  <p className="text-sm text-destructive">
                    <strong>Error:</strong> {s.error_message}
                  </p>
                )}
                {s.status === "done" && (
                  <Badge variant="default">
                    {s.match_file_count} file{s.match_file_count !== 1 ? "s" : ""} with matches
                  </Badge>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
