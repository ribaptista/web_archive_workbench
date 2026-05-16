import { describe, it, expect } from 'vitest';
import { Writable } from 'stream';
import { htmlStreamExtract } from './html';
import { Readable } from 'stream';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCollector(): { stream: Writable; result: () => string } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk.toString());
      cb();
    },
  });
  return { stream, result: () => chunks.join('') };
}

async function extract(
  html: string,
  options: Parameters<typeof htmlStreamExtract>[4] = {},
): Promise<{ attrs: string; text: string; comments: string }> {
  const attrs = makeCollector();
  const text = makeCollector();
  const comments = makeCollector();
  const readable = Readable.from([html]);
  await htmlStreamExtract(
    readable,
    attrs.stream,
    text.stream,
    comments.stream,
    options,
  );
  return {
    attrs: attrs.result(),
    text: text.result(),
    comments: comments.result(),
  };
}

// ---------------------------------------------------------------------------
// 1. Basic extraction
// ---------------------------------------------------------------------------

describe('basic extraction', () => {
  it('extracts text content', async () => {
    const r = await extract('<p>Hello world</p>');
    expect(r.text).toBe('Hello world');
  });

  it('extracts attribute values', async () => {
    const r = await extract(
      '<a href="https://example.com" title="Example">click</a>',
    );
    expect(r.attrs).toContain('https://example.com');
    expect(r.attrs).toContain('Example');
  });

  it('does not include tag names or attribute names in attrs stream', async () => {
    const r = await extract('<a href="url">text</a>');
    expect(r.attrs).not.toContain('href');
    expect(r.attrs).not.toContain('a');
  });

  it('extracts comment content', async () => {
    const r = await extract('<!-- this is a comment -->');
    expect(r.comments).toContain('this is a comment');
  });

  it('emits nothing for empty input', async () => {
    const r = await extract('');
    expect(r.text).toBe('');
    expect(r.attrs).toBe('');
    expect(r.comments).toBe('');
  });

  it('emits nothing for tags with no text, attrs, or comments', async () => {
    const r = await extract('<div><span></span></div>');
    expect(r.text).toBe('');
    expect(r.attrs).toBe('');
    expect(r.comments).toBe('');
  });
});

// ---------------------------------------------------------------------------
// 2. Whitespace normalisation
// ---------------------------------------------------------------------------

describe('whitespace normalisation', () => {
  it('collapses internal whitespace runs to a single space', async () => {
    const r = await extract('<p>foo   bar\t\nbaz</p>');
    expect(r.text).toBe('foo bar baz');
  });

  it('trims leading whitespace from text output', async () => {
    const r = await extract('<p>  leading</p>');
    expect(r.text).toBe('leading');
  });

  it('separates text from adjacent block-level tags with a space', async () => {
    const r = await extract('<p>foo</p><p>bar</p>');
    expect(r.text).toBe('foo bar');
  });

  it('does not double-space when boundary tag follows whitespace-only text', async () => {
    const r = await extract('<div>foo</div> <div>bar</div>');
    expect(r.text).not.toMatch(/  /);
    expect(r.text).toContain('foo');
    expect(r.text).toContain('bar');
  });

  it('collapses whitespace in attrs tokens', async () => {
    const r = await extract('<img alt="hello   world" />');
    expect(r.attrs).toContain('hello');
    expect(r.attrs).toContain('world');
  });
});

// ---------------------------------------------------------------------------
// 3. Skip tags
// ---------------------------------------------------------------------------

describe('skip tags', () => {
  it('suppresses text inside skipped tags', async () => {
    const r = await extract('<p>visible</p><script>hidden()</script>', {
      skipTags: ['script'],
    });
    expect(r.text).toBe('visible');
    expect(r.text).not.toContain('hidden');
  });

  it('suppresses attribute values inside skipped tags', async () => {
    const r = await extract('<style data-secret="x">body{}</style>', {
      skipTags: ['style'],
    });
    expect(r.attrs).not.toContain('x');
  });

  it('suppresses comments inside skipped tags', async () => {
    const r = await extract('<script><!-- secret --></script>', {
      skipTags: ['script'],
    });
    expect(r.comments).not.toContain('secret');
  });

  it('resumes extraction after a skipped tag closes', async () => {
    const r = await extract('<p>before</p><script>skip</script><p>after</p>', {
      skipTags: ['script'],
    });
    expect(r.text).toContain('before');
    expect(r.text).toContain('after');
    expect(r.text).not.toContain('skip');
  });

  it('handles nested elements inside a skipped tag', async () => {
    const r = await extract(
      '<div>keep</div><script><span>inner</span></script><div>keep2</div>',
      { skipTags: ['script'] },
    );
    expect(r.text).toContain('keep');
    expect(r.text).toContain('keep2');
    expect(r.text).not.toContain('inner');
  });

  it('skip matching is case-insensitive', async () => {
    const r = await extract('<p>a</p><SCRIPT>hidden</SCRIPT><p>b</p>', {
      skipTags: ['script'],
    });
    expect(r.text).not.toContain('hidden');
    expect(r.text).toContain('a');
    expect(r.text).toContain('b');
  });
});

// ---------------------------------------------------------------------------
// 4. Entity decoding
// ---------------------------------------------------------------------------

describe('entity decoding', () => {
  it('decodes HTML entities in text', async () => {
    const r = await extract('<p>AT&amp;T &lt;rocks&gt;</p>');
    expect(r.text).toContain('AT&T');
    expect(r.text).toContain('<rocks>');
  });

  it('decodes HTML entities in attribute values', async () => {
    const r = await extract('<a title="Q&amp;A">link</a>');
    expect(r.attrs).toContain('Q&A');
  });

  it('decodes numeric character references', async () => {
    const r = await extract('<p>&#169;</p>');
    expect(r.text).toContain('©');
  });
});

// ---------------------------------------------------------------------------
// 5. Text boundary tags
// ---------------------------------------------------------------------------

describe('text boundary tags', () => {
  it('inserts a space between text in sibling block tags', async () => {
    const r = await extract('<h1>Title</h1><p>Body</p>');
    expect(r.text).toBe('Title Body');
  });

  it('does not insert a leading space before the very first text', async () => {
    const r = await extract('<p>first</p>');
    expect(r.text[0]).not.toBe(' ');
  });

  it('inline tags do not insert a boundary space', async () => {
    const r = await extract('<p>foo <span>bar</span> baz</p>');
    expect(r.text).toBe('foo bar baz');
  });
});

// ---------------------------------------------------------------------------
// 6. Multiple attributes
// ---------------------------------------------------------------------------

describe('multiple attributes', () => {
  it('outputs all non-empty attribute values separated by spaces', async () => {
    const r = await extract('<img src="cat.png" alt="a cat" title="photo" />');
    expect(r.attrs).toContain('cat.png');
    expect(r.attrs).toContain('a cat');
    expect(r.attrs).toContain('photo');
  });

  it('skips empty attribute values', async () => {
    const r = await extract('<input placeholder="" type="text" />');
    expect(r.attrs.trim()).toBe('text');
  });
});

// ---------------------------------------------------------------------------
// 7. Separation between attrs tokens
// ---------------------------------------------------------------------------

describe('attrs token separation', () => {
  it('separates consecutive attribute values with a space', async () => {
    const r = await extract('<a href="url" title="t">x</a>');
    // Both values present and separated
    expect(r.attrs).toMatch(/url\s+t|t\s+url/);
  });

  it('separates attribute values across different elements with a space', async () => {
    const r = await extract('<a href="one">x</a><a href="two">y</a>');
    expect(r.attrs).toContain('one');
    expect(r.attrs).toContain('two');
  });
});
