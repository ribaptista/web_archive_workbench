export class BadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BadRequestError';
  }
}

export function toArray(val: unknown): string[] {
  if (val === null || val === undefined) return [];
  if (Array.isArray(val)) return (val as unknown[]).map(String);
  return [String(val)];
}
