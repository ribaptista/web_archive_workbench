import { fetch } from 'undici';
import type { DB } from '../db/conn';
import { normalizeUrl, normalizeDomain } from '../http/normalized_url';
import { WaybackCdxStrategy } from './sync_strategy/cdx-strategy-wayback';
import { PywbCdxStrategy } from './sync_strategy/cdx-strategy-pywb';
import { CdxRepository } from './repository';
import { RunRepository } from '../run/repository';

export const DEFAULT_CDX_BASE_URL = 'http://web.archive.org/cdx/search/cdx';
export const DEFAULT_CDX_STRATEGY = 'json_wayback' as const;
export const DEFAULT_REPLAY_BASE_URL = 'https://web.archive.org/web/';

import type { ParsedCdxEntry } from './sync_strategy/cdx-parse-utils';
export type { ParsedCdxEntry } from './sync_strategy/cdx-parse-utils';
export { parseCdxRows } from './sync_strategy/cdx-strategy-wayback';

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

export interface CdxServer {
  baseUrl?: string;
  strategy?: 'json_wayback' | 'json_pywb';
  replayBaseUrl: string;
}

export function getOrCreateCdxSource(
  cdxRepo: CdxRepository,
  server: CdxServer,
): number {
  const baseUrl = server.baseUrl ?? DEFAULT_CDX_BASE_URL;
  cdxRepo.insertOrIgnoreCdxSource(baseUrl, server.replayBaseUrl);
  return cdxRepo.findCdxSourceId(baseUrl);
}

export function ensureResourceVersionRegistered(
  cdxRepo: CdxRepository,
  original: string,
  timestamp: number,
  domainName: string,
): boolean {
  const normalizedOriginal = normalizeUrl(original).toString();
  cdxRepo.insertTreeNodePaths([normalizedOriginal]);
  cdxRepo.insertOrIgnoreResource(original, normalizedOriginal);
  cdxRepo.insertOrIgnoreResourceVersion(original, timestamp);
  const rvsr = cdxRepo.insertOrIgnoreResourceVersionSource(
    original,
    timestamp,
    domainName,
  );
  if (rvsr.changes > 0) {
    cdxRepo.incrementDomainEntryCount(domainName);
    return true;
  }
  return false;
}

export function insertCdxEntries(
  db: DB,
  cdxRepo: CdxRepository,
  runRepo: RunRepository,
  runId: string,
  domainName: string,
  cdxSourceId: number,
  entries: EvaluatedCdxEntry[],
): EvaluatedCdxEntry[] {
  const insertOne = db.transaction((entry: EvaluatedCdxEntry) => {
    const result = cdxRepo.insertOrIgnoreCdxEntry({
      runId,
      domainName,
      line: entry.line,
      urlKey: entry.urlKey,
      timestamp: entry.timestamp,
      original: entry.original,
      mimetype: entry.mimetype,
      statusCode: entry.statusCode,
      digest: entry.digest,
      length: entry.length,
      raw: entry.raw,
      isValid: entry.isValid ? 1 : 0,
      cdxSourceId,
    });
    if (result.changes === 0) return false;
    runRepo.incrementNewEntryCount(runId);
    if (entry.isValid) {
      ensureResourceVersionRegistered(
        cdxRepo,
        entry.original!,
        entry.timestamp!,
        domainName,
      );
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
  cdxRepo: CdxRepository,
  domain: string,
  runId: string,
): string {
  cdxRepo.insertOrIgnoreDomain(domain, runId, normalizeDomain(domain));
  return domain;
}

function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

export interface EvaluatedCdxEntry extends ParsedCdxEntry {
  isValid: boolean;
}

/**
 * Fetches CDX rows for a domain and yields parsed entries page by page.
 * Delegates to the appropriate strategy (json_wayback or json_pywb).
 */
export interface CdxQueryOptions {
  baseUrl?: string;
  strategy?: 'json_wayback' | 'json_pywb';
  pageSize?: number;
}

export async function* fetchCdxRows(
  domain: string,
  options: CdxQueryOptions,
  log: (msg: string) => void = console.log,
): AsyncGenerator<EvaluatedCdxEntry[], void, void> {
  const {
    baseUrl: cdxBaseUrl = DEFAULT_CDX_BASE_URL,
    strategy: cdxStrategy = DEFAULT_CDX_STRATEGY,
    pageSize: cdxPageSize = 50,
  } = options;
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
      const isValid =
        entry.timestamp !== null &&
        entry.original !== null &&
        isValidUrl(entry.original);
      return { ...entry, isValid };
    });

    const nextCursor = strategy.buildNextPageCursor(result);
    if (nextCursor === undefined) break;
    cursor = nextCursor;
    page += 1;
  }
}

export function findNewEntries<T extends ParsedCdxEntry>(
  cdxRepo: CdxRepository,
  domain: string,
  entries: T[],
): T[] {
  return entries.filter(
    (entry) => cdxRepo.countCdxEntryByRawAndDomain(entry.raw, domain) === 0,
  );
}
