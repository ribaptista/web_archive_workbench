import { describe, it, expect } from 'vitest';
import { Readable, Writable } from 'stream';
import {
  htmlStreamToNdjson,
  htmlStreamExtract,
  readNdjsonStream,
} from './html_ndjson';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function htmlReadable(html: string): Readable {
  // Simulate fs.createReadStream(path, { encoding: 'latin1' }): each byte
  // becomes its latin1 codepoint in the emitted string chunks.
  const buf = Buffer.from(html, 'latin1');
  const r = new Readable({
    read() {
      this.push(buf);
      this.push(null);
    },
  });
  r.setEncoding('latin1');
  return r;
}

function ndjsonReadable(lines: string[]): Readable {
  return Readable.from([lines.join('\n') + '\n']);
}

/** Collect all data written to a writable into a string. */
function collectWritable(): { writable: Writable; getOutput: () => string } {
  const chunks: string[] = [];
  const writable = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk.toString());
      cb();
    },
  });
  return { writable, getOutput: () => chunks.join('') };
}

/** Run htmlStreamToNdjson and return the NDJSON lines. */
async function htmlToLines(html: string): Promise<string[]> {
  const { writable, getOutput } = collectWritable();
  await htmlStreamToNdjson(htmlReadable(html), writable);
  return getOutput()
    .split('\n')
    .filter((l) => l.length > 0);
}

// ---------------------------------------------------------------------------
// htmlStreamToNdjson
// ---------------------------------------------------------------------------

describe('htmlStreamToNdjson', () => {
  it('emits an opentag line with base64-encoded name and empty attributes', async () => {
    const lines = await htmlToLines('<p></p>');
    const openLine = lines.find((l) => l.includes('"opentag"'));
    expect(openLine).toBeDefined();
    const obj = JSON.parse(openLine!);
    expect(Buffer.from(obj.opentag, 'base64').toString()).toBe('p');
    expect(obj.attributes).toEqual([]);
  });

  it('encodes tag attributes as base64 pairs', async () => {
    const lines = await htmlToLines('<a href="http://example.com">x</a>');
    const openLine = lines.find((l) => l.includes('"opentag"'));
    const obj = JSON.parse(openLine!);
    const attrs: [string, string][] = obj.attributes;
    const decoded = attrs.map(([k, v]) => [
      Buffer.from(k, 'base64').toString(),
      Buffer.from(v, 'base64').toString(),
    ]);
    expect(decoded).toContainEqual(['href', 'http://example.com']);
  });

  it('emits a closetag line', async () => {
    const lines = await htmlToLines('<p></p>');
    const closeLine = lines.find((l) => l.includes('"closetag"'));
    expect(closeLine).toBeDefined();
    const obj = JSON.parse(closeLine!);
    expect(Buffer.from(obj.closetag, 'base64').toString()).toBe('p');
  });

  it('emits a text line', async () => {
    const lines = await htmlToLines('<p>hello</p>');
    const textLine = lines.find((l) => l.includes('"text"'));
    expect(textLine).toBeDefined();
    const obj = JSON.parse(textLine!);
    expect(Buffer.from(obj.text, 'base64').toString()).toBe('hello');
  });

  it('emits a comment line', async () => {
    const lines = await htmlToLines('<!-- my comment -->');
    const commentLine = lines.find((l) => l.includes('"comment"'));
    expect(commentLine).toBeDefined();
    const obj = JSON.parse(commentLine!);
    expect(Buffer.from(obj.comment, 'base64').toString()).toBe(' my comment ');
  });

  it('preserves latin1 bytes in text', async () => {
    // 0xe9 = é in latin1
    const latin1Char = '\xe9';
    const lines = await htmlToLines(`<p>${latin1Char}</p>`);
    const textLine = lines.find((l) => l.includes('"text"'));
    const obj = JSON.parse(textLine!);
    const roundtripped = Buffer.from(obj.text, 'base64').toString('latin1');
    expect(roundtripped).toBe(latin1Char);
  });

  it('emits multiple tags in document order', async () => {
    const lines = await htmlToLines('<div><span></span></div>');
    const tagNames = lines
      .filter((l) => l.includes('"opentag"'))
      .map((l) => Buffer.from(JSON.parse(l).opentag, 'base64').toString());
    expect(tagNames).toEqual(['div', 'span']);
  });
});

// ---------------------------------------------------------------------------
// readNdjsonStream
// ---------------------------------------------------------------------------

describe('readNdjsonStream', () => {
  async function parse(html: string, options = {}) {
    const { writable, getOutput } = collectWritable();
    await htmlStreamToNdjson(htmlReadable(html), writable);
    const ndjsonStream = Readable.from([getOutput()]);
    return readNdjsonStream(ndjsonStream, 'utf-8', options);
  }

  it('returns tag names', async () => {
    const result = await parse('<div><span></span></div>');
    expect(result.tags.map((t) => t.name)).toEqual(['div', 'span']);
  });

  it('returns tag attributes decoded', async () => {
    const result = await parse(
      '<a href="http://example.com" class="foo">x</a>',
    );
    const a = result.tags.find((t) => t.name === 'a');
    expect(a?.attributes).toContainEqual(['href', 'http://example.com']);
    expect(a?.attributes).toContainEqual(['class', 'foo']);
  });

  it('collects and normalizes text', async () => {
    const result = await parse('<p>hello   world</p>');
    expect(result.text).toBe('hello world');
  });

  it('collects comments', async () => {
    const result = await parse('<!-- first --><!-- second -->');
    // normalizeText trims leading/trailing whitespace
    expect(result.comments).toEqual(['first', 'second']);
  });

  it('skips text content inside a skipped tag', async () => {
    const result = await parse('<p>visible</p><style>body{color:red}</style>', {
      skipTags: ['style'],
    });
    expect(result.text).not.toContain('color');
    expect(result.text).toContain('visible');
  });

  it('does not include skipped tag in tags array', async () => {
    const result = await parse('<div></div><script>var x=1</script>', {
      skipTags: ['script'],
    });
    expect(result.tags.map((t) => t.name)).not.toContain('script');
  });

  it('resumes collecting after the skipped tag closes', async () => {
    const result = await parse('<p>before</p><style>.x{}</style><p>after</p>', {
      skipTags: ['style'],
    });
    expect(result.text).toContain('before');
    expect(result.text).toContain('after');
    expect(result.text).not.toContain('.x');
  });

  it('handles nested skipped tags correctly', async () => {
    // style inside style (pathological but should still pop correctly)
    const result = await parse(
      '<div>outer</div><style><style>inner</style></style><p>end</p>',
      { skipTags: ['style'] },
    );
    expect(result.text).toContain('outer');
    expect(result.text).toContain('end');
    expect(result.text).not.toContain('inner');
  });

  it('trims and collapses whitespace in text', async () => {
    const result = await parse('<div>  \n  lots   of   space  \n  </div>');
    expect(result.text).toBe('lots of space');
  });

  it('returns empty text and tags for empty html', async () => {
    const result = await parse('');
    expect(result.text).toBe('');
    expect(result.tags).toEqual([]);
    expect(result.comments).toEqual([]);
  });

  it('inserts a space between text nodes separated by a <br>', async () => {
    const result = await parse('<span>hello</span><br><span>world</span>');
    expect(result.text).toBe('hello world');
  });

  it('inserts a space between text nodes separated by a <p>', async () => {
    const result = await parse('<p>first</p><p>second</p>');
    expect(result.text).toBe('first second');
  });

  it('does not insert a space between text nodes separated by an inline tag', async () => {
    const result = await parse('<span>hel</span><span>lo</span>');
    expect(result.text).toBe('hello');
  });

  it('adds a space after a <br> tag', async () => {
    const result = await parse('before<br>after');
    expect(result.text).toBe('before after');
  });

  it('adds a space after a closing <div>', async () => {
    const result = await parse('<div>inside</div>outside');
    expect(result.text).toBe('inside outside');
  });
});

// ---------------------------------------------------------------------------
// htmlStreamExtract
// ---------------------------------------------------------------------------

describe('htmlStreamExtract', () => {
  async function extract(html: string, options = {}) {
    const chunks: Record<'attrs' | 'text' | 'comments', string[]> = {
      attrs: [],
      text: [],
      comments: [],
    };
    function makeWritable(key: 'attrs' | 'text' | 'comments'): Writable {
      return new Writable({
        write(chunk, _enc, cb) {
          chunks[key].push(chunk.toString());
          cb();
        },
      });
    }
    await htmlStreamExtract(
      htmlReadable(html),
      makeWritable('attrs'),
      makeWritable('text'),
      makeWritable('comments'),
      options,
    );
    return {
      attrs: chunks.attrs.join(''),
      text: chunks.text.join(''),
      comments: chunks.comments.join(''),
    };
  }

  it('emits attribute values space-separated', async () => {
    const { attrs } = await extract(
      '<a href="http://example.com" class="foo">x</a>',
    );
    expect(attrs).toBe('http://example.com foo');
  });

  it('does not emit attribute names or tag names', async () => {
    const { attrs } = await extract('<input type="text" name="q">');
    expect(attrs).not.toContain('type');
    expect(attrs).not.toContain('name');
    expect(attrs).not.toContain('input');
  });

  it('emits text content', async () => {
    const { text } = await extract('<p>hello world</p>');
    expect(text).toContain('hello world');
  });

  it('emits comments', async () => {
    const { comments } = await extract('<!-- first --><!-- second -->');
    // leading space on first token is trimmed; 'first ' + 'second '
    expect(comments).toBe('first second ');
  });

  it('does not double-space when text ends with space and next starts with space', async () => {
    const { text } = await extract('<span>hello </span><span> world</span>');
    expect(text).toBe('hello world');
  });

  it('does not double-space when text before block boundary ends with space', async () => {
    const { text } = await extract('<div>hello </div><div>world</div>');
    expect(text).toBe('hello world');
  });

  it('does not double-space comments when adjacent comment starts with space', async () => {
    const { comments } = await extract('<!-- foo --><!-- bar -->');
    expect(comments).toBe('foo bar ');
  });

  it('collapses whitespace-only text between block tags to a single space', async () => {
    const { text } = await extract('<div>a</div> <div>b</div>');
    expect(text).toBe('a b');
  });

  it('skips text inside a skipped tag', async () => {
    const { text } = await extract(
      '<p>visible</p><style>body{color:red}</style>',
      {
        skipTags: ['style'],
      },
    );
    expect(text).not.toContain('color');
    expect(text).toContain('visible');
  });

  it('skips attribute values inside a skipped tag', async () => {
    const { attrs } = await extract(
      '<div class="outer"><script src="secret.js"></script></div>',
      {
        skipTags: ['script'],
      },
    );
    expect(attrs).toContain('outer');
    expect(attrs).not.toContain('secret.js');
  });

  it('inserts a space in text around a skipped block-level tag', async () => {
    const { text } = await extract('before<style>.x{}</style>after', {
      skipTags: ['style'],
    });
    // style is a block boundary; spaces should separate the tokens
    expect(text.trim()).toBe('before after');
  });

  it('inserts a space around block-level tags in text', async () => {
    const { text } = await extract('<div>first</div><div>second</div>');
    expect(text).toBe('first second');
  });

  it('inserts a space at <br>', async () => {
    const { text } = await extract('hello<br>world');
    expect(text).toBe('hello world');
  });

  it('does not insert a space for inline tags', async () => {
    const { text } = await extract('<span>hel</span><span>lo</span>');
    expect(text).toBe('hello');
  });

  it('resumes text and attrs after a skipped block closes', async () => {
    const { text, attrs } = await extract(
      '<p>before</p><style>.x{}</style><p class="after">after</p>',
      { skipTags: ['style'] },
    );
    expect(text).toContain('before');
    expect(text).toContain('after');
    expect(attrs).toContain('after');
  });
});
