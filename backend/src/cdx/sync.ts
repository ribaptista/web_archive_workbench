import type { DB } from '../db/conn';
import { normalizeUrl, normalizeDomain } from '../http/normalized_url';
import { WaybackCdxStrategy } from './sync_strategy/cdx-strategy-wayback';
import { PywbCdxStrategy } from './sync_strategy/cdx-strategy-pywb';
import { CdxRepository } from './repository';
import { RunRepository } from '../run/repository';
import type { AgentPool } from '../http/agent_pool';

export const DEFAULT_CDX_BASE_URL = 'http://web.archive.org/cdx/search/cdx';
export const DEFAULT_CDX_STRATEGY: SupportedSyncStrategy = 'json_wayback';
export const DEFAULT_REPLAY_BASE_URL = 'https://web.archive.org/web/';

import type { ParsedCdxEntry } from './sync_strategy/cdx-parse-utils';

async function fetchAndParseWithRetries<R>(
  url: string,
  parse: (text: string) => R,
  pool: AgentPool,
  log: (msg: string) => void = console.log,
): Promise<R> {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await pool.fetch(url);
      if (response.statusCode !== 200) {
        throw new Error(`CDX fetch failed with status ${response.statusCode}`);
      }
      return parse(response.body.toString('utf8'));
    } catch (err) {
      log(
        `CDX fetch attempt ${attempt} failed: ${err}; retrying in 10 seconds...`,
      );
      await new Promise((resolve) => setTimeout(resolve, 10_000));
    }
  }
}

export const SUPPORTED_SYNC_STRATEGIES = ['json_wayback', 'json_pywb'] as const;
export type SupportedSyncStrategy = (typeof SUPPORTED_SYNC_STRATEGIES)[number];

export interface CdxServer {
  baseUrl?: string;
  strategy?: SupportedSyncStrategy;
  replayBaseUrl: string;
}

/** Optional CDX timestamp filter */
export interface CdxQueryFilter {
  from?: string; // inclusive
  to?: string; // inclusive
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
export type CdxQueryOptions = {
  baseUrl?: string;
  strategy?: SupportedSyncStrategy;
  pageSize?: number;
  query?: CdxQueryFilter;
};

export async function* fetchCdxRows(
  domain: string,
  options: CdxQueryOptions,
  pool: AgentPool,
  log: (msg: string) => void = console.log,
): AsyncGenerator<EvaluatedCdxEntry[], void, void> {
  const {
    baseUrl: cdxBaseUrl = DEFAULT_CDX_BASE_URL,
    strategy: cdxStrategy = DEFAULT_CDX_STRATEGY,
    pageSize: cdxPageSize = 50,
    query,
  } = options;
  const strategy =
    cdxStrategy === 'json_pywb'
      ? new PywbCdxStrategy(domain, cdxBaseUrl, cdxPageSize, query)
      : new WaybackCdxStrategy(domain, cdxBaseUrl, cdxPageSize, query);

  let cursor: unknown = undefined;
  let page = 1;

  while (true) {
    const url = strategy.generateURL(cursor);
    const result = await fetchAndParseWithRetries(
      url,
      (text) => strategy.parseResult(text),
      pool,
      log,
    );
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
