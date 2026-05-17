export interface PlainNonFatalWorkerError {
  result: 'error';
  name: string;
  message: string;
  code?: unknown;
  cause?: unknown;
}

export function isPlainNonFatalWorkerError(
  msg: unknown,
): msg is PlainNonFatalWorkerError {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as PlainNonFatalWorkerError).result === 'error'
  );
}

export function toPlainNonFatalWorkerError(
  err: unknown,
): PlainNonFatalWorkerError {
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

export class NodeWorkerError extends Error {
  readonly code: unknown;
  readonly cause: unknown;

  constructor(plain: PlainNonFatalWorkerError) {
    super(plain.message);
    this.name = plain.name;
    this.code = plain.code;
    this.cause = plain.cause;
  }
}

export function toNodeNonFatalWorkerError(
  plain: PlainNonFatalWorkerError,
): NodeWorkerError {
  return new NodeWorkerError(plain);
}
