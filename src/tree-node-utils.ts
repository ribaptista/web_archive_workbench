import type { Database as DB } from 'better-sqlite3';

const URL_REGEX = /^([a-zA-Z][a-zA-Z0-9+.-]*:(?:\/\/)?[^\/]+)(\/[^\/]*)*$/;

export function getPathParts(original: string): string[] {
  const matches = URL_REGEX.exec(original);
  if (!matches) {
    throw new Error(`URL does not match expected pattern: ${original}`);
  }
  const base = matches[1];
  const pathSuffix = original.slice(base.length);
  if (pathSuffix === '') return [base];
  const qIdx = pathSuffix.indexOf('?');
  const pathPart = qIdx === -1 ? pathSuffix : pathSuffix.slice(0, qIdx);
  const queryPart = qIdx === -1 ? '' : pathSuffix.slice(qIdx); // includes leading '?'
  const segments = pathPart
    .split('/')
    .slice(1)
    .map((s) => '/' + s);
  if (queryPart !== '' && segments.length > 0) {
    segments[segments.length - 1] += queryPart;
  }
  return [base, ...segments];
}

export function insertTreeNodePaths(db: DB, originals: string[]): void {
  const seen: Set<string> = new Set();
  const insertTreeNode = db.prepare<[string, number]>(`
    INSERT INTO tree_node (path, level) VALUES (?, ?)
    ON CONFLICT DO NOTHING
  `);

  for (const original of originals) {
    const parts = getPathParts(original);
    for (let i = 0; i < parts.length; i++) {
      const path = parts.slice(0, i + 1).join('');
      if (!seen.has(path)) {
        seen.add(path);
        insertTreeNode.run(path, i);
      }
    }
  }
}
