export interface ParsedUrl {
  parsedScheme: string;
  parsedDomain: string;
  normalizedPort: number | null;
  parsedPathAndQuery: string;
}

export interface ParsedCdxEntry {
  line: number;
  urlKey: string | null;
  timestamp: number | null;
  original: string | null;
  mimetype: string | null;
  statusCode: number | null;
  digest: string | null;
  length: number | null;
  raw: string;
}

export interface EvaluatedCdxEntry extends ParsedCdxEntry {
  isValid: boolean;
  parsedUrl: ParsedUrl | null;
  source: string;
  replayBaseUrl: string;
}

export function parseStringField(raw: unknown): string | null {
  return typeof raw === 'string' ? raw : null;
}

export function parseIntField(raw: unknown): number | null {
  if (typeof raw === 'number') return isNaN(raw) ? null : raw;
  if (typeof raw !== 'string') return null;
  const n = parseInt(raw);
  return isNaN(n) ? null : n;
}

export function parseUrl(url: string): ParsedUrl | null {
  try {
    const u = new URL(url);
    return {
      parsedScheme: u.protocol.replace(/:$/, ''),
      parsedDomain: u.hostname,
      normalizedPort: u.port ? parseInt(u.port) : null,
      parsedPathAndQuery: u.pathname + u.search,
    };
  } catch {
    return null;
  }
}
