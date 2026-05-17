import { parentPort } from 'worker_threads';
import {
  getFileMatches,
  type SearchCondition,
  type FileMatches,
} from './file_search';
import {
  toPlainNonFatalWorkerError,
  type PlainNonFatalWorkerError,
} from '../../worker/error';

export interface WorkerRequest {
  filePath: string;
  conditions: SearchCondition[];
}

export type WorkerSuccess = FileMatches & { result: 'success' };

export type WorkerResponse = WorkerSuccess | PlainNonFatalWorkerError;

export type { PlainNonFatalWorkerError };

if (!parentPort) throw new Error('Must be run as a Worker');

parentPort.on('message', (req: WorkerRequest) => {
  try {
    const result = getFileMatches(req.filePath, req.conditions);
    parentPort!.postMessage({
      result: 'success',
      ...result,
    } satisfies WorkerResponse);
  } catch (err) {
    parentPort!.postMessage(
      toPlainNonFatalWorkerError(err) satisfies WorkerResponse,
    );
  }
});
