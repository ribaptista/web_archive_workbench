import { Worker } from 'worker_threads';
import {
  type PlainNonFatalWorkerError,
  isPlainNonFatalWorkerError,
  toNodeNonFatalWorkerError,
} from './error';

export function workerRun<TRequest, TResponse>(
  worker: Worker,
  request: TRequest,
): Promise<TResponse> {
  return new Promise<TResponse>((resolve, reject) => {
    const onMessage = (msg: TResponse | PlainNonFatalWorkerError): void => {
      worker.off('error', onError);
      if (isPlainNonFatalWorkerError(msg)) {
        reject(toNodeNonFatalWorkerError(msg));
        return;
      }
      resolve(msg as TResponse);
    };
    const onError = (err: Error): void => {
      worker.off('message', onMessage);
      reject(err);
    };
    worker.once('message', onMessage);
    worker.once('error', onError);
    worker.postMessage(request);
  });
}
