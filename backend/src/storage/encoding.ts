import chardet, { type Match } from 'chardet';
import * as fs from 'fs';
import iconv from 'iconv-lite';

export type EncodingSource = 'bom' | 'header' | 'meta' | 'chardet';

export interface DetectedEncoding {
  encoding: string;
  source: EncodingSource;
  chardetConfidence: number | null;
}

// These regexes operate on latin1-decoded bytes and are not UTF-16/32 compatible.
// That is intentional: UTF-16/32 documents are expected to declare themselves
// explicitly via a BOM or a Content-Type header (steps 1 & 2 above), so by the
// time we reach meta/chardet detection we can safely assume an 8-bit encoding.
const CHARSET_IN_CT_RE = /charset\s*=\s*("?)([^;"'\s]+)\1/i;

const META_CHARSET_RE = /<meta\b[^>]*?\bcharset\s*=\s*["']?\s*([^"'>\s;]+)/i;
const META_HTTP_EQUIV_RE =
  /<meta\b[^>]*http-equiv\s*=\s*["']content-type["'][^>]*content\s*=\s*["'][^"']*charset\s*=\s*([^"'>\s;]+)/i;

// Chardet confidence threshold to accept a result
const CHARDET_CONFIDENCE_THRESHOLD = 0.6;

// Byte counts to try when running chardet
const CHARDET_SAMPLE_SIZES = [1024, 2048, 4096, Infinity];

// Strip <style> and <script> blocks from latin1 text before chardet analysis
function stripScriptStyle(latin1: string): string {
  return latin1
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
}

// Return the match with the highest confidence score, regardless of array order.
function bestMatch(results: Match[]): Match | undefined {
  return results.reduce<Match | undefined>(
    (best, cur) =>
      best === undefined || cur.confidence > best.confidence ? cur : best,
    undefined,
  );
}

function detectBom(html: Buffer): DetectedEncoding | undefined {
  if (html.length >= 4) {
    if (
      html[0] === 0xff &&
      html[1] === 0xfe &&
      html[2] === 0x00 &&
      html[3] === 0x00
    )
      return {
        encoding: 'UTF-32LE',
        source: 'bom',
        chardetConfidence: null,
      };
    if (
      html[0] === 0x00 &&
      html[1] === 0x00 &&
      html[2] === 0xfe &&
      html[3] === 0xff
    )
      return {
        encoding: 'UTF-32BE',
        source: 'bom',
        chardetConfidence: null,
      };
  }
  if (html.length >= 3) {
    if (html[0] === 0xef && html[1] === 0xbb && html[2] === 0xbf)
      return { encoding: 'UTF-8', source: 'bom', chardetConfidence: null };
  }
  if (html.length >= 2) {
    if (html[0] === 0xff && html[1] === 0xfe)
      return {
        encoding: 'UTF-16LE',
        source: 'bom',
        chardetConfidence: null,
      };
    if (html[0] === 0xfe && html[1] === 0xff)
      return {
        encoding: 'UTF-16BE',
        source: 'bom',
        chardetConfidence: null,
      };
  }
  return undefined;
}

function detectEncodingMetaChardet(html: Buffer): DetectedEncoding | undefined {
  // Meta tags in first 4096 bytes
  const head = html.subarray(0, 4096).toString('latin1');
  const m1 = META_CHARSET_RE.exec(head);
  if (m1)
    return { encoding: m1[1], source: 'meta', chardetConfidence: null };
  const m2 = META_HTTP_EQUIV_RE.exec(head);
  if (m2)
    return { encoding: m2[1], source: 'meta', chardetConfidence: null };

  // chardet — strip scripts/styles from latin1, then analyse
  const latin1 = html.toString('latin1');
  const stripped = stripScriptStyle(latin1);
  const buf = Buffer.from(stripped, 'latin1');

  for (const size of CHARDET_SAMPLE_SIZES) {
    const sample = isFinite(size) ? buf.subarray(0, size) : buf;
    const results = chardet.analyse(sample);
    const best = bestMatch(results);
    if (!best) continue;
    const confidence = best.confidence / 100;
    if (confidence >= CHARDET_CONFIDENCE_THRESHOLD) {
      return {
        encoding: best.name,
        source: 'chardet',
        chardetConfidence: confidence,
      };
    }
  }

  const best = bestMatch(chardet.analyse(buf));
  if (best) {
    return {
      encoding: best.name,
      source: 'chardet',
      chardetConfidence: best.confidence / 100,
    };
  }
  return undefined;
}

/**
 * Detect the character encoding of an HTML document from the buffer alone.
 *
 * Priority: BOM → <meta charset> / <meta http-equiv> → chardet
 */
export function detectEncoding(html: Buffer): DetectedEncoding | undefined {
  return detectBom(html) ?? detectEncodingMetaChardet(html);
}

/**
 * Detect the character encoding of an HTML document, also consulting the
 * HTTP Content-Type header.
 *
 * Priority: BOM → Content-Type header charset → <meta charset> → chardet
 */
export function detectEncodingHttp(
  contentTypeHeader: string | undefined,
  html: Buffer,
): DetectedEncoding | undefined {
  const bom = detectBom(html);
  if (bom) return bom;

  if (contentTypeHeader) {
    const m = CHARSET_IN_CT_RE.exec(contentTypeHeader);
    if (m)
      return { encoding: m[2], source: 'header', chardetConfidence: null };
  }

  return detectEncodingMetaChardet(html);
}

export function resolveEncoding(
  encoding: string | null,
  context: string,
): string {
  if (!encoding) {
    console.warn(
      `[encoding] No encoding for ${context}, falling back to latin1`,
    );
    return 'latin1';
  }
  if (!iconv.encodingExists(encoding)) {
    console.warn(
      `[encoding] iconv-lite does not support encoding '${encoding}' for ${context}, falling back to latin1`,
    );
    return 'latin1';
  }
  return encoding;
}

export function readFileDecoded(
  filePath: string,
  encoding: string | null,
): string {
  return iconv.decode(
    fs.readFileSync(filePath),
    resolveEncoding(encoding, filePath),
  );
}

export function streamFileDecoded(
  filePath: string,
  encoding: string | null,
): NodeJS.ReadableStream {
  return fs
    .createReadStream(filePath)
    .pipe(iconv.decodeStream(resolveEncoding(encoding, filePath)));
}
