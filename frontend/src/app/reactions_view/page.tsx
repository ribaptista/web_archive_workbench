"use client";

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { FileResultCard, DynamicIcon } from "@/components/FileResultCard";
import type { ReactionType, MatchedCondition } from "@/components/FileResultCard";
import { Spinner } from "@/components/ui/spinner";
import { ErrorMessage } from "@/components/ui/error-message";

interface ReactionsViewFile {
  resource_version_url: string;
  resource_version_timestamp: number;
  request_id: string;
  original: string;
  timestamp: string;
}

interface ReactionsViewData {
  files: ReactionsViewFile[];
  urlTimestampKeys: string[];
  totalFiles: number;
  totalPages: number;
  currentPage: number;
  reactionTypes: ReactionType[];
  domains: { id: string; domain: string }[];
  filterDomains: string[];
  activeReactions: string[];
  matchedConditions: Record<string, MatchedCondition[]>;
}

function getPageRange(current: number, total: number): number[] {
  const half = 5;
  let start = Math.max(1, current - half);
  let end = Math.min(total, current + half);
  if (end - start < 10) {
    if (start === 1) end = Math.min(total, start + 10);
    else if (end === total) start = Math.max(1, end - 10);
  }
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

function ReactionsViewInner() {
  const router = useRouter();
  const params = useSearchParams();
  const reactionTypeId = Number(params.get("reaction_type_id") ?? "1");
  const page = Number(params.get("page") ?? "1");
  const filterDomains = params.getAll("domain[]");
  // Stable string for use in dependency arrays — avoids infinite loop from new array refs
  const filterDomainsKey = filterDomains.join(",");

  const [data, setData] = useState<ReactionsViewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeReactions, setActiveReactions] = useState<Set<string>>(new Set());
  const [localDomains, setLocalDomains] = useState<Set<string>>(new Set(filterDomains));

  const load = useCallback(() => {
    const q = new URLSearchParams({
      reaction_type_id: String(reactionTypeId),
      page: String(page),
    });
    for (const d of filterDomainsKey ? filterDomainsKey.split(",") : []) q.append("domain[]", d);
    fetch(`/reactions/?${q}`)
      .then((r) => {
        if (!r.ok) throw new Error(r.statusText);
        return r.json();
      })
      .then((d: ReactionsViewData) => {
        setData(d);
        setActiveReactions(new Set(d.activeReactions));
        setLocalDomains(new Set(d.filterDomains));
      })
      .catch((e) => setError(e.message));
  }, [reactionTypeId, page, filterDomainsKey]);

  useEffect(() => { load(); }, [load]);

  async function toggleReaction(url: string, timestamp: number, rtId: number) {
    const key = `${url}|${timestamp}:${rtId}`;
    const isActive = activeReactions.has(key);
    const res = await fetch("/reactions/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resource_version_url: url, resource_version_timestamp: timestamp, reaction_type_id: rtId, active: !isActive }),
    });
    if (!res.ok) return;
    const result = await res.json();
    setActiveReactions((prev) => {
      const next = new Set(prev);
      for (const rt of data?.reactionTypes ?? []) next.delete(`${url}|${timestamp}:${rt.id}`);
      for (const id of result.activeReactionTypeIds) next.add(`${url}|${timestamp}:${id}`);
      return next;
    });
  }

  function applyDomainFilter(newDomains: Set<string>) {
    const allDomains = data?.domains ?? [];
    const allSelected = allDomains.every((d) => newDomains.has(d.id));
    const u = new URLSearchParams({ reaction_type_id: String(reactionTypeId), page: "1" });
    if (!allSelected) for (const id of newDomains) u.append("domain[]", id);
    router.push(`/reactions_view?${u}`);
  }

  function buildPageUrl(p: number) {
    const u = new URLSearchParams(params.toString());
    u.set("page", String(p));
    return `/reactions_view?${u}`;
  }

  if (error) return <ErrorMessage message={error} />;
  if (data === null) return <Spinner />;

  const reactionTypes = data?.reactionTypes ?? [];
  const domains = data?.domains ?? [];
  const { files = [], totalFiles = 0, totalPages = 1, currentPage = 1 } = data ?? {};

  return (
    <div className="container max-w-5xl py-8 mx-auto px-4">
      <h1 className="text-2xl font-bold mb-4">Reactions</h1>

      {/* Reaction type selector */}
      {reactionTypes.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {reactionTypes.map((rt) => {
            const isSelected = rt.id === reactionTypeId;
            return (
              <Toggle
                key={rt.id}
                pressed={isSelected}
                onPressedChange={() =>
                  router.push(`/reactions_view?reaction_type_id=${rt.id}&page=1`)
                }
                size="sm"
                className="aria-pressed:bg-primary/10 aria-pressed:text-primary data-[state=on]:bg-primary/10 data-[state=on]:text-primary"
              >
                <DynamicIcon name={rt.icon} active={isSelected} />
                {rt.label}
              </Toggle>
            );
          })}
        </div>
      )}

      {/* Domain filter */}
      {domains.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          {domains.map((d) => {
            const active = localDomains.size === 0 || localDomains.has(d.id);
            return (
              <Button
                key={d.id}
                variant={active ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  const allIds = new Set(domains.map((x) => x.id));
                  const current = localDomains.size === 0 ? allIds : new Set(localDomains);
                  if (current.has(d.id)) current.delete(d.id); else current.add(d.id);
                  const isAll = domains.every((x) => current.has(x.id));
                  const next = isAll ? new Set<string>() : current;
                  setLocalDomains(next);
                  applyDomainFilter(next);
                }}
              >
                {d.domain}
              </Button>
            );
          })}
        </div>
      )}

      <h2 className="text-base font-semibold mb-3">
        {totalFiles} result{totalFiles !== 1 ? "s" : ""}
      </h2>

      {/* Pagination top */}
      {totalPages > 1 && (
        <div className="flex flex-wrap gap-1 mb-3">
          <Button
            variant="outline" size="sm"
            disabled={currentPage === 1}
            onClick={() => router.push(buildPageUrl(currentPage - 1))}
          >«</Button>
          {getPageRange(currentPage, totalPages).map((p) => (
            <Button
              key={p}
              variant={p === currentPage ? "default" : "outline"}
              size="sm"
              onClick={() => router.push(buildPageUrl(p))}
            >{p}</Button>
          ))}
          <Button
            variant="outline" size="sm"
            disabled={currentPage === totalPages}
            onClick={() => router.push(buildPageUrl(currentPage + 1))}
          >»</Button>
        </div>
      )}

      {data && files.length === 0 ? (
        <p className="text-muted-foreground">No reactions found.</p>
      ) : (
        <div className="space-y-3">
          {files.map((file) => {
            const key = `${file.resource_version_url}|${file.resource_version_timestamp}`;
            return (
              <FileResultCard
                key={key}
                bodyDigest=""
                resourceVersionUrl={file.resource_version_url}
                resourceVersionTimestamp={file.resource_version_timestamp}
                original={file.original}
                timestamp={file.timestamp}
                reactionTypes={reactionTypes}
                activeReactions={activeReactions}
                onToggleReaction={toggleReaction}
                matchedConditions={data?.matchedConditions[key]}
              />
            );
          })}
        </div>
      )}

      {/* Pagination bottom */}
      {totalPages > 1 && (
        <div className="flex flex-wrap gap-1 mt-3">
          <Button
            variant="outline" size="sm"
            disabled={currentPage === 1}
            onClick={() => router.push(buildPageUrl(currentPage - 1))}
          >«</Button>
          {getPageRange(currentPage, totalPages).map((p) => (
            <Button
              key={p}
              variant={p === currentPage ? "default" : "outline"}
              size="sm"
              onClick={() => router.push(buildPageUrl(p))}
            >{p}</Button>
          ))}
          <Button
            variant="outline" size="sm"
            disabled={currentPage === totalPages}
            onClick={() => router.push(buildPageUrl(currentPage + 1))}
          >»</Button>
        </div>
      )}
    </div>
  );
}

export default function ReactionsViewPage() {
  return <ReactionsViewInner />;
}
