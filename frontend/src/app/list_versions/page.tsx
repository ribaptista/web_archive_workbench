"use client";

export const dynamic = 'force-dynamic';

import { useEffect, useRef, useState, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Spinner } from "@/components/ui/spinner";
import { ErrorMessage } from "@/components/ui/error-message";
import { PathBreadcrumb } from "@/components/PathBreadcrumb";
import type { BreadcrumbPart } from "@/components/PathBreadcrumb";
import { VersionRow } from "./VersionRow";
import { fetchListVersions } from "@/lib/api";
import type { Version, ListVersionsData } from "@/lib/api";

function ListVersionsInner() {
  const router = useRouter();
  const params = useSearchParams();
  const originalUrl = params.get("originalUrl");
  const url = originalUrl ?? params.get("url") ?? "";

  const [versions, setVersions] = useState<Version[]>([]);
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbPart[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const fetchPage = useCallback((cursor: number | null, append: boolean) => {
    (append ? setLoadingMore : setLoading)(true);
    fetchListVersions({ url, originalUrl: originalUrl ?? undefined, cursor })
      .then((data) => {
        if (!append) setBreadcrumbs(data.breadcrumbs);
        setVersions((prev) => append ? [...prev, ...data.versions] : data.versions);
        setNextCursor(data.nextCursor);
      })
      .catch((e) => setError(e.message))
      .finally(() => (append ? setLoadingMore : setLoading)(false));
  }, [url, originalUrl]);

  useEffect(() => {
    if (!url) return;
    setVersions([]);
    setNextCursor(null);
    setError(null);
    fetchPage(null, false);
  }, [fetchPage]);

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
      <PathBreadcrumb
        className="mb-4"
        crumbs={breadcrumbs}
        rootLabel="All domains"
        onRootClick={() => router.push("/resources")}
        onCrumbClick={(path, level) => router.push(`/resources?path=${encodeURIComponent(path)}&level=${level}`)}
      />

      <h1 className="text-xl font-bold mb-1">Versions</h1>
      <p className="text-muted-foreground text-sm mb-4 break-all">{url}</p>

      {versions.length === 0 ? (
        <p className="text-muted-foreground">No versions found.</p>
      ) : (
        <ul className="divide-y border rounded-md">
          {versions.map((v) => (
            <VersionRow key={`${v.url}@${v.timestamp}`} v={v} />
          ))}
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
