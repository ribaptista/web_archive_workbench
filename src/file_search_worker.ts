import { parentPort } from 'worker_threads';
import {
  getFileMatches,
  type SearchCondition,
  type FileMatches,
} from './file_search';

export interface WorkerRequest {
  filePath: string;
  conditions: SearchCondition[];
  charEncoding: string;
}

export type WorkerResponse =
  | FileMatches
  | { errorName: string; errorMessage: string };

if (!parentPort) throw new Error('Must be run as a Worker');

parentPort.on('message', (req: WorkerRequest) => {
  try {
    const result = getFileMatches(
      req.filePath,
      req.conditions,
      req.charEncoding as BufferEncoding,
    );
    parentPort!.postMessage(result satisfies WorkerResponse);
  } catch (err) {
    const e = err as Error;
    parentPort!.postMessage({
      errorName: e.name,
      errorMessage: e.message,
    } satisfies WorkerResponse);
  }
});
