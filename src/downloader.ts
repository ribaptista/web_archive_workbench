import fs from "fs";
import path from "path";
import { promisify } from "util";
import { gunzip } from "zlib";
import { createHash } from "crypto";
import { request as undiciRequest } from "undici";
import mime from "mime-types";
import type { DB } from "./db";
import { pickProxy, type ProxyEntry } from "./proxy";

const gunzipAsync = promisify(gunzip);

const GZIP_MAGIC = Buffer.from([0x1f, 0x8b]);
const WAYBACK_URL_RE = /^https?:\/\/web\.archive\.org\/web\/(\d+)id_\/(.+)$/;
const ABORT_CONTROLLER_TIMEOUT_MS = 40_000;
const HEADER_TIMEOUT_MS = 10_000;
const BODY_TIMEOUT_MS = 20_000;
const MAX_REDIRECT_COUNT = 20;

interface ParsedWaybackUrl {
  timestamp: string;
  original: string;
}

function parseWaybackUrl(url: string): ParsedWaybackUrl | null {
  const m = WAYBACK_URL_RE.exec(url);
  if (!m) return null;
  return { timestamp: m[1], original: m[2] };
}

function buildWaybackUrl(timestamp: number | null, original: string): string {
  return `https://web.archive.org/web/${timestamp ?? ""}id_/${original}`;
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
    method: "GET",
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

function isRedirect(status: number): boolean {
  return status >= 300 && status <= 399;
}

function getLocation(
  headers: Record<string, string | string[] | undefined>,
): string[] {
  const val = headers["location"];
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

export interface DownloadTask {
  cdxEntryId: number;
  runId: string;
  line: number;
  timestamp: number | null;
  original: string;
  mimetype: string;
  outputFolder: string;
}

export async function downloadEntry(
  db: DB,
  task: DownloadTask,
  proxies: ProxyEntry[],
): Promise<boolean> {
  const insertRequest = db.prepare(`
    INSERT INTO request (run_id, cdx_entry_id, url, original, timestamp, attempt, redirect_chain_count, is_terminal, status_code, body_digest, inferred_gzip, duration_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertRequestError = db.prepare(`
    INSERT INTO request_errors (request_id, error_code, error_message)
    VALUES (?, ?, ?)
  `);
  const insertHeader = db.prepare(`
    INSERT INTO response_header (request_id, header_name, header_value)
    VALUES (?, ?, ?)
  `);

  let currentUrl = buildWaybackUrl(task.timestamp, task.original);
  let redirectChainCount = 0;
  const attempt = 0;
  const { runId, outputFolder } = task;

  while (true) {
    const proxy = pickProxy(proxies);
    proxy.ongoing++;

    const parsedUrl = parseWaybackUrl(currentUrl);
    const urlOriginal = parsedUrl?.original ?? null;
    const urlTimestamp = parsedUrl?.timestamp ?? null;

    // Isolated fetch — only network/timeout errors are caught here.
    let response: RawResponse;
    let fetchDurationMs: number | null = null;
    let fetchStart: number | null = null;
    try {
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
      const fetchErrResult = insertRequest.run(
        runId,
        task.cdxEntryId,
        currentUrl,
        urlOriginal,
        urlTimestamp,
        attempt,
        redirectChainCount,
        0,
        null,
        null,
        0,
        fetchDurationMs,
      );
      insertRequestError.run(
        fetchErrResult.lastInsertRowid,
        "general",
        (err as Error).message,
      );
      return false;
    }

    // Everything below is post-fetch. Errors here propagate and crash the script.
    const statusCode = response.status;
    const responseHeaders = response.headers;
    const errors: Array<{ code: string; message: string }> = [];

    const locationHeaders = getLocation(responseHeaders);
    let locationHeader: string | null = null;
    if (locationHeaders.length === 1) {
      locationHeader = locationHeaders[0];
    }
    const maxRedirectsReached =
      isRedirect(statusCode) &&
      locationHeader !== null &&
      redirectChainCount >= MAX_REDIRECT_COUNT;
    const terminal =
      !isRedirect(statusCode) || locationHeader === null || maxRedirectsReached;

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
          code: "gzip",
          message: `Gzip decompression failed: ${(e as Error).message}`,
        });
        finalBody = null;
      }
    }

    if (isRedirect(statusCode) && locationHeader === null) {
      errors.push({
        code: "redirect_no_location",
        message: `Redirect response (${statusCode}) missing Location header`,
      });
    }

    if (isRedirect(statusCode) && locationHeaders.length > 1) {
      errors.push({
        code: "multiple_location_headers",
        message: `Multiple Location headers received: ${locationHeaders.join(", ")}`,
      });
    }

    if (maxRedirectsReached) {
      errors.push({
        code: "redirect_limit_exceeded",
        message: `Redirect chain exceeded maxium hop count`,
      });
    }

    const hasArchiveOrigHeaders = Object.keys(responseHeaders).some((k) =>
      k.toLowerCase().startsWith("x-archive-orig-"),
    );

    if (!isRedirect(statusCode) && !hasArchiveOrigHeaders) {
      errors.push({
        code: "missing_original_headers",
        message: "Response missing x-archive-orig-* headers",
      });
    }

    // Compute digest
    let bodyDigest: string | null = null;
    if (finalBody) {
      bodyDigest = createHash("sha256").update(finalBody).digest("base64url");
    }

    // Insert request row, errors, and headers in a single transaction
    const insertAll = db.transaction(() => {
      const insertResult = insertRequest.run(
        runId,
        task.cdxEntryId,
        currentUrl,
        urlOriginal,
        urlTimestamp,
        attempt,
        redirectChainCount,
        terminal ? 1 : 0,
        statusCode,
        bodyDigest,
        inferredGzip ? 1 : 0,
        fetchDurationMs,
      );
      const requestId = insertResult.lastInsertRowid as number;

      for (const { code, message } of errors) {
        insertRequestError.run(requestId, code, message);
      }

      for (const [name, value] of Object.entries(responseHeaders)) {
        if (value === undefined) continue;
        const values = Array.isArray(value) ? value : [value];
        for (const v of values) {
          insertHeader.run(requestId, name, v);
        }
      }

      return requestId;
    });
    const requestId = insertAll();

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
      await saveFinalBody(
        finalBody!,
        bodyDigest,
        requestId,
        outputFolder,
        runId,
      );
    }
    if (terminal && bodyDigest && hasArchiveOrigHeaders) {
      const finalAssetPath = path.join(
        outputFolder,
        "assets",
        bodyDigest[0],
        bodyDigest,
      );
      await createSymlink(
        currentUrl,
        urlOriginal,
        urlTimestamp,
        task.line,
        task.mimetype,
        bodyDigest,
        finalAssetPath,
        outputFolder,
      );
    }

    // Follow redirect
    if (!terminal && locationHeader) {
      redirectChainCount++;
      currentUrl = new URL(locationHeader, currentUrl).toString();
      continue;
    }

    // Done — success if terminal and no errors recorded
    return terminal && errors.length === 0;
  }
}

async function saveRawBody(
  rawBody: Buffer,
  decompressSucceeded: boolean,
  requestId: number,
  outputFolder: string,
  runId: string,
): Promise<void> {
  const gzipSubdir = decompressSucceeded ? "gzip" : "gzip_failed";
  const gzipDir = path.join(outputFolder, "raw_responses", runId, gzipSubdir);
  await fs.promises.mkdir(gzipDir, { recursive: true });
  await fs.promises.writeFile(path.join(gzipDir, String(requestId)), rawBody);
}

async function saveFinalBody(
  finalBody: Buffer,
  digest: string,
  requestId: number,
  outputFolder: string,
  runId: string,
): Promise<void> {
  const assetsDir = path.join(outputFolder, "assets", digest[0]);
  const finalAssetPath = path.join(assetsDir, digest);

  await fs.promises.mkdir(assetsDir, { recursive: true });

  // Write final body to tmp location first, then rename to avoid concurrent writes
  const tmpDir = path.join(outputFolder, "raw_responses", runId, "tmp");
  await fs.promises.mkdir(tmpDir, { recursive: true });
  const tmpPath = path.join(tmpDir, String(requestId));
  await fs.promises.writeFile(tmpPath, finalBody);

  // Rename to final location (skip if already exists - same digest)
  try {
    await fs.promises.rename(tmpPath, finalAssetPath);
  } catch (err: unknown) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === "EEXIST") {
      // File already exists with same digest - just remove tmp
      await fs.promises.unlink(tmpPath).catch(() => {});
    } else {
      throw err;
    }
  }
}

async function createSymlink(
  _currentUrl: string,
  urlOriginal: string | null,
  urlTimestamp: string | null,
  line: number,
  mimetype: string,
  digest: string,
  finalAssetPath: string,
  outputFolder: string,
): Promise<void> {
  if (!urlOriginal) return;

  // Replace non-safe characters with percent-encoded versions
  // Safe chars: . - _ / a-z A-Z 0-9
  let safePath = urlOriginal.replace(/[^.\-_/a-zA-Z0-9]/g, (ch) => {
    return encodeURIComponent(ch);
  });

  // Replace all `/` occurrences with `/%2F`
  safePath = safePath.replace(/\//g, "/%2F");

  // Truncate any path part longer than 128 chars to first 64 + `_` + sha256(part, base64)
  safePath = safePath
    .split("/")
    .map((part) => {
      if (part.length <= 128) return part;
      const hash = createHash("sha256").update(part).digest("base64url");
      return `${part.slice(0, 64)}_${hash}`;
    })
    .join("/");

  // Determine extension from mimetype
  const ext =
    mime.extension(mimetype) || mimetype.replace(/[^a-zA-Z0-9\-_]/g, "_");
  const extSuffix = `.${ext}`;

  // Build final symlink filename
  const linkName = `${safePath}_${urlTimestamp ?? "null"}_${line}_${digest}${extSuffix}`;
  const symlinkPath = path.join(outputFolder, linkName);

  // Ensure parent directory exists
  await fs.promises.mkdir(path.dirname(symlinkPath), { recursive: true });

  // Create symlink (relative path from symlink location to asset)
  const relTarget = path.relative(path.dirname(symlinkPath), finalAssetPath);

  try {
    await fs.promises.symlink(relTarget, symlinkPath);
  } catch (err: unknown) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === "EEXIST") {
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
}
