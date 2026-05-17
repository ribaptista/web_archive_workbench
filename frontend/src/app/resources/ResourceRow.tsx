'use client';

import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { listVersionsRoute } from '@/lib/routes';
import type { TreeNode } from '@/lib/api';

interface LeafRowProps {
  path: string;
}

function LeafRow({ path }: LeafRowProps) {
  const router = useRouter();
  return (
    <>
      <button
        className="text-primary break-all text-left hover:underline"
        onClick={() => router.push(listVersionsRoute(path))}
      >
        {path}
      </button>
      <Badge variant="default" className="shrink-0">
        resource
      </Badge>
    </>
  );
}

interface BranchRowProps {
  path: string;
  level: number;
  onNavigate: (path: string, level: number) => void;
}

function BranchRow({ path, level, onNavigate }: BranchRowProps) {
  return (
    <button
      className="text-primary break-all text-left hover:underline"
      onClick={() => onNavigate(path, level)}
    >
      {path}
    </button>
  );
}

interface ResourceRowProps {
  node: TreeNode;
  onNavigate: (path: string, level: number) => void;
}

export function ResourceRow({ node, onNavigate }: ResourceRowProps) {
  return (
    <li className="flex items-center gap-2 px-4 py-2 text-sm">
      {node.is_leaf ? (
        <LeafRow path={node.path} />
      ) : (
        <BranchRow
          path={node.path}
          level={node.level}
          onNavigate={onNavigate}
        />
      )}
    </li>
  );
}
