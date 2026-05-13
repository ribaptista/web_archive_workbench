"use client";

export const dynamic = 'force-dynamic';

import { useEffect, useRef, useState, useCallback, Suspense } from "react";
import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Spinner } from "@/components/ui/spinner";
import { ErrorMessage } from "@/components/ui/error-message";
import { Badge } from "@/components/ui/badge";
import { REPLAY_SERVER_URL } from "@/lib/config";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbSeparator,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";

interface Version {
  url: string;
  timestamp: number;
  successful_request_id: string | null;
  status: "pending" | "error" | "ok" | "redirect";
  error_code: string | null;
  error_message: string | null;
  location_original: string | null;
  location_timestamp: number | null;
}

interface BreadcrumbPart {
  label: string;
  path: string;
  level: number;
}

interface ListVersionsData {
  url: string;
  versions: Version[];
  nextCursor: number | null;
  breadcrumbs: BreadcrumbPart[];
}

function statusBadge(status: string) {
  if (status === "ok") return <Badge variant="default">ok</Badge>;
  if (status === "redirect") return <Badge variant="secondary">redirect</Badge>;
  if (status === "error") return <Badge variant="destructive">error</Badge>;
  return <Badge variant="outline">pending</Badge>;
}

function ListVersionsInner() {
  const router = useRouter();
  const params = useSearchParams();
  const url = params.get("url") ?? "";

  const [versions, setVersions] = useState<Version[]>([]);
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbPart[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const fetchPage = useCallback((cursor: number | null, append: boolean) => {
    const q = new URLSearchParams({ url });
    if (cursor !== null) q.set("cursor", String(cursor));
    (append ? setLoadingMore : setLoading)(true);
    fetch(`/api/list_versions?${q}`)
      .then((r) => {
        if (!r.ok) throw new Error(r.statusText);
        return r.json() as Promise<ListVersionsData>;
      })
      .then((data) => {
        if (!append) setBreadcrumbs(data.breadcrumbs);
        setVersions((prev) => append ? [...prev, ...data.versions] : data.versions);
        setNextCursor(data.nextCursor);
      })
      .catch((e) => setError(e.message))
      .finally(() => (append ? setLoadingMore : setLoading)(false));
  }, [url]);

  useEffect(() => {
    if (!url) return;
    setVersions([]);
    setNextCursor(null);
    setError(null);
    fetchPage(null, false);
  }, [fetchPage, url]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && nextCursor !== null && !loadingMore) {
        fetchPage(nextCursor, true);
      }
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [nextCursor, loadingMore, fetchPage]);

  if (!url) return <ErrorMessage message="Missing url parameter" />;
  if (error) return <ErrorMessage message={error} />;
  if (loading) return <Spinner />;

  return (
    <div className="container max-w-5xl py-8 mx-auto px-4">
      <Breadcrumb className="mb-4">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink onClick={() => router.push("/resources")} className="cursor-pointer">
              All domains
            </BreadcrumbLink>
          </BreadcrumbItem>
          {breadcrumbs.map((crumb, i) => (
            <React.Fragment key={crumb.path}>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                {i === breadcrumbs.length - 1 ? (
                  <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink
                    onClick={() => router.push(`/resources?path=${encodeURIComponent(crumb.path)}&level=${crumb.level}`)}
                    className="cursor-pointer"
                  >
                    {crumb.label}
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </React.Fragment>
          ))}
        </BreadcrumbList>
      </Breadcrumb>

      <h1 className="text-xl font-bold mb-1">Versions</h1>
      <p className="text-muted-foreground text-sm mb-4 break-all">{url}</p>

      {versions.length === 0 ? (
        <p className="text-muted-foreground">No versions found.</p>
      ) : (
        <ul className="divide-y border rounded-md">
          {versions.map((v) => {
            const ts = String(v.timestamp);
            return (
              <li key={v.timestamp} className="flex items-center gap-2 px-4 py-2 text-sm flex-wrap">
                {v.status === "ok" || v.status === "redirect" ? (
                  <a
                    className="text-primary hover:underline"
                    href={`${REPLAY_SERVER_URL}/replay/${v.timestamp}/${v.url}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {ts}
                  </a>
                ) : (
                  <span className="text-muted-foreground">{ts}</span>
                )}

                {statusBadge(v.status)}

                {v.status === "redirect" && v.location_original && (
                  <span className="text-muted-foreground text-xs">
                    →{" "}
                    <a
                      className="hover:underline"
                      href={`${REPLAY_SERVER_URL}/replay/${v.location_timestamp}/${v.location_original}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {v.location_original}
                    </a>
                  </span>
                )}

                {v.status === "error" && (
                  <>
                    {v.error_code && <code className="text-xs text-destructive">{v.error_code}</code>}
                    {v.error_message && (
                      <span
                        className="text-muted-foreground text-xs truncate max-w-xs"
                        title={v.error_message}
                      >
                        {v.error_message}
                      </span>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Sentinel — triggers next page load when scrolled into view */}
      <div ref={sentinelRef} className="py-4 flex justify-center">
        {loadingMore && <Spinner />}
      </div>
    </div>
  );
}

export default function ListVersionsPage() {
  return (
    <Suspense>
      <ListVersionsInner />
    </Suspense>
  );
}
