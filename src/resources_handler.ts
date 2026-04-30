import type { Database as DB } from 'better-sqlite3';
import type { Eta } from 'eta';

type TreeNodeRow = { path: string; level: number; is_leaf: number };

export function renderResources(
  db: DB,
  eta: Eta,
  filterPath: string | null,
  filterLevel: number,
): string {
  let nodes: TreeNodeRow[];
  if (filterPath === null) {
    nodes = db
      .prepare<[], TreeNodeRow>(
        `SELECT tn.path, tn.level, CASE WHEN r.url IS NOT NULL THEN 1 ELSE 0 END AS is_leaf
         FROM tree_node tn
         LEFT JOIN resource r ON r.url = tn.path
         WHERE tn.level = 0
         ORDER BY tn.path`,
      )
      .all();
  } else {
    nodes = db
      .prepare<[number, string], TreeNodeRow>(
        `SELECT tn.path, tn.level, CASE WHEN r.url IS NOT NULL THEN 1 ELSE 0 END AS is_leaf
         FROM tree_node tn
         LEFT JOIN resource r ON r.url = tn.path
         WHERE tn.level = ?
           AND tn.path LIKE ? ESCAPE '\\'
         ORDER BY tn.path`,
      )
      .all(filterLevel + 1, filterPath.replace(/[%_\\]/g, '\\$&') + '%');
  }

  return (
    eta.render('./resources', { nodes, path: filterPath }) ??
    '<h1>Template error</h1>'
  );
}
