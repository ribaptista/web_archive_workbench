"use client";

export const dynamic = 'force-dynamic';

import { useEffect, useRef, useState, useCallback } from "react";
import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Spinner } from "@/components/ui/spinner";
import { ErrorMessage } from "@/components/ui/error-message";
import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbSeparator,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";

interface TreeNode {
  path: string;
  level: number;
  is_leaf: number;
}

interface BreadcrumbPart {
  label: string;
  path: string;
  level: number;
}

interface ResourcesData {
  nodes: TreeNode[];
  nextCursor: string | null;
  path: string | null;
  breadcrumbs: BreadcrumbPart[];
}

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
    const q = new URLSearchParams();
    if (filterPath !== null) {
      q.set("path", filterPath);
      q.set("level", String(filterLevel));
    }
    if (cursor) q.set("cursor", cursor);
    (append ? setLoadingMore : setLoading)(true);
    fetch(`/api/resources?${q}`)
      .then((r) => {
        if (!r.ok) throw new Error(r.statusText);
        return r.json() as Promise<ResourcesData>;
      })
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

      <Breadcrumb className="mb-4">
        <BreadcrumbList>
          {breadcrumbs.length === 0 ? (
            <BreadcrumbItem>
              <BreadcrumbPage>All domains</BreadcrumbPage>
            </BreadcrumbItem>
          ) : (
            <>
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
                        onClick={() => navigateTo(crumb.path, crumb.level)}
                        className="cursor-pointer"
                      >
                        {crumb.label}
                      </BreadcrumbLink>
                    )}
                  </BreadcrumbItem>
                </React.Fragment>
              ))}
            </>
          )}
        </BreadcrumbList>
      </Breadcrumb>

      {nodes.length === 0 ? (
        <p className="text-muted-foreground">No entries found.</p>
      ) : (
        <ul className="divide-y border rounded-md">
          {nodes.map((node) => (
            <li key={node.path} className="flex items-center gap-2 px-4 py-2 text-sm">
              {node.is_leaf ? (
                <>
                  <button
                    className="text-primary break-all text-left hover:underline"
                    onClick={() =>
                      router.push(`/list_versions?url=${encodeURIComponent(node.path)}`)
                    }
                  >
                    {node.path}
                  </button>
                  <Badge variant="default" className="shrink-0">resource</Badge>
                </>
              ) : (
                <button
                  className="text-primary break-all text-left hover:underline"
                  onClick={() => navigateTo(node.path, node.level)}
                >
                  {node.path}
                </button>
              )}
            </li>
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
