export interface WorkerError {
  result: 'error';
  name: string;
  message: string;
  code?: unknown;
  cause?: unknown;
}

export function toWorkerError(err: unknown): WorkerError {
  const obj =
    typeof err === 'object' && err !== null
      ? (err as Record<string, unknown>)
      : null;
  const name = String(obj?.name ?? 'UnknownError');
  const message = String(obj?.message ?? err);
  const code = obj?.code;
  const cause = obj?.cause;
  return {
    result: 'error',
    name,
    message,
    ...(code !== undefined && { code }),
    ...(cause !== undefined && { cause }),
  };
}
