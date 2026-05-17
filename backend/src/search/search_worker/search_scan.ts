import path from 'path';
import Database from 'better-sqlite3';
import { workerData } from 'worker_threads';
import type { SearchCondition, SearchMetadata } from '../types';
import type {
  WorkerRequest,
  FileSearchSuccessfulResult,
} from '../file_search_worker/file_search_worker';
import { NodeWorkerError, PlainNonFatalWorkerError } from '../../worker/error';
import { workerMain, isMainThread } from '../../worker/worker_utils';
import { WorkerPool } from '../../worker/worker_pool';
import { buildAssetPath } from '../../request/paths';
import { HtmlCandidateRow, SearchRepository } from '../repository';
import { CdxRepository } from '../../cdx/repository';
import { aggregateStats } from '../../observability/timing';

export const PAGE_SIZE = 40;

export interface SearchScanRequest {
  searchMetadata: SearchMetadata;
  baseFolder: string;
  total: number;
}

export type SearchScanResponse = { success: true } | PlainNonFatalWorkerError;

interface SearchScanWorkerData {
  dbPath: string;
  maxWorkers: number;
}

const { dbPath, maxWorkers: maxWorkersData } =
  workerData as SearchScanWorkerData;

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
const searchRepo = new SearchRepository(db);
const cdxRepo = new CdxRepository(db);

const workerPath = path.join(
  __dirname,
  '..',
  'file_search_worker',
  'file_search_worker.ts',
);
const pool = new WorkerPool(workerPath, maxWorkersData);

// Terminate the nested file-search worker pool on shutdown signals only.
// We deliberately do NOT bind to `uncaughtException` / `unhandledRejection`:
// doing so previously masked the original error and caused subsequent calls
// to fail with the misleading "WorkerPool is terminated".
const terminatePool = () => pool.terminate();
process.once('SIGINT', terminatePool);
process.once('SIGTERM', terminatePool);
process.on('uncaughtException', (err) => {
  console.error('[search-scan worker] uncaughtException:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[search-scan worker] unhandledRejection:', reason);
});

interface FileSearchResult {
  duration: number;
}

async function runFileSearchWorker(
  pool: WorkerPool,
  searchRepo: SearchRepository,
  searchId: number,
  conditions: SearchCondition[],
  candidate: HtmlCandidateRow,
  baseFolder: string,
): Promise<FileSearchResult> {
  const filePath = buildAssetPath(baseFolder, candidate.body_digest) + '.text';
  const matchStart = Date.now();
  try {
    const response = await pool.queue<
      WorkerRequest,
      FileSearchSuccessfulResult
    >({
      filePath,
      conditions,
    });
    searchRepo.saveMatches(searchId, candidate, response);
  } catch (workerErr) {
    if (!(workerErr instanceof NodeWorkerError)) throw workerErr;
    console.error(
      `[search ${searchId}] Error reading ${filePath}: ${workerErr.name}: ${workerErr.message}`,
    );
    searchRepo.saveFileError(
      searchId,
      candidate,
      workerErr.name,
      workerErr.message,
    );
  }
  return { duration: Date.now() - matchStart };
}

async function runFileSearchForCandidatesPage(
  pool: WorkerPool,
  searchRepo: SearchRepository,
  searchId: number,
  conditions: SearchCondition[],
  candidates: HtmlCandidateRow[],
  baseFolder: string,
  pageNum: number,
  totalPages: number,
): Promise<void> {
  const tasks = candidates.map((candidate) =>
    runFileSearchWorker(
      pool,
      searchRepo,
      searchId,
      conditions,
      candidate,
      baseFolder,
    ),
  );
  const timings = await Promise.all(tasks);
  const { count, total, avg, max } = aggregateStats(
    timings.map((t) => t.duration),
  );
  console.log(
    `[search ${searchId}] Page ${pageNum}/${totalPages} done — files: ${count}, total: ${total}ms, avg: ${avg}ms, max: ${max}ms`,
  );
}

interface PageCursor {
  url: string;
  timestamp: number;
  pageNum: number;
}

async function processNextCandidatesPage(
  searchId: number,
  domainNames: string[],
  conditions: SearchCondition[],
  baseFolder: string,
  totalPages: number,
  cursor: PageCursor | undefined,
): Promise<PageCursor | undefined> {
  const { url, timestamp, pageNum } = cursor ?? {
    url: '',
    timestamp: 0,
    pageNum: 0,
  };
  const currentPageNum = pageNum + 1;
  const queryStart = Date.now();
  const candidates = cdxRepo.findHtmlCandidatesPage({
    cursorUrl: url,
    cursorTimestamp: timestamp,
    domainIds: domainNames,
    limit: PAGE_SIZE,
  });
  const queryDuration = Date.now() - queryStart;
  console.log(
    `[search ${searchId}] Page ${currentPageNum}/${totalPages} query: ${queryDuration}ms (${candidates.length} rows)`,
  );
  if (candidates.length === 0) return undefined;

  await runFileSearchForCandidatesPage(
    pool,
    searchRepo,
    searchId,
    conditions,
    candidates,
    baseFolder,
    currentPageNum,
    totalPages,
  );

  const last = candidates[candidates.length - 1];
  searchRepo.incrementScannedCount(candidates.length, searchId);
  return {
    url: last.resource_version_url,
    timestamp: last.resource_version_timestamp,
    pageNum: currentPageNum,
  };
}

async function runSearchScan(
  req: SearchScanRequest,
): Promise<{ success: true }> {
  const { searchMetadata, baseFolder, total } = req;
  const { searchId, domainNames, conditions } = searchMetadata;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  searchRepo.setSearchStatus('running', searchId);

  let cursor: PageCursor | undefined = undefined;
  while (true) {
    cursor = await processNextCandidatesPage(
      searchId,
      domainNames,
      conditions,
      baseFolder,
      totalPages,
      cursor,
    );
    if (cursor === undefined) break;
  }
  return { success: true };
}

if (!isMainThread) {
  workerMain<SearchScanRequest, { success: true }>(runSearchScan);
}
