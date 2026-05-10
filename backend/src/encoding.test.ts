import { describe, it, expect } from 'vitest';
import { detectEncoding } from './encoding';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buf(s: string, enc: BufferEncoding = 'latin1'): Buffer {
  return Buffer.from(s, enc);
}

function html(body: string): Buffer {
  return buf(`<html><head></head><body>${body}</body></html>`);
}

const NO_HEADERS: Record<string, string> = {};

// ---------------------------------------------------------------------------
// 1. BOM detection
// ---------------------------------------------------------------------------

describe('BOM detection', () => {
  it('detects UTF-8 BOM (EF BB BF)', () => {
    const b = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), html('hello')]);
    const r = detectEncoding(NO_HEADERS, b);
    expect(r).toMatchObject({
      encoding: 'UTF-8',
      source: 'bom',
      chardetConfidence: null,
    });
  });

  it('detects UTF-16 LE BOM (FF FE)', () => {
    const b = Buffer.concat([Buffer.from([0xff, 0xfe]), html('hello')]);
    const r = detectEncoding(NO_HEADERS, b);
    expect(r).toMatchObject({
      encoding: 'UTF-16LE',
      source: 'bom',
      chardetConfidence: null,
    });
  });

  it('detects UTF-16 BE BOM (FE FF)', () => {
    const b = Buffer.concat([Buffer.from([0xfe, 0xff]), html('hello')]);
    const r = detectEncoding(NO_HEADERS, b);
    expect(r).toMatchObject({
      encoding: 'UTF-16BE',
      source: 'bom',
      chardetConfidence: null,
    });
  });

  it('detects UTF-32 LE BOM (FF FE 00 00)', () => {
    const b = Buffer.concat([
      Buffer.from([0xff, 0xfe, 0x00, 0x00]),
      html('hello'),
    ]);
    const r = detectEncoding(NO_HEADERS, b);
    expect(r).toMatchObject({
      encoding: 'UTF-32LE',
      source: 'bom',
      chardetConfidence: null,
    });
  });

  it('detects UTF-32 BE BOM (00 00 FE FF)', () => {
    const b = Buffer.concat([
      Buffer.from([0x00, 0x00, 0xfe, 0xff]),
      html('hello'),
    ]);
    const r = detectEncoding(NO_HEADERS, b);
    expect(r).toMatchObject({
      encoding: 'UTF-32BE',
      source: 'bom',
      chardetConfidence: null,
    });
  });

  it('UTF-32 LE is preferred over UTF-16 LE when 4 bytes match', () => {
    // FF FE 00 00 — must be UTF-32 LE, not UTF-16 LE
    const b = Buffer.from([0xff, 0xfe, 0x00, 0x00]);
    const r = detectEncoding(NO_HEADERS, b);
    expect(r?.encoding).toBe('UTF-32LE');
  });
});

// ---------------------------------------------------------------------------
// 2. Content-Type header
// ---------------------------------------------------------------------------

describe('Content-Type header', () => {
  it('reads charset from simple content-type', () => {
    const r = detectEncoding(
      { 'content-type': 'text/html; charset=windows-1252' },
      html('hello'),
    );
    expect(r).toMatchObject({
      encoding: 'windows-1252',
      source: 'header',
      chardetConfidence: null,
    });
  });

  it('reads charset with quoted value', () => {
    const r = detectEncoding(
      { 'content-type': 'text/html; charset="ISO-8859-1"' },
      html('hello'),
    );
    expect(r).toMatchObject({
      encoding: 'ISO-8859-1',
      source: 'header',
      chardetConfidence: null,
    });
  });

  it('is case-insensitive for charset keyword', () => {
    const r = detectEncoding(
      { 'content-type': 'text/html; Charset=UTF-8' },
      html('hello'),
    );
    expect(r).toMatchObject({ encoding: 'UTF-8', source: 'header' });
  });

  it('ignores content-type without charset', () => {
    const r = detectEncoding(
      { 'content-type': 'text/html' },
      buf('<html><head><meta charset="ISO-8859-2"></head><body></body></html>'),
    );
    // Falls through to meta
    expect(r?.source).toBe('meta');
  });

  it('takes array content-type (uses first element)', () => {
    const r = detectEncoding(
      {
        'content-type': [
          'text/html; charset=KOI8-R',
          'text/html; charset=UTF-8',
        ] as unknown as string,
      },
      html('hello'),
    );
    expect(r).toMatchObject({ encoding: 'KOI8-R', source: 'header' });
  });
});

// ---------------------------------------------------------------------------
// 3. Meta tag detection
// ---------------------------------------------------------------------------

describe('Meta tag detection', () => {
  it('detects <meta charset="..."> (HTML5)', () => {
    const b = buf(
      '<html><head><meta charset="ISO-8859-2"></head><body></body></html>',
    );
    const r = detectEncoding(NO_HEADERS, b);
    expect(r).toMatchObject({
      encoding: 'ISO-8859-2',
      source: 'meta',
      chardetConfidence: null,
    });
  });

  it('detects <meta charset=...> without quotes', () => {
    const b = buf(
      '<html><head><meta charset=windows-1251></head><body></body></html>',
    );
    const r = detectEncoding(NO_HEADERS, b);
    expect(r).toMatchObject({ encoding: 'windows-1251', source: 'meta' });
  });

  it('detects http-equiv content-type meta', () => {
    const b = buf(
      '<html><head>' +
        '<meta http-equiv="content-type" content="text/html; charset=EUC-JP">' +
        '</head><body></body></html>',
    );
    const r = detectEncoding(NO_HEADERS, b);
    expect(r).toMatchObject({ encoding: 'EUC-JP', source: 'meta' });
  });

  it('is case-insensitive for meta tag attributes', () => {
    const b = buf(
      '<html><head><meta CHARSET="UTF-8"></head><body></body></html>',
    );
    const r = detectEncoding(NO_HEADERS, b);
    expect(r?.source).toBe('meta');
    expect(r?.encoding).toBe('UTF-8');
  });

  it('ignores meta beyond first 4096 bytes', () => {
    const padding = 'x'.repeat(4097);
    const b = buf(
      `<html><head></head><body>${padding}<meta charset="ISO-8859-2"></body></html>`,
    );
    // No BOM, no header, meta is past 4096 bytes — must fall through to chardet
    const r = detectEncoding(NO_HEADERS, b);
    expect(r?.source).not.toBe('meta');
  });
});

// ---------------------------------------------------------------------------
// 4. Chardet fallback
// ---------------------------------------------------------------------------

describe('chardet fallback', () => {
  it('returns source=chardet when no other signal present', () => {
    // A plain ASCII document — chardet will assign something
    const b = buf(
      '<html><body>Hello world, this is plain ASCII text.</body></html>',
    );
    const r = detectEncoding(NO_HEADERS, b);
    // Either chardet or null; in practice ASCII produces a result
    if (r !== null) {
      expect(r.source).toBe('chardet');
    }
  });

  it('returns a confidence value between 0 and 1 for chardet result', () => {
    const b = buf('<html><body>Hello world</body></html>');
    const r = detectEncoding(NO_HEADERS, b);
    if (r?.source === 'chardet') {
      expect(r.chardetConfidence).not.toBeNull();
      expect(r.chardetConfidence!).toBeGreaterThan(0);
      expect(r.chardetConfidence!).toBeLessThanOrEqual(1);
    }
  });

  it('returns chardet result for empty buffer (chardet reports ASCII/100)', () => {
    const r = detectEncoding(NO_HEADERS, Buffer.alloc(0));
    // chardet returns ASCII with confidence 1 for empty input
    expect(r).toMatchObject({
      encoding: 'ASCII',
      source: 'chardet',
      chardetConfidence: 1,
    });
  });
});

// ---------------------------------------------------------------------------
// 5. Priority ordering
// ---------------------------------------------------------------------------

describe('priority ordering', () => {
  it('BOM wins over header', () => {
    const b = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), html('hello')]);
    const r = detectEncoding(
      { 'content-type': 'text/html; charset=windows-1252' },
      b,
    );
    expect(r?.source).toBe('bom');
    expect(r?.encoding).toBe('UTF-8');
  });

  it('header wins over meta', () => {
    const b = buf(
      '<html><head><meta charset="ISO-8859-2"></head><body></body></html>',
    );
    const r = detectEncoding({ 'content-type': 'text/html; charset=UTF-8' }, b);
    expect(r?.source).toBe('header');
    expect(r?.encoding).toBe('UTF-8');
  });

  it('meta wins over chardet', () => {
    // Plain ASCII — chardet would normally pick something up, but meta must win
    const b = buf(
      '<html><head><meta charset="ISO-8859-15"></head><body>Hello world</body></html>',
    );
    const r = detectEncoding(NO_HEADERS, b);
    expect(r?.source).toBe('meta');
    expect(r?.encoding).toBe('ISO-8859-15');
  });
});
