import type { ParsedCdxEntry } from './cdx-parse-utils';

/** Opaque cursor passed between pages. Each strategy defines its own concrete type. */
export type PageCursor = unknown;

export interface CdxStrategy {
  /** Build the URL for the given page. Pass `undefined` for the first page. */
  generateURL(cursor: PageCursor | undefined): string;
  /** Parse the raw response text into an internal result object for this strategy. */
  parseResult(responseText: string): unknown;
  /**
   * Inspect the parsed result and return the cursor for the next page,
   * or `undefined` if there are no more pages.
   */
  buildNextPageCursor(result: unknown): PageCursor | undefined;
  /** Extract CDX entries from the parsed result. */
  parseEntries(result: unknown): ParsedCdxEntry[];
}
