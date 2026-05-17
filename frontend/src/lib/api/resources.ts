import type { BreadcrumbPart } from '@/components/PathBreadcrumb';

export interface TreeNode {
  path: string;
  level: number;
  is_leaf: number;
}

export interface ResourcesData {
  nodes: TreeNode[];
  nextCursor: string | null;
  path: string | null;
  breadcrumbs: BreadcrumbPart[];
}

export interface ResourcesParams {
  path?: string | null;
  level?: number;
  cursor?: string | null;
}

export async function fetchResources(
  params: ResourcesParams,
): Promise<ResourcesData> {
  const q = new URLSearchParams();
  if (params.path != null) {
    q.set('path', params.path);
    q.set('level', String(params.level ?? 0));
  }
  if (params.cursor) q.set('cursor', params.cursor);
  const res = await fetch(`/api/resources?${q}`);
  if (!res.ok) throw new Error(res.statusText);
  return res.json();
}

export interface Version {
  url: string;
  timestamp: number;
  successful_request_id: string | null;
  status: 'pending' | 'error' | 'ok' | 'redirect';
  error_code: string | null;
  error_message: string | null;
  location_original: string | null;
  location_timestamp: number | null;
}

export interface ListVersionsData {
  url: string;
  versions: Version[];
  nextCursor: number | null;
  breadcrumbs: BreadcrumbPart[];
}

export interface ListVersionsParams {
  url?: string;
  originalUrl?: string;
  cursor?: number | null;
}

export async function fetchListVersions(
  params: ListVersionsParams,
): Promise<ListVersionsData> {
  const q = new URLSearchParams(
    params.originalUrl
      ? { originalUrl: params.originalUrl }
      : { url: params.url ?? '' },
  );
  if (params.cursor != null) q.set('cursor', String(params.cursor));
  const res = await fetch(`/api/list_versions?${q}`);
  if (!res.ok) throw new Error(res.statusText);
  return res.json();
}
