import { isMainThread, parentPort } from 'worker_threads';

export { isMainThread };

export function workerMain<TRequest>(
  handler: (req: TRequest) => Promise<void>,
): void {
  if (parentPort === null)
    throw new Error('workerMain called from main thread');
  const port = parentPort;
  port.on('message', async (req: TRequest) => {
    try {
      await handler(req);
      port.postMessage({ success: true });
    } catch (err) {
      port.postMessage({ error: String(err) });
    }
  });
}
