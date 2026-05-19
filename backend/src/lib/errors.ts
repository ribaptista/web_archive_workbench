export interface PlainError {
  name: string;
  code?: string;
  message: string;
}

export class NonErrorThrown extends Error {
  readonly code = 'non_error_thrown';
  constructor(public readonly thrown: unknown) {
    let serialized: string;
    try {
      serialized = JSON.stringify(thrown);
    } catch {
      serialized = '(non-serializable)';
    }
    super(`Thrown value not an error instance: ${serialized}`);
    this.name = 'NonErrorThrown';
  }
}

export function asPlainError(err: unknown): PlainError {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      code: (err as { code?: string }).code,
    };
  }
  return asPlainError(new NonErrorThrown(err));
}
