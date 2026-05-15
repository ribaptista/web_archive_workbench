import { fetch } from 'undici';
import { v4 as uuidv4 } from 'uuid';
import type { DB } from './db';
import {
  insertTreeNodePaths,
  normalizeUrl,
  normalizeDomain,
} from './tree-node-utils';
import { WaybackCdxStrategy } from './cdx-strategy-wayback';
import { PywbCdxStrategy } from './cdx-strategy-pywb';

export const DEFAULT_CDX_BASE_URL = 'http://web.archive.org/cdx/search/cdx';
export const DEFAULT_CDX_STRATEGY = 'json_wayback' as const;
export const DEFAULT_REPLAY_BASE_URL = 'https://web.archive.org/web/';

import type { ParsedCdxEntry, EvaluatedCdxEntry } from './cdx-parse-utils';
import { parseUrl } from './cdx-parse-utils';
export type {
  ParsedCdxEntry,
  ParsedUrl,
  EvaluatedCdxEntry,
} from './cdx-parse-utils';
export { parseCdxRows } from './cdx-strategy-wayback';

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

async function fetchTextWithRetries(url: string): Promise<string> {
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
      return await response.text();
    } catch (err) {
      console.error(`CDX fetch attempt ${attempt} failed: ${err}`);
      console.log(`Retrying in 10 seconds...`);
      await new Promise((resolve) => setTimeout(resolve, 10_000));
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function insertCdxEntries(
  db: DB,
  runId: string,
  cdxId: string,
  entries: EvaluatedCdxEntry[],
): EvaluatedCdxEntry[] {
  const insertEntry = db.prepare(`
    INSERT OR IGNORE INTO cdx_entry (
      run_id, cdx_id, line, url_key, timestamp, original,
      parsed_scheme, parsed_domain, normalized_port, parsed_path_and_query,
      mimetype, status_code, digest, length, raw, is_valid, source, replay_base_url
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?
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

  const insertOne = db.transaction((entry: EvaluatedCdxEntry) => {
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
      entry.source,
      entry.replayBaseUrl,
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

  const inserted: EvaluatedCdxEntry[] = [];
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
 * Fetches CDX rows for a domain and yields parsed entries page by page.
 * Delegates to the appropriate strategy (json_wayback or json_pywb).
 */
export async function* fetchCdxRows(
  domain: string,
  cdxPageSize: number,
  log: (msg: string) => void = console.log,
  cdxBaseUrl: string = DEFAULT_CDX_BASE_URL,
  cdxStrategy: 'json_wayback' | 'json_pywb' = DEFAULT_CDX_STRATEGY,
  replayBaseUrl: string = DEFAULT_REPLAY_BASE_URL,
): AsyncGenerator<EvaluatedCdxEntry[], void, void> {
  const strategy =
    cdxStrategy === 'json_pywb'
      ? new PywbCdxStrategy(domain, cdxBaseUrl, cdxPageSize)
      : new WaybackCdxStrategy(domain, cdxBaseUrl, cdxPageSize);

  let cursor: unknown = undefined;
  let page = 1;

  while (true) {
    const url = strategy.generateURL(cursor);
    log(`Fetching CDX page ${page} from: ${url}`);

    const text = await fetchTextWithRetries(url);
    const result = strategy.parseResult(text);
    const entries = strategy.parseEntries(result);
    yield entries.map((entry): EvaluatedCdxEntry => {
      const parsedUrl =
        entry.original !== null ? parseUrl(entry.original) : null;
      const isValid =
        entry.timestamp !== null &&
        entry.original !== null &&
        parsedUrl !== null;
      return { ...entry, isValid, parsedUrl, source: cdxBaseUrl, replayBaseUrl };
    });

    const nextCursor = strategy.buildNextPageCursor(result);
    if (nextCursor === undefined) break;
    cursor = nextCursor;
    page += 1;
  }
}
