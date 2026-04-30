import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { gunzip } from 'zlib';
import { createHash, randomUUID } from 'crypto';
import { request as undiciRequest } from 'undici';
import mime from 'mime-types';
import type { DB } from './db';
import { pickProxy, type ProxyEntry } from './proxy';
import { htmlExtractToFiles } from './html_ndjson';
import { insertTreeNodePaths } from './tree-node-utils';
import { nestedIdPath } from './id-path';

const gunzipAsync = promisify(gunzip);

const GZIP_MAGIC = Buffer.from([0x1f, 0x8b]);
const WAYBACK_URL_RE = /^https?:\/\/web\.archive\.org\/web\/(\d+)id_\/(.+)$/;
const ABORT_CONTROLLER_TIMEOUT_MS = 40_000;
const HEADER_TIMEOUT_MS = 10_000;
const BODY_TIMEOUT_MS = 20_000;
const MAX_REDIRECT_COUNT = 20;

interface ParsedWaybackUrl {
  timestamp: number;
  original: string;
}

function parseWaybackUrl(url: string): ParsedWaybackUrl | null {
  const m = WAYBACK_URL_RE.exec(url);
  if (!m) return null;
  return { timestamp: parseInt(m[1], 10), original: m[2] };
}

function buildWaybackUrl(timestamp: number | null, original: string): string {
  return `https://web.archive.org/web/${timestamp ?? ''}id_/${original}`;
}

interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

// Use undici.request() which does NOT decompress automatically.
// The Wayback Machine sends `content-encoding: gzip` even for plain text,
// so we ignore that header entirely and detect gzip ourselves via magic bytes.
async function fetchNoRedirect(
  url: string,
  proxy: ProxyEntry,
): Promise<RawResponse> {
  const ac = new AbortController();

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      ac.abort();
      reject(new Error(`request timed out`));
    }, ABORT_CONTROLLER_TIMEOUT_MS);
  });

  const fetchPromise = undiciRequest(url, {
    method: 'GET',
    dispatcher: proxy.agent,
    signal: ac.signal,
    headersTimeout: HEADER_TIMEOUT_MS,
    bodyTimeout: BODY_TIMEOUT_MS,
  }).then(async ({ statusCode, headers, body }) => {
    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<Buffer>) {
      chunks.push(chunk);
    }
    return {
      status: statusCode,
      headers: headers,
      body: Buffer.concat(chunks),
    } as RawResponse;
  });

  // Suppress unhandled rejection if timeout wins the race and fetch fails afterward
  fetchPromise.catch(() => {});
  return Promise.race([fetchPromise, timeoutPromise]);
}

interface RequestError {
  name?: string;
  code: string;
  message: string;
}

function parseError(err: unknown): RequestError {
  if (err instanceof Error) {
    return {
      name: err.name,
      code: (err as { code?: string }).code ?? 'general',
      message: err.message,
    };
  }
  return {
    code: 'general',
    message: `Invalid error object: ${JSON.stringify(err)}`,
  };
}

function isRedirect(status: number): boolean {
  return status >= 300 && status <= 399;
}

function getLocation(
  headers: Record<string, string | string[] | undefined>,
): string[] {
  const val = headers['location'];
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

export interface DownloadTask {
  runId: string;
  timestamp: number | null;
  original: string;
  cdxId: string;
  outputFolder: string;
}

export async function downloadEntry(
  db: DB,
  task: DownloadTask,
  proxies: ProxyEntry[],
): Promise<boolean> {
  const insertRequest = db.prepare(`
    INSERT INTO request (
      id, run_id,
      resource_version_url, resource_version_timestamp,
      status_code, body_digest, inferred_gzip,
      duration_ms, proxy_address, is_successful,
      mimetype, location, location_original, location_timestamp
    ) VALUES (
      ?, ?,
      ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?
    )
  `);
  const insertRequestError = db.prepare(`
    INSERT INTO request_errors (request_id, error_name, error_code, error_message)
    VALUES (?, ?, ?, ?)
  `);
  const insertHeader = db.prepare(`
    INSERT INTO response_header (request_id, header_name, header_value)
    VALUES (?, ?, ?)
  `);
  const insertResource = db.prepare(`
    INSERT OR IGNORE INTO resource (url) VALUES (?)
  `);
  const insertResourceVersion = db.prepare(`
    INSERT OR IGNORE INTO resource_version (url, timestamp) VALUES (?, ?)
  `);
  const insertResourceVersionSource = db.prepare(`
    INSERT OR IGNORE INTO resource_version_source (url, timestamp, cdx_id) VALUES (?, ?, ?)
  `);
  const updateResourceVersionSuccess = db.prepare(`
    UPDATE resource_version
    SET successful_request_id = ?
    WHERE url = ? AND timestamp = ? AND successful_request_id IS NULL
  `);

  let currentUrl = buildWaybackUrl(task.timestamp, task.original);
  let redirectChainCount = 0;
  const { runId, outputFolder } = task;
  const visitedUrls = new Set<string>();

  while (true) {
    const proxy = pickProxy(proxies);
    proxy.ongoing++;

    const parsedUrl = parseWaybackUrl(currentUrl);
    if (!parsedUrl) throw new Error(`Invalid Wayback URL: ${currentUrl}`);
    const urlOriginal = parsedUrl.original;
    const urlTimestamp = parsedUrl.timestamp;

    // Isolated fetch — only network/timeout errors are caught here.
    let response: RawResponse;
    let fetchDurationMs: number | null = null;
    let fetchStart: number | null = null;
    try {
      if (Math.random() < 0) {
        throw new Error(`Simulated random fetch error for testing`);
      }
      try {
        response = await proxy.limiter.schedule(() => {
          fetchStart = Date.now();
          return fetchNoRedirect(currentUrl, proxy);
        });
      } finally {
        if (fetchStart !== null) fetchDurationMs = Date.now() - fetchStart;
        proxy.ongoing--;
      }
    } catch (err) {
      const errorID = randomUUID();
      insertRequest.run(
        errorID,
        runId,
        urlOriginal,
        urlTimestamp,
        null,
        null,
        0,
        fetchDurationMs,
        proxy.address,
        0,
        null,
        null,
        null,
        null,
      );
      const {
        name: errName,
        code: errCode,
        message: errMessage,
      } = parseError(err);
      insertRequestError.run(errorID, errName, errCode, errMessage);
      return false;
    }

    // Everything below is post-fetch. Errors here propagate and crash the script.
    const statusCode = response.status;
    const responseHeaders = response.headers;
    const errors: RequestError[] = [];

    const locationHeaders = getLocation(responseHeaders);
    let locationHeader: string | null = null;
    if (locationHeaders.length === 1) {
      locationHeader = locationHeaders[0];
    }
    const resolvedLocation = locationHeader
      ? new URL(locationHeader, currentUrl).toString()
      : null;
    const parsedRedirectTarget =
      isRedirect(statusCode) && resolvedLocation !== null
        ? parseWaybackUrl(resolvedLocation)
        : null;
    const redirectLoop =
      isRedirect(statusCode) &&
      resolvedLocation !== null &&
      visitedUrls.has(resolvedLocation);
    const maxRedirectsReached =
      isRedirect(statusCode) &&
      locationHeader !== null &&
      redirectChainCount >= MAX_REDIRECT_COUNT;

    // Body is already fully read without any decompression applied
    const rawBody: Buffer = response.body;

    // Detect gzip by magic bytes
    let finalBody: Buffer | null = rawBody;
    let inferredGzip = false;
    if (
      rawBody &&
      rawBody.length >= 2 &&
      rawBody.subarray(0, 2).equals(GZIP_MAGIC)
    ) {
      inferredGzip = true;
      try {
        finalBody = await gunzipAsync(rawBody);
      } catch (e) {
        errors.push({
          code: 'gzip',
          message: `Gzip decompression failed: ${(e as Error).message}`,
        });
        finalBody = null;
      }
    }

    if (isRedirect(statusCode) && locationHeader === null) {
      errors.push({
        code: 'redirect_no_location',
        message: `Redirect response (${statusCode}) missing Location header`,
      });
    }

    if (isRedirect(statusCode) && locationHeaders.length > 1) {
      errors.push({
        code: 'multiple_location_headers',
        message: `Multiple Location headers received: ${locationHeaders.join(', ')}`,
      });
    }

    if (maxRedirectsReached) {
      errors.push({
        code: 'redirect_limit_exceeded',
        message: `Redirect chain exceeded maxium hop count`,
      });
    }

    if (redirectLoop) {
      errors.push({
        code: 'redirect_loop',
        message: `Redirect loop detected: ${resolvedLocation} was already visited`,
      });
    }

    const hasArchiveOrigHeaders = Object.keys(responseHeaders).some((k) =>
      k.toLowerCase().startsWith('x-archive-orig-'),
    );

    if (!isRedirect(statusCode) && !hasArchiveOrigHeaders) {
      errors.push({
        code: 'missing_original_headers',
        message: 'Response missing x-archive-orig-* headers',
      });
    }

    if (isRedirect(statusCode) && parsedRedirectTarget === null) {
      errors.push({
        code: 'redirect_target_not_in_archive',
        message: `Redirect target is not a Wayback Machine archive URL: ${resolvedLocation}`,
      });
    }

    // Compute digest
    let bodyDigest: string | null = null;
    if (finalBody) {
      bodyDigest = createHash('sha256').update(finalBody).digest('base64url');
    }

    const requestId = randomUUID();
    const contentTypeRaw = responseHeaders['content-type'];
    const contentTypeStr = Array.isArray(contentTypeRaw)
      ? contentTypeRaw[0]
      : (contentTypeRaw ?? null);
    const responseMimetype = contentTypeStr
      ? contentTypeStr.split(';')[0].trim()
      : null;
    const isSuccessful = errors.length === 0;

    // Insert request row, errors, and headers in a single transaction
    let redirectTargetIsNew = false;
    let isNewSuccessfulRequest = false;
    const insertAll = db.transaction(() => {
      insertRequest.run(
        requestId,
        runId,
        urlOriginal,
        urlTimestamp,
        statusCode,
        bodyDigest,
        inferredGzip ? 1 : 0,
        fetchDurationMs,
        proxy.address,
        isSuccessful ? 1 : 0,
        responseMimetype,
        locationHeader,
        parsedRedirectTarget?.original ?? null,
        parsedRedirectTarget?.timestamp ?? null,
      );

      for (const { name = null, code, message } of errors) {
        insertRequestError.run(requestId, name, code, message);
      }

      for (const [name, value] of Object.entries(responseHeaders)) {
        if (value === undefined) continue;
        const values = Array.isArray(value) ? value : [value];
        for (const v of values) {
          insertHeader.run(requestId, name, v);
        }
      }

      if (isRedirect(statusCode) && errors.length === 0) {
        insertTreeNodePaths(db, [parsedRedirectTarget!.original]);
        insertResource.run(parsedRedirectTarget!.original);
        const r = insertResourceVersion.run(
          // non-null inferred from if condition
          parsedRedirectTarget!.original,
          parsedRedirectTarget!.timestamp,
        );
        redirectTargetIsNew = r.changes > 0;
        insertResourceVersionSource.run(
          parsedRedirectTarget!.original,
          parsedRedirectTarget!.timestamp,
          task.cdxId,
        );
      }

      if (isSuccessful) {
        const ur = updateResourceVersionSuccess.run(
          requestId,
          urlOriginal,
          urlTimestamp,
        );
        isNewSuccessfulRequest = ur.changes > 0;
      }
    });

    let finalAssetPath: string | null = null;
    let symlinkPath: string | null = null;

    if (inferredGzip) {
      await saveRawBody(
        rawBody,
        finalBody !== null,
        requestId,
        outputFolder,
        runId,
      );
    }
    if (bodyDigest) {
      finalAssetPath = nestedIdPath(
        path.join(outputFolder, 'assets'),
        bodyDigest,
        2,
      );
      const isNewFile = await saveFinalBody(
        finalBody!,
        finalAssetPath,
        requestId,
        outputFolder,
        runId,
      );
      if (isNewFile && responseMimetype === 'text/html') {
        await htmlExtractToFiles(finalAssetPath, finalAssetPath, {
          skipTags: [
            'script',
            'style',
            'head',
            'template',
            'meta',
            'link',
            'base',
            'noscript',
            'svg',
            'math',
          ],
        });
      }
      symlinkPath = await createSymlink(
        currentUrl,
        urlOriginal,
        urlTimestamp,
        requestId,
        responseMimetype,
        bodyDigest,
        finalAssetPath,
        outputFolder,
      );
    }

    insertAll();

    if (isSuccessful && !isNewSuccessfulRequest) {
      await deleteGeneratedFiles(symlinkPath);
    }

    // Follow redirect
    if (
      isRedirect(statusCode) &&
      parsedRedirectTarget !== null &&
      isSuccessful
    ) {
      if (!redirectTargetIsNew) {
        return true; // redirect target already exists, work is done
      }
      visitedUrls.add(currentUrl);
      redirectChainCount++;
      currentUrl = resolvedLocation!;
      continue;
    }

    // Done — success if terminal and no errors recorded
    return isSuccessful;
  }
}

async function saveRawBody(
  rawBody: Buffer,
  decompressSucceeded: boolean,
  requestId: string,
  outputFolder: string,
  runId: string,
): Promise<void> {
  const gzipSubdir = decompressSucceeded ? 'gzip' : 'gzip_failed';
  const gzipDir = path.join(outputFolder, 'raw_responses', runId, gzipSubdir);
  await fs.promises.mkdir(gzipDir, { recursive: true });
  await fs.promises.writeFile(nestedIdPath(gzipDir, requestId, 2), rawBody);
}

async function saveFinalBody(
  finalBody: Buffer,
  finalAssetPath: string,
  requestId: string,
  outputFolder: string,
  runId: string,
): Promise<boolean> {
  await fs.promises.mkdir(path.dirname(finalAssetPath), { recursive: true });

  // Write final body to tmp location first, then rename to avoid concurrent writes
  const tmpDir = path.join(outputFolder, 'raw_responses', runId, 'tmp');
  await fs.promises.mkdir(tmpDir, { recursive: true });
  const tmpPath = path.join(tmpDir, String(requestId));
  await fs.promises.writeFile(tmpPath, finalBody);

  // Rename to final location (skip if already exists - same digest)
  try {
    await fs.promises.rename(tmpPath, finalAssetPath);
    return true;
  } catch (err: unknown) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === 'EEXIST') {
      // File already exists with same digest - just remove tmp
      await fs.promises.unlink(tmpPath).catch(() => {});
      return false;
    } else {
      throw err;
    }
  }
}

async function deleteGeneratedFiles(symlinkPath: string | null): Promise<void> {
  if (symlinkPath) {
    await fs.promises.unlink(symlinkPath).catch(() => {});
  }
}

async function createSymlink(
  _currentUrl: string,
  urlOriginal: string,
  urlTimestamp: number,
  requestId: string,
  mimetype: string | null,
  digest: string,
  finalAssetPath: string,
  outputFolder: string,
): Promise<string> {
  // Replace non-safe characters with percent-encoded versions
  // Safe chars: . - _ / a-z A-Z 0-9
  let safePath = urlOriginal.replace(/[^.\-_/a-zA-Z0-9]/g, (ch) => {
    return encodeURIComponent(ch);
  });

  // Replace all `/` occurrences with `/%2F`
  safePath = safePath.replace(/\//g, '/%2F');

  // Truncate any path part longer than 128 chars to first 64 + `_` + sha256(part, base64)
  safePath = safePath
    .split('/')
    .map((part) => {
      if (part.length <= 128) return part;
      const hash = createHash('sha256').update(part).digest('base64url');
      return `${part.slice(0, 64)}_${hash}`;
    })
    .join('/');

  const ext = mimetype
    ? mime.extension(mimetype) || mimetype.replace(/[^a-zA-Z0-9\-_]/g, '_')
    : 'bin';
  const extSuffix = `.${ext}`;

  // Build final symlink filename
  const linkName = `${safePath}_${urlTimestamp}_${requestId}_${digest}${extSuffix}`;
  const symlinkPath = path.join(outputFolder, linkName);

  // Ensure parent directory exists
  await fs.promises.mkdir(path.dirname(symlinkPath), { recursive: true });

  // Create symlink (relative path from symlink location to asset)
  const relTarget = path.relative(path.dirname(symlinkPath), finalAssetPath);

  try {
    await fs.promises.symlink(relTarget, symlinkPath);
  } catch (err: unknown) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === 'EEXIST') {
      const existing = await fs.promises
        .readlink(symlinkPath)
        .catch(() => null);
      if (existing !== relTarget) {
        throw new Error(
          `Output directory is corrupted: symlink at "${symlinkPath}" points to "${existing}" but expected "${relTarget}"`,
        );
      }
    } else {
      throw err;
    }
  }
  return symlinkPath;
}
