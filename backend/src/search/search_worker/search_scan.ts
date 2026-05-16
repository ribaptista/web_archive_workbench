import path from 'path';
import { Worker, isMainThread, parentPort } from 'worker_threads';
import Database from 'better-sqlite3';
import type {
  FileMatch,
  SearchCondition,
} from '../file_search_worker/file_search';
import type {
  WorkerRequest,
  WorkerSuccess,
} from '../file_search_worker/file_search_worker';
import { type WorkerError } from '../../worker/worker_utils';
import { buildAssetPath } from '../../request/paths';
import { SearchRepository } from '../repository';
import { CdxRepository } from '../../cdx/repository';

export const PAGE_SIZE = 40;

export interface SearchScanRequest {
  dbPath: string;
  searchId: number;
  baseFolder: string;
  maxWorkers: number;
  cdxFileIds: string[];
  conditions: SearchCondition[];
  totalPages: number;
}

export type SearchScanResponse = { success: true } | { error: string };

async function runSearchScan(req: SearchScanRequest): Promise<void> {
  const { dbPath, searchId, baseFolder, maxWorkers, cdxFileIds, totalPages } =
    req;

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const conditions = req.conditions;

  const searchRepo = new SearchRepository(db);
  const cdxRepo = new CdxRepository(db);
  searchRepo.setSearchStatus('running', searchId);

  const saveMatches = db.transaction(
    (
      candidateId: string,
      url: string,
      timestamp: number,
      contextDigest: string,
      matches: FileMatch[],
    ) => {
      if (matches.length === 0) return;
      const searchFileId = searchRepo.insertFile({
        searchId,
        requestId: candidateId,
        url,
        timestamp,
        matchCount: matches.length,
        contextDigest,
      });
      for (const m of matches) {
        searchRepo.insertMatch({
          searchFileId,
          conditionId: m.conditionId,
          matchOffset: m.matchOffset,
          matchLength: m.matchLength,
        });
      }
    },
  );

  const saveFileError = db.transaction(
    (
      candidateId: string,
      url: string,
      timestamp: number,
      errorName: string,
      errorMessage: string,
    ) => {
      searchRepo.insertFileError({
        searchId,
        requestId: candidateId,
        url,
        timestamp,
        errorName,
        errorMessage,
      });
    },
  );

  const workerPath = path.join(
    __dirname,
    '..',
    'file_search_worker',
    'file_search_worker.ts',
  );
  const allWorkers = Array.from(
    { length: maxWorkers },
    () => new Worker(workerPath, { execArgv: [...process.execArgv] }),
  );
  const freeWorkers: Worker[] = [...allWorkers];
  const waitQueue: Array<(w: Worker) => void> = [];

  function acquireWorker(): Promise<Worker> {
    if (freeWorkers.length > 0) return Promise.resolve(freeWorkers.pop()!);
    return new Promise((resolve) => waitQueue.push(resolve));
  }

  function releaseWorker(w: Worker): void {
    const next = waitQueue.shift();
    if (next) next(w);
    else freeWorkers.push(w);
  }

  function runOnWorker(
    worker: Worker,
    workerReq: WorkerRequest,
  ): Promise<WorkerSuccess> {
    return new Promise((resolve, reject) => {
      let settled = false;
      worker.once('message', (msg: WorkerSuccess | WorkerError) => {
        if (settled) return;
        settled = true;
        if (msg.result === 'error') reject(msg);
        else resolve(msg);
      });
      worker.once('error', (err) => {
        if (settled) return;
        settled = true;
        reject(err);
      });
      worker.postMessage(workerReq);
    });
  }

  let cursor: { url: string; timestamp: number } = { url: '', timestamp: 0 };
  let pageNum = 0;

  try {
    while (true) {
      pageNum++;
      const queryStart = Date.now();
      const candidates = cdxRepo.findHtmlCandidatesPage({
        cursorUrl: cursor.url,
        cursorTimestamp: cursor.timestamp,
        domainIds: cdxFileIds,
        limit: PAGE_SIZE,
      });
      console.log(
        `[search ${searchId}] Page ${pageNum}/${totalPages} query: ${Date.now() - queryStart}ms (${candidates.length} rows)`,
      );
      if (candidates.length === 0) break;

      const tasks = candidates.map((candidate) =>
        (async () => {
          const filePath =
            buildAssetPath(baseFolder, candidate.body_digest) + '.text';
          const worker = await acquireWorker();
          const matchStart = Date.now();
          try {
            const response = await runOnWorker(worker, {
              filePath,
              conditions,
            } satisfies WorkerRequest);
            saveMatches(
              candidate.request_id,
              candidate.resource_version_url,
              candidate.resource_version_timestamp,
              response.contextDigest,
              response.matches,
            );
          } catch (workerErr) {
            const e = workerErr as WorkerError;
            console.error(
              `[search ${searchId}] Error reading ${filePath}: ${e.name}: ${e.message}`,
            );
            saveFileError(
              candidate.request_id,
              candidate.resource_version_url,
              candidate.resource_version_timestamp,
              e.name,
              e.message,
            );
          } finally {
            releaseWorker(worker);
          }
          return Date.now() - matchStart;
        })(),
      );

      const timings = (await Promise.all(tasks)).filter(
        (t): t is number => t !== undefined,
      );
      const totalMatchMs = timings.reduce((a, b) => a + b, 0);
      const maxMatchMs = timings.length ? Math.max(...timings) : 0;
      const avgMatchMs = timings.length
        ? Math.round(totalMatchMs / timings.length)
        : 0;
      console.log(
        `[search ${searchId}] Page ${pageNum}/${totalPages} done — files: ${timings.length}, total: ${totalMatchMs}ms, avg: ${avgMatchMs}ms, max: ${maxMatchMs}ms`,
      );
      const last = candidates[candidates.length - 1];
      cursor = {
        url: last.resource_version_url,
        timestamp: last.resource_version_timestamp,
      };
      searchRepo.incrementScannedCount(candidates.length, searchId);
    }
  } finally {
    await Promise.all(allWorkers.map((w) => w.terminate()));
    db.close();
  }
}

if (!isMainThread) {
  parentPort!.once('message', async (req: SearchScanRequest) => {
    try {
      await runSearchScan(req);
      parentPort!.postMessage({ success: true } satisfies SearchScanResponse);
    } catch (err) {
      parentPort!.postMessage({
        error: String(err),
      } satisfies SearchScanResponse);
    }
  });
}
