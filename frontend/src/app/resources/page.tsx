"use client";

export const dynamic = 'force-dynamic';

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Spinner } from "@/components/ui/spinner";
import { ErrorMessage } from "@/components/ui/error-message";
import { PathBreadcrumb } from "@/components/PathBreadcrumb";
import type { BreadcrumbPart } from "@/components/PathBreadcrumb";
import { fetchResources } from "@/lib/api";
import type { TreeNode, ResourcesData } from "@/lib/api";
import { ResourceRow } from "./ResourceRow";

function ResourcesInner() {
  const router = useRouter();
  const params = useSearchParams();
  const filterPath = params.get("path") ?? null;
  const filterLevel = filterPath !== null ? Number(params.get("level") ?? "0") : 0;

  const [nodes, setNodes] = useState<TreeNode[]>([]);
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbPart[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const fetchPage = useCallback((cursor: string | null, append: boolean) => {
    (append ? setLoadingMore : setLoading)(true);
    fetchResources({ path: filterPath, level: filterLevel, cursor })
      .then((data) => {
        if (!append) setBreadcrumbs(data.breadcrumbs);
        setNodes((prev) => append ? [...prev, ...data.nodes] : data.nodes);
        setNextCursor(data.nextCursor);
      })
      .catch((e) => setError(e.message))
      .finally(() => (append ? setLoadingMore : setLoading)(false));
  }, [filterPath, filterLevel]);

  // Reset and load first page whenever the filter changes
  useEffect(() => {
    setNodes([]);
    setNextCursor(null);
    setError(null);
    fetchPage(null, false);
  }, [fetchPage]);

  // Infinite scroll via IntersectionObserver
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && nextCursor && !loadingMore) {
        fetchPage(nextCursor, true);
      }
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [nextCursor, loadingMore, fetchPage]);

  function navigateTo(path: string, level: number) {
    const q = new URLSearchParams({ path, level: String(level) });
    router.push(`/resources?${q}`);
  }

  if (error) return <ErrorMessage message={error} />;
  if (loading) return <Spinner />;

  return (
    <div className="container max-w-5xl py-8 mx-auto px-4">
      <h1 className="text-2xl font-bold mb-4">Resources</h1>

      <PathBreadcrumb
        className="mb-4"
        crumbs={breadcrumbs}
        rootLabel="All domains"
        onRootClick={() => router.push("/resources")}
        onCrumbClick={navigateTo}
      />

      {nodes.length === 0 ? (
        <p className="text-muted-foreground">No entries found.</p>
      ) : (
        <ul className="divide-y border rounded-md">
          {nodes.map((node) => (
            <ResourceRow key={node.path} node={node} onNavigate={navigateTo} />
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

export default function ResourcesPage() {
  return <ResourcesInner />;
}
