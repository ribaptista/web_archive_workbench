"use client";

import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { Search } from "@/lib/api";

function StatusBadge({ status }: { status: string }) {
  if (status === "done") return <Badge variant="default">done</Badge>;
  if (status === "running") return <Badge>running</Badge>;
  if (status === "error") return <Badge variant="destructive">error</Badge>;
  return <Badge variant="secondary">{status}</Badge>;
}

interface Props {
  s: Search;
  onDelete: (id: number) => void;
}

export function SearchCard({ s, onDelete }: Props) {
  const router = useRouter();
  const pct = s.file_count > 0
    ? Math.round((s.scanned_file_count / s.file_count) * 100)
    : 0;

  return (
    <Card>
      <CardContent className="py-3">
        <div className="flex justify-between items-start mb-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold">Search #{s.id}</span>
            <span className="text-muted-foreground text-sm">{s.created_at}</span>
            <StatusBadge status={s.status} />
          </div>
          <div className="flex gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push(`/search_results?search_id=${s.id}`)}
            >
              View results
            </Button>
            <Button variant="outline" size="sm" onClick={() => onDelete(s.id)}>
              Delete
            </Button>
          </div>
        </div>

        <div className="text-sm mb-1">
          <span className="text-muted-foreground">Domains: </span>
          {s.domains.length > 0 ? (
            s.domains.map((d) => (
              <Badge key={d} variant="outline" className="mr-1">{d}</Badge>
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
              <span>{s.scanned_file_count} / {s.file_count} ({pct}%)</span>
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
}
