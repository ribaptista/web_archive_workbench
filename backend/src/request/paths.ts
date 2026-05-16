import path from 'path';
import { randomUUID } from 'crypto';

/**
 * Builds a nested directory path from an id by splitting it into
 * `depth` segments of `segmentLength` characters each as subdirectories,
 * then appending the full id.
 *
 * Examples:
 *   nestedIdPath('/base', 'abcdefgh', 2, 1) => '/base/a/b/abcdefgh'
 *   nestedIdPath('/base', 'abcdefgh', 3, 2) => '/base/ab/cd/ef/abcdefgh'
 */
function nestedIdPath(
  baseDir: string,
  id: string,
  depth: number,
  segmentLength: number,
): string {
  if (id.length < depth * segmentLength)
    throw new Error(
      `id "${id}" is too short for depth=${depth}, segmentLength=${segmentLength}`,
    );
  const prefixes: string[] = [];
  for (let i = 0; i < depth; i++) {
    prefixes.push(id.slice(i * segmentLength, (i + 1) * segmentLength));
  }
  return path.join(baseDir, ...prefixes, id);
}

/**
 * Returns a unique temporary file path within the run's tmp directory.
 */
export function buildTmpPath(outputFolder: string, runId: string): string {
  const id = randomUUID();
  return nestedIdPath(path.join(outputFolder, 'runs', runId, 'tmp'), id, 2, 2);
}

/**
 * Returns the path for storing a raw gzip response body.
 */
export function buildGzipPath(
  outputFolder: string,
  runId: string,
  requestId: string,
  decompressSucceeded: boolean,
): string {
  const subdir = decompressSucceeded ? 'gzip' : 'gzip_failed';
  const dir = path.join(outputFolder, 'runs', runId, subdir);
  return nestedIdPath(dir, requestId, 2, 2);
}

/**
 * Returns the path of the asset file for a given body digest within a
 * base output folder.
 */
export function buildAssetPath(baseFolder: string, bodyDigest: string): string {
  return nestedIdPath(path.join(baseFolder, 'assets'), bodyDigest, 2, 2);
}
