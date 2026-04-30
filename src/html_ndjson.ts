import fs from 'fs';
import readline from 'readline';
import { Readable } from 'stream';
import { Parser } from 'htmlparser2';

function b64(s: string): string {
  return Buffer.from(s, 'latin1').toString('base64');
}

function fromB64(s: string, encoding: BufferEncoding): string {
  return Buffer.from(s, 'base64').toString(encoding);
}

type OpenTagEntry = { opentag: string; attributes: [string, string][] };
type CloseTagEntry = { closetag: string };
type TextEntry = { text: string };
type CommentEntry = { comment: string };
type HtmlEntry = OpenTagEntry | CloseTagEntry | TextEntry | CommentEntry;

const TEXT_BOUNDARY_TAGS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'br',
  'canvas',
  'dd',
  'details',
  'dialog',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'head',
  'header',
  'hgroup',
  'hr',
  'html',
  'legend',
  'li',
  'main',
  'menu',
  'nav',
  'ol',
  'p',
  'pre',
  'script',
  'section',
  'style',
  'summary',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'title',
  'tr',
  'ul',
]);

export async function htmlStreamToNdjson(
  htmlStream: Readable,
  ndjsonStream: NodeJS.WritableStream,
): Promise<void> {
  function emit(obj: CloseTagEntry | TextEntry | CommentEntry): void {
    const key =
      'closetag' in obj ? 'closetag' : 'text' in obj ? 'text' : 'comment';
    const value = (obj as Record<string, string>)[key];
    ndjsonStream.write(JSON.stringify({ [key]: b64(value) }) + '\n');
  }

  function emitTag(name: string, attribs: Record<string, string>): void {
    const entry: OpenTagEntry = {
      opentag: b64(name),
      attributes: Object.entries(attribs).map(([k, v]) => [b64(k), b64(v)]),
    };
    ndjsonStream.write(JSON.stringify(entry) + '\n');
  }

  const parser = new Parser(
    {
      onopentag(name, attribs) {
        emitTag(name, attribs);
      },
      onclosetag(name) {
        emit({ closetag: name });
      },
      ontext(text) {
        emit({ text });
      },
      oncomment(data) {
        emit({ comment: data });
      },
    },
    { decodeEntities: true },
  );

  await new Promise<void>((resolve, reject) => {
    htmlStream.on('data', (chunk: string) => parser.write(chunk));
    htmlStream.on('error', reject);
    htmlStream.on('end', () => {
      parser.end();
      (ndjsonStream as fs.WriteStream).end(resolve);
    });
  });
}

export async function htmlToNdjson(
  htmlPath: string,
  ndjsonPath: string,
): Promise<void> {
  const htmlStream = fs.createReadStream(htmlPath, { encoding: 'latin1' });
  const ndjsonStream = fs.createWriteStream(ndjsonPath, { encoding: 'utf-8' });
  await htmlStreamToNdjson(htmlStream, ndjsonStream);
}

export interface ExtractOptions {
  skipTags?: string[];
}

export async function htmlStreamExtract(
  htmlStream: Readable,
  attributesStream: NodeJS.WritableStream,
  textStream: NodeJS.WritableStream,
  commentsStream: NodeJS.WritableStream,
  options: ExtractOptions = {},
): Promise<void> {
  const skipSet = new Set((options.skipTags ?? []).map((t) => t.toLowerCase()));
  const skipStack: string[] = [];

  const lastChar = new Map<NodeJS.WritableStream, string>([
    [attributesStream, ''],
    [commentsStream, ''],
  ]);

  function writeToken(stream: NodeJS.WritableStream, value: string): void {
    const lc = lastChar.get(stream) ?? '';
    if (lc !== '' && lc !== ' ' && lc !== '\n') stream.write(' ');
    if (lc === '' || lc === ' ' || lc === '\n') value = value.trimStart();
    if (!value) return;
    stream.write(value);
    lastChar.set(stream, value[value.length - 1]);
  }

  let textStarted = false;
  let textPendingSpace = false;
  let lastTextChar = '';

  function writeText(value: string): void {
    if (
      textStarted &&
      textPendingSpace &&
      lastTextChar !== ' ' &&
      lastTextChar !== '\n'
    ) {
      textStream.write(' ');
      lastTextChar = ' ';
    }
    textPendingSpace = false;
    if (!textStarted || lastTextChar === ' ' || lastTextChar === '\n')
      value = value.trimStart();
    if (!value) return;
    textStream.write(value);
    textStarted = true;
    lastTextChar = value[value.length - 1];
  }

  function markTextBoundary(): void {
    if (textStarted) textPendingSpace = true;
  }

  const parser = new Parser(
    {
      onopentag(name, attribs) {
        const lower = name.toLowerCase();
        if (skipStack.length === 0 && TEXT_BOUNDARY_TAGS.has(lower)) {
          markTextBoundary();
        }
        if (skipSet.has(lower)) {
          skipStack.push(lower);
          return;
        }
        if (skipStack.length > 0) return;
        for (const value of Object.values(attribs)) {
          if (value) writeToken(attributesStream, value);
        }
      },
      onclosetag(name) {
        const lower = name.toLowerCase();
        if (skipStack.length > 0 && skipStack[skipStack.length - 1] === lower) {
          skipStack.pop();
          if (TEXT_BOUNDARY_TAGS.has(lower)) {
            markTextBoundary();
          }
          return;
        }
        if (skipStack.length > 0) return;
        if (TEXT_BOUNDARY_TAGS.has(lower)) {
          markTextBoundary();
        }
      },
      ontext(text) {
        if (skipStack.length === 0) writeText(text.replace(/\s+/g, ' '));
      },
      oncomment(data) {
        if (skipStack.length === 0)
          writeToken(commentsStream, data.replace(/\s+/g, ' '));
      },
    },
    { decodeEntities: true },
  );

  await new Promise<void>((resolve, reject) => {
    htmlStream.on('data', (chunk: string) => parser.write(chunk));
    htmlStream.on('error', reject);
    htmlStream.on('end', () => {
      parser.end();
      attributesStream.end();
      textStream.end();
      commentsStream.end();
      resolve();
    });
  });
}

export async function htmlExtractToFiles(
  htmlPath: string,
  outputPrefix: string,
  options: ExtractOptions = {},
): Promise<void> {
  const htmlStream = fs.createReadStream(htmlPath, { encoding: 'latin1' });
  const attrsStream = fs.createWriteStream(outputPrefix + '.attrs', {
    encoding: 'latin1',
  });
  const textStream = fs.createWriteStream(outputPrefix + '.text', {
    encoding: 'latin1',
  });
  const commentsStream = fs.createWriteStream(outputPrefix + '.comments', {
    encoding: 'latin1',
  });
  await htmlStreamExtract(
    htmlStream,
    attrsStream,
    textStream,
    commentsStream,
    options,
  );
}

export interface ParsedTag {
  name: string;
  attributes: [string, string][];
}

export interface ParsedHtml {
  tags: ParsedTag[];
  text: string;
  comments: string[];
}

export interface ReadNdjsonOptions {
  skipTags?: string[];
}

export function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export async function readNdjsonStream(
  ndjsonStream: Readable,
  encoding: BufferEncoding,
  options: ReadNdjsonOptions = {},
): Promise<ParsedHtml> {
  const skipSet = new Set((options.skipTags ?? []).map((t) => t.toLowerCase()));

  const rl = readline.createInterface({
    input: ndjsonStream,
    crlfDelay: Infinity,
  });

  const tags: ParsedTag[] = [];
  const textParts: string[] = [];
  const comments: string[] = [];
  // Stack of skipped tag names currently open
  const skipStack: string[] = [];

  for await (const line of rl) {
    if (!line) continue;
    const obj = JSON.parse(line) as HtmlEntry;
    if ('opentag' in obj) {
      const name = fromB64(obj.opentag, encoding);
      if (
        skipStack.length === 0 &&
        TEXT_BOUNDARY_TAGS.has(name.toLowerCase())
      ) {
        textParts.push('\n');
      }

      if (skipSet.has(name.toLowerCase())) {
        skipStack.push(name.toLowerCase());
      } else if (skipStack.length === 0) {
        tags.push({
          name,
          attributes: obj.attributes.map(([k, v]) => [
            fromB64(k, encoding),
            fromB64(v, encoding),
          ]),
        });
      }
    } else if ('closetag' in obj) {
      const name = fromB64(obj.closetag, encoding);
      if (
        skipStack.length > 0 &&
        skipStack[skipStack.length - 1] === name.toLowerCase()
      ) {
        skipStack.pop();
      }
      if (
        skipStack.length === 0 &&
        TEXT_BOUNDARY_TAGS.has(name.toLowerCase())
      ) {
        textParts.push('\n');
      }
    } else if ('text' in obj) {
      if (skipStack.length === 0) {
        textParts.push(fromB64(obj.text, encoding));
      }
    } else if ('comment' in obj) {
      comments.push(fromB64(obj.comment, encoding));
    }
  }

  return {
    tags,
    text: normalizeText(textParts.join('')),
    comments: comments.map((c) => normalizeText(c)),
  };
}

export async function readNdjson(
  ndjsonPath: string,
  encoding: BufferEncoding,
  options: ReadNdjsonOptions = {},
): Promise<ParsedHtml> {
  const ndjsonStream = fs.createReadStream(ndjsonPath, { encoding: 'utf-8' });
  return readNdjsonStream(ndjsonStream, encoding, options);
}
