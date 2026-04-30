import path from 'path';
import { Worker, isMainThread, parentPort } from 'worker_threads';
import Database from 'better-sqlite3';
import type { FileMatch, SearchCondition } from './file_search';
import type { WorkerRequest, WorkerResponse } from './file_search_worker';
import { nestedIdPath } from './id-path';

export const PAGE_SIZE = 40;

interface CandidateRow {
  url: string;
  timestamp: number;
  request_id: string;
  body_digest: string;
}

export interface SearchScanRequest {
  dbPath: string;
  searchId: number;
  baseFolder: string;
  charEncoding: string;
  maxWorkers: number;
  cdxFileIds: string[];
  cdxIdToDomain: [string, string][];
  conditions: SearchCondition[];
  domainClause: string;
  totalPages: number;
}

export type SearchScanResponse = { success: true } | { error: string };

async function runSearchScan(req: SearchScanRequest): Promise<void> {
  const {
    dbPath,
    searchId,
    baseFolder,
    charEncoding,
    maxWorkers,
    cdxFileIds,
    domainClause,
    totalPages,
  } = req;

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const conditions = req.conditions;

  db.prepare<[number]>(`UPDATE search SET status = 'running' WHERE id = ?`).run(
    searchId,
  );

  const updateScanned = db.prepare<[number, number]>(
    `UPDATE search SET scanned_file_count = scanned_file_count + ? WHERE id = ?`,
  );

  const selectPage = db.prepare<Array<string | number>, CandidateRow>(`
    SELECT
      rv.url,
      rv.timestamp,
      r.id as request_id,
      r.body_digest
    FROM resource_version rv
    JOIN request r ON r.id = rv.successful_request_id
    WHERE rv.successful_request_id IS NOT NULL
      AND r.mimetype = 'text/html'
      AND r.location IS NULL
      ${domainClause}
      AND (rv.url, rv.timestamp) > (?, ?)
    ORDER BY rv.url, rv.timestamp
    LIMIT ${PAGE_SIZE}
  `);

  const insertFile = db.prepare<[number, string, number, string | null]>(
    `INSERT INTO search_file (search_id, request_id, match_count, context_digest) VALUES (?, ?, ?, ?)`,
  );
  const insertFileError = db.prepare<[number, string, string, string]>(
    `INSERT INTO search_file (search_id, request_id, match_count, error_name, error_message) VALUES (?, ?, 0, ?, ?)`,
  );
  const insertMatch = db.prepare<[number, number, number, number]>(
    `INSERT INTO search_match (search_file_id, search_condition_id, match_offset, match_length) VALUES (?, ?, ?, ?)`,
  );

  const saveMatches = db.transaction(
    (
      candidateId: string,
      contextDigest: string | null,
      matches: FileMatch[],
    ) => {
      const fileResult = insertFile.run(
        searchId,
        candidateId,
        matches.length,
        contextDigest,
      );
      const searchFileId = fileResult.lastInsertRowid as number;
      for (const m of matches) {
        insertMatch.run(
          searchFileId,
          m.conditionId,
          m.matchOffset,
          m.matchLength,
        );
      }
    },
  );

  const saveFileError = db.transaction(
    (candidateId: string, errorName: string, errorMessage: string) => {
      insertFileError.run(searchId, candidateId, errorName, errorMessage);
    },
  );

  const workerPath = path.join(__dirname, 'file_search_worker.ts');
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
  ): Promise<WorkerResponse> {
    return new Promise((resolve, reject) => {
      worker.once('message', (msg: WorkerResponse) => resolve(msg));
      worker.once('error', reject);
      worker.postMessage(workerReq);
    });
  }

  let cursor: { url: string; timestamp: number } = { url: '', timestamp: 0 };
  let pageNum = 0;

  try {
    while (true) {
      pageNum++;
      const queryStart = Date.now();
      const candidates = selectPage.all(
        ...cdxFileIds,
        cursor.url,
        cursor.timestamp,
      );
      console.log(
        `[search ${searchId}] Page ${pageNum}/${totalPages} query: ${Date.now() - queryStart}ms (${candidates.length} rows)`,
      );
      if (candidates.length === 0) break;

      const tasks = candidates.map((candidate) =>
        (async () => {
          const filePath =
            nestedIdPath(
              path.join(baseFolder, 'assets'),
              candidate.body_digest,
              2,
            ) + '.text';
          const worker = await acquireWorker();
          let matchMs = 0;
          try {
            const matchStart = Date.now();
            const response = await runOnWorker(worker, {
              filePath,
              conditions,
              charEncoding,
            } satisfies WorkerRequest);
            matchMs = Date.now() - matchStart;
            if ('errorName' in response) {
              console.error(
                `[search ${searchId}] Error reading ${filePath}: ${response.errorName}: ${response.errorMessage}`,
              );
              saveFileError(
                candidate.request_id,
                response.errorName,
                response.errorMessage,
              );
              return 0;
            }
            saveMatches(
              candidate.request_id,
              response.contextDigest,
              response.matches,
            );
            return matchMs;
          } finally {
            releaseWorker(worker);
          }
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
      cursor = { url: last.url, timestamp: last.timestamp };
      updateScanned.run(candidates.length, searchId);
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
