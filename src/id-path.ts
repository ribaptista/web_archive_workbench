import path from 'path';

/**
 * Builds a nested directory path from an id by using its first `depth`
 * characters as intermediate subdirectories, then appending the full id.
 *
 * Examples:
 *   nestedIdPath('/base', 'abc123', 1) => '/base/a/abc123'
 *   nestedIdPath('/base', 'abc123', 2) => '/base/a/b/abc123'
 */
export function nestedIdPath(
  baseDir: string,
  id: string,
  depth: number,
): string {
  const prefixes: string[] = [];
  for (let i = 0; i < depth; i++) {
    prefixes.push(id[i]);
  }
  return path.join(baseDir, ...prefixes, id);
}
