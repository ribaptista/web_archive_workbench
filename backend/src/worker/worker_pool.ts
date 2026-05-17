import { Worker } from 'worker_threads';
import { workerRun } from './worker_run';
import { NodeWorkerError } from './error';

type WorkerWaiter = {
  resolve: (w: Worker) => void;
  reject: (err: Error) => void;
};

export class WorkerPool {
  private readonly allWorkers: Worker[];
  private readonly freeWorkers: Worker[];
  private readonly waitQueue: WorkerWaiter[] = [];
  private terminated = false;

  constructor(
    private readonly workerPath: string,
    poolSize: number,
    private readonly workerData?: unknown,
  ) {
    this.allWorkers = Array.from(
      { length: poolSize },
      () =>
        new Worker(workerPath, { execArgv: [...process.execArgv], workerData }),
    );
    this.freeWorkers = [...this.allWorkers];
  }

  private acquire(): Promise<Worker> {
    if (this.freeWorkers.length > 0)
      return Promise.resolve(this.freeWorkers.pop()!);
    return new Promise((resolve, reject) =>
      this.waitQueue.push({ resolve, reject }),
    );
  }

  private release(worker: Worker): void {
    if (this.terminated) return;
    const next = this.waitQueue.shift();
    if (next) next.resolve(worker);
    else this.freeWorkers.push(worker);
  }

  private replaceWorker(dead: Worker): Worker {
    const fresh = new Worker(this.workerPath, {
      execArgv: [...process.execArgv],
      workerData: this.workerData,
    });
    const idx = this.allWorkers.indexOf(dead);
    if (idx !== -1) this.allWorkers[idx] = fresh;
    return fresh;
  }

  async queue<TRequest, TResponse>(request: TRequest): Promise<TResponse> {
    if (this.terminated) throw new Error('WorkerPool is terminated');
    const worker = await this.acquire();
    try {
      return await workerRun<TRequest, TResponse>(worker, request);
    } catch (err) {
      if (!(err instanceof NodeWorkerError)) {
        await worker.terminate();
        if (!this.terminated) {
          this.release(this.replaceWorker(worker));
        }
      } else {
        this.release(worker);
      }
      throw err;
    }
  }

  async terminate(): Promise<void> {
    this.terminated = true;
    const err = new Error('WorkerPool is terminated');
    for (const waiter of this.waitQueue.splice(0)) waiter.reject(err);
    await Promise.all(this.allWorkers.map((w) => w.terminate()));
  }
}
