import type { Database as DB } from 'better-sqlite3';
import { getPathParts } from './tree-node-utils';

const PAGE_SIZE = 100;

type TreeNodeRow = { path: string; level: number; is_leaf: number };

export function getResourcesData(
  db: DB,
  filterPath: string | null,
  filterLevel: number,
  cursor: string | null,
) {
  let nodes: TreeNodeRow[];
  if (filterPath === null) {
    nodes = db
      .prepare<[string, number], TreeNodeRow>(
        `SELECT tn.path, tn.level, CASE WHEN r.url IS NOT NULL THEN 1 ELSE 0 END AS is_leaf
         FROM tree_node tn
         LEFT JOIN resource r ON r.url = tn.path
         WHERE tn.level = 0
           AND tn.path > ?
         ORDER BY tn.path
         LIMIT ?`,
      )
      .all(cursor ?? '', PAGE_SIZE);
  } else {
    nodes = db
      .prepare<[number, string, string, number], TreeNodeRow>(
        `SELECT tn.path, tn.level, CASE WHEN r.url IS NOT NULL THEN 1 ELSE 0 END AS is_leaf
         FROM tree_node tn
         LEFT JOIN resource r ON r.url = tn.path
         WHERE tn.level = ?
           AND tn.path LIKE ? ESCAPE '\\'
           AND tn.path > ?
         ORDER BY tn.path
         LIMIT ?`,
      )
      .all(
        filterLevel + 1,
        filterPath.replace(/[%_\\]/g, '\\$&') + '%',
        cursor ?? '',
        PAGE_SIZE,
      );
  }

  const nextCursor =
    nodes.length === PAGE_SIZE ? nodes[nodes.length - 1].path : null;

  let breadcrumbs: { label: string; path: string; level: number }[] = [];
  if (filterPath !== null) {
    const parts = getPathParts(filterPath);
    breadcrumbs = parts.map((_, i) => ({
      label: parts[i],
      path: parts.slice(0, i + 1).join(''),
      level: i,
    }));
  }

  return { nodes, nextCursor, path: filterPath, breadcrumbs };
}
