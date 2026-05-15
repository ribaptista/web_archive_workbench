import type { ParsedCdxEntry } from './cdx-parse-utils';
import { parseStringField, parseIntField } from './cdx-parse-utils';
import type { CdxStrategy, PageCursor } from './cdx-strategy';

function normalizeCdxRow(
  row: unknown,
  line: number,
): ParsedCdxEntry | undefined {
  if (!Array.isArray(row) || row.length !== 7) {
    console.error(
      `Invalid CDX row at index ${line} (not an array or length !== 7):`,
      row,
    );
    return undefined;
  }
  const [
    urlKeyRaw,
    timestampRaw,
    originalRaw,
    mimetypeRaw,
    statusCodeRaw,
    digestRaw,
    lengthRaw,
  ] = row;

  const urlKey = parseStringField(urlKeyRaw);
  const timestamp = parseIntField(timestampRaw);
  const original = parseStringField(originalRaw);
  const mimetype = parseStringField(mimetypeRaw);
  const statusCode = parseIntField(statusCodeRaw);
  const digest = parseStringField(digestRaw);
  const length = parseIntField(lengthRaw);
  return {
    line,
    urlKey,
    timestamp,
    original,
    mimetype,
    statusCode,
    digest,
    length,
    raw: JSON.stringify(row),
  };
}

/** Skips the first row (header) and parses the rest as CDX entries. */
export function parseCdxRows(rows: unknown[]): ParsedCdxEntry[] {
  const result: ParsedCdxEntry[] = [];
  for (let i = 1; i < rows.length; i++) {
    const entry = normalizeCdxRow(rows[i], i);
    if (entry !== undefined) result.push(entry);
  }
  return result;
}

/** Resume key string used by the Wayback Machine CDX API for pagination. */
type WaybackCursor = string;

/**
 * Returns the resume key if the rows array ends with the Wayback CDX sentinel:
 * `[..., [], ["<resumeKey>"]]`
 */
function stripResumeKey(rows: unknown[]): unknown[] {
  return extractResumeKey(rows) !== undefined ? rows.slice(0, -2) : rows;
}

function extractResumeKey(rows: unknown[]): WaybackCursor | undefined {
  if (rows.length < 2) return undefined;
  const secondToLast = rows[rows.length - 2];
  const last = rows[rows.length - 1];
  if (
    Array.isArray(secondToLast) &&
    secondToLast.length === 0 &&
    Array.isArray(last) &&
    last.length === 1 &&
    typeof last[0] === 'string'
  ) {
    return last[0];
  }
  return undefined;
}

interface WaybackResult {
  rows: unknown[];
  resumeKey: WaybackCursor | undefined;
}

export class WaybackCdxStrategy implements CdxStrategy {
  private readonly baseUrl: string;

  constructor(domain: string, cdxBaseUrl: string, cdxPageSize: number) {
    this.baseUrl = `${cdxBaseUrl}?matchType=domain&output=json&showResumeKey=true&limit=${cdxPageSize}&url=${encodeURIComponent(domain)}`;
  }

  generateURL(cursor: PageCursor | undefined): string {
    if (cursor === undefined) return this.baseUrl;
    return `${this.baseUrl}&resumeKey=${encodeURIComponent(cursor as WaybackCursor)}`;
  }

  parseResult(responseText: string): WaybackResult {
    let rows: unknown;
    try {
      rows = JSON.parse(responseText);
    } catch {
      throw new Error('Wayback CDX response is not valid JSON');
    }
    if (!Array.isArray(rows)) {
      throw new Error('Wayback CDX response is not a JSON array');
    }
    return { rows, resumeKey: extractResumeKey(rows) };
  }

  buildNextPageCursor(result: unknown): WaybackCursor | undefined {
    return (result as WaybackResult).resumeKey;
  }

  parseEntries(result: unknown): ParsedCdxEntry[] {
    const { rows } = result as WaybackResult;
    const pageRows = stripResumeKey(rows);
    return parseCdxRows(pageRows);
  }
}
