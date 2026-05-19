import { Worker } from 'worker_threads';
import { workerRun } from './worker_run';
import { NodeWorkerError } from './error';
import { FatalTaskRunnerError, TaskQueue, TaskRunner } from '../lib/queue';

/**
 * Wraps a Node `Worker` as a `TaskRunner`. A `NodeWorkerError` thrown by
 * `workerRun` represents a non-fatal error reported by the worker itself and
 * is propagated unchanged. Any other error indicates the worker is no longer
 * usable and is re-thrown as a `FatalTaskRunnerError`, triggering replacement
 * in the queue.
 */
export class WorkerTaskRunner implements TaskRunner {
  private readonly worker: Worker;

  constructor(workerPath: string, workerData?: unknown) {
    this.worker = new Worker(workerPath, {
      execArgv: [...process.execArgv],
      workerData,
    });
  }

  async run<TRequest, TResponse>(request: TRequest): Promise<TResponse> {
    try {
      return await workerRun<TRequest, TResponse>(this.worker, request);
    } catch (err) {
      if (err instanceof NodeWorkerError) throw err;
      throw new FatalTaskRunnerError(
        err instanceof Error ? err.message : String(err),
        err,
      );
    }
  }

  async terminate(): Promise<void> {
    await this.worker.terminate();
  }
}

/**
 * Thin facade preserving the original `WorkerPool` API on top of the generic
 * `TaskQueue`. New code should prefer using `TaskQueue` + `WorkerTaskRunner`
 * directly.
 */
export class WorkerPool {
  private readonly tasks: TaskQueue;

  constructor(workerPath: string, poolSize: number, workerData?: unknown) {
    this.tasks = new TaskQueue(
      poolSize,
      () => new WorkerTaskRunner(workerPath, workerData),
    );
  }

  queue<TRequest, TResponse>(request: TRequest): Promise<TResponse> {
    return this.tasks.queue<TRequest, TResponse>(request);
  }

  terminate(): Promise<void> {
    return this.tasks.terminate();
  }
}
