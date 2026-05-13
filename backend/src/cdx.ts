import { fetch } from 'undici';
import { v4 as uuidv4 } from 'uuid';
import type { DB } from './db';
import {
  insertTreeNodePaths,
  normalizeUrl,
  normalizeDomain,
} from './tree-node-utils';

export function assertUrlRoundTrip(
  original: string,
  scheme: string,
  domain: string,
  port: number | null,
  pathAndQuery: string,
): void {
  const reconstructed =
    scheme + '://' + domain + (port !== null ? `:${port}` : '') + pathAndQuery;
  if (reconstructed !== original) {
    console.log(original, new URL(original));

    throw new Error(
      `URL round-trip mismatch: original="${original}" reconstructed="${reconstructed}"`,
    );
  }
}

export interface ParsedCdxEntry {
  line: number;
  urlKey: string | null;
  timestamp: number | null;
  original: string | null;
  mimetype: string | null;
  statusCode: number | null;
  digest: string | null;
  length: number | null;
  raw: string;
  isValid: boolean;
  parsedUrl: ParsedUrl | null;
}

export interface ParsedUrl {
  parsedScheme: string;
  parsedDomain: string;
  normalizedPort: number | null;
  parsedPathAndQuery: string;
}

function parseStringField(raw: unknown): string | null {
  return typeof raw === 'string' ? raw : null;
}

function parseIntField(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const n = parseInt(raw);
  return isNaN(n) ? null : n;
}

function parseUrl(url: string): ParsedUrl | null {
  try {
    const u = new URL(url);
    return {
      parsedScheme: u.protocol.replace(/:$/, ''),
      parsedDomain: u.hostname,
      normalizedPort: u.port ? parseInt(u.port) : null,
      parsedPathAndQuery: u.pathname + u.search,
    };
  } catch {
    return null;
  }
}

export function normalizeCdxRow(
  row: unknown,
  line: number,
): ParsedCdxEntry | undefined {
  if (!Array.isArray(row) || row.length !== 7) {
    console.error(
      `Invalid CDX row at index ${line} (not an array or length !== 7):`,
      row,
    );
    return undefined;
  }
  const [
    urlKeyRaw,
    timestampRaw,
    originalRaw,
    mimetypeRaw,
    statusCodeRaw,
    digestRaw,
    lengthRaw,
  ] = row;

  const urlKey = parseStringField(urlKeyRaw);
  const timestamp = parseIntField(timestampRaw);
  const original = parseStringField(originalRaw);
  const mimetype = parseStringField(mimetypeRaw);
  const statusCode = parseIntField(statusCodeRaw);
  const digest = parseStringField(digestRaw);
  const length = parseIntField(lengthRaw);
  let isValid = [timestamp, original].every((v) => v !== null);

  const parsedUrl = original !== null ? parseUrl(original) : null;
  if (!parsedUrl) isValid = false;

  return {
    line,
    urlKey,
    timestamp,
    original,
    mimetype,
    statusCode,
    digest,
    length,
    raw: JSON.stringify(row),
    isValid,
    parsedUrl,
  };
}

export function parseCdxRows(rows: unknown[]): ParsedCdxEntry[] {
  const result: ParsedCdxEntry[] = [];
  for (let i = 1; i < rows.length; i++) {
    const entry = normalizeCdxRow(rows[i], i);
    if (entry !== undefined) result.push(entry);
  }
  return result;
}

export function insertCdxEntries(
  db: DB,
  runId: string,
  cdxId: string,
  entries: ParsedCdxEntry[],
): ParsedCdxEntry[] {
  const insertEntry = db.prepare(`
    INSERT OR IGNORE INTO cdx_entry (
      run_id, cdx_id, line, url_key, timestamp, original,
      parsed_scheme, parsed_domain, normalized_port, parsed_path_and_query,
      mimetype, status_code, digest, length, raw, is_valid
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?
    )
  `);
  const insertResource = db.prepare(
    `INSERT OR IGNORE INTO resource (url, normalized_url) VALUES (?, ?)`,
  );
  const insertResourceVersion = db.prepare(
    `INSERT OR IGNORE INTO resource_version (url, timestamp) VALUES (?, ?)`,
  );
  const insertResourceVersionSource = db.prepare(
    `INSERT OR IGNORE INTO resource_version_source (url, timestamp, cdx_id) VALUES (?, ?, ?)`,
  );
  const incrementCdxTotal = db.prepare(
    `UPDATE cdx_file SET total_count = total_count + 1, pending_count = pending_count + 1 WHERE id = ?`,
  );
  const incrementRunCdxCount = db.prepare(
    `UPDATE run SET cdx_entry_count = cdx_entry_count + 1 WHERE id = ?`,
  );

  const insertOne = db.transaction((entry: ParsedCdxEntry) => {
    const result = insertEntry.run(
      runId,
      cdxId,
      entry.line,
      entry.urlKey,
      entry.timestamp,
      entry.original,
      entry.parsedUrl?.parsedScheme ?? null,
      entry.parsedUrl?.parsedDomain ?? null,
      entry.parsedUrl?.normalizedPort ?? null,
      entry.parsedUrl?.parsedPathAndQuery ?? null,
      entry.mimetype,
      entry.statusCode,
      entry.digest,
      entry.length,
      entry.raw,
      entry.isValid ? 1 : 0,
    );
    if (result.changes === 0) return false;
    incrementRunCdxCount.run(runId);
    if (entry.isValid) {
      const original = entry.original!;
      const timestamp = entry.timestamp!;
      const normalizedOriginal = normalizeUrl(original);
      insertTreeNodePaths(db, [normalizedOriginal]);
      insertResource.run(original, normalizedOriginal);
      insertResourceVersion.run(original, timestamp);
      const rvsr = insertResourceVersionSource.run(original, timestamp, cdxId);
      if (rvsr.changes > 0) incrementCdxTotal.run(cdxId);
    }
    return true;
  });

  const inserted: ParsedCdxEntry[] = [];
  for (const entry of entries) {
    if (insertOne(entry)) {
      inserted.push(entry);
    }
  }
  return inserted;
}

export function getOrCreateCdxFile(
  db: DB,
  domain: string,
  runId: string,
): string {
  const cdxId = uuidv4();
  db.prepare(
    'INSERT OR IGNORE INTO cdx_file (id, run_id, domain, normalized_domain) VALUES (?, ?, ?, ?)',
  ).run(cdxId, runId, domain, normalizeDomain(domain));
  return db
    .prepare<
      [string],
      { id: string }
    >('SELECT id FROM cdx_file WHERE domain = ?')
    .get(domain)!.id;
}

/**
 * Fetches CDX rows from the Wayback Machine for a domain and yields parsed entries page by page.
 * Throws on network/parse errors.
 */
export async function* fetchCdxRows(
  domain: string,
  cdxPageSize: number,
  log: (msg: string) => void = console.log,
): AsyncGenerator<ParsedCdxEntry[], void, void> {
  const baseUrl = `http://web.archive.org/cdx/search/cdx?matchType=domain&output=json&showResumeKey=true&limit=${cdxPageSize}&url=${encodeURIComponent(domain)}`;

  let resumeKey: string | undefined = undefined;
  let page = 1;

  while (true) {
    const url =
      resumeKey === undefined
        ? baseUrl
        : `${baseUrl}&resumeKey=${encodeURIComponent(resumeKey)}`;

    log(`Fetching CDX page ${page} from: ${url}`);

    let rows: unknown[];
    for (let attempt = 1; ; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(new Error('CDX fetch timed out after 60s')),
        60_000,
      );
      try {
        const response = await fetch(url, { signal: controller.signal });

        if (!response.ok) {
          throw new Error(`CDX fetch failed with status ${response.status}`);
        }

        rows = (await response.json()) as unknown[];
        break;
      } catch (err) {
        console.error(`CDX fetch attempt ${attempt} failed: ${err}`);
        console.log(`Retrying in 10 seconds...`);
        await new Promise((resolve) => setTimeout(resolve, 10_000));
      } finally {
        clearTimeout(timeout);
      }
    }

    if (!Array.isArray(rows)) {
      throw new Error('CDX response is not a JSON array');
    }

    let nextResumeKey: string | null = null;
    let pageRows: unknown[] = rows;

    if (rows.length >= 2) {
      const secondToLast = rows[rows.length - 2];
      const last = rows[rows.length - 1];

      if (
        Array.isArray(secondToLast) &&
        secondToLast.length === 0 &&
        Array.isArray(last) &&
        last.length === 1 &&
        typeof last[0] === 'string'
      ) {
        nextResumeKey = last[0];
        pageRows = rows.slice(0, -2);
      }
    }

    yield parseCdxRows(pageRows);

    if (!nextResumeKey || nextResumeKey === resumeKey) {
      break;
    }

    resumeKey = nextResumeKey;
    page += 1;
  }
}
