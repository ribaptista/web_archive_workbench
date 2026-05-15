import { parseStringField, parseIntField } from './cdx-parse-utils';
import type { ParsedCdxEntry } from './cdx-parse-utils';
import type { CdxStrategy, PageCursor } from './cdx-strategy';

type PywbResult = Record<string, unknown>[];

export class PywbCdxStrategy implements CdxStrategy {
  private readonly url: string;

  constructor(domain: string, cdxBaseUrl: string, cdxPageSize: number) {
    this.url = `${cdxBaseUrl}?matchType=domain&output=json&limit=${cdxPageSize}&url=${encodeURIComponent(domain)}`;
  }

  generateURL(_cursor: PageCursor | undefined): string {
    return this.url;
  }

  parseResult(responseText: string): PywbResult {
    const lines = responseText.split('\n').filter((l) => l.trim() !== '');
    const result: PywbResult = [];
    for (let i = 0; i < lines.length; i++) {
      try {
        result.push(JSON.parse(lines[i]) as Record<string, unknown>);
      } catch {
        console.error(`pywb CDX: failed to parse line ${i}: ${lines[i]}`);
      }
    }
    return result;
  }

  /** pywb returns all results in a single response — no next page. */
  buildNextPageCursor(_result: unknown): undefined {
    return undefined;
  }

  parseEntries(result: unknown): ParsedCdxEntry[] {
    const entries: ParsedCdxEntry[] = [];
    for (let i = 0; i < (result as PywbResult).length; i++) {
      const obj = (result as PywbResult)[i];

      const urlKey = parseStringField(obj['urlkey']);
      const timestamp = parseIntField(obj['timestamp']);
      const original = parseStringField(obj['url']);
      const mimetype = parseStringField(obj['mime']);
      const statusCode = parseIntField(obj['status']);
      const digest = parseStringField(obj['digest']);
      const length = parseIntField(obj['length']);

      entries.push({
        line: i,
        urlKey,
        timestamp,
        original,
        mimetype,
        statusCode,
        digest,
        length,
        raw: JSON.stringify(obj),
      });
    }
    return entries;
  }
}
