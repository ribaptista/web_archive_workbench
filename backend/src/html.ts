import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { Readable } from 'stream';
import { Parser } from 'htmlparser2';
import { streamFileDecoded } from './encoding';

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

export interface ExtractOptions {
  inputEncoding?: string;
  skipTags?: string[];
}

export async function htmlStreamExtract(
  htmlStream: NodeJS.ReadableStream,
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

const EXTRACT_SUFFIXES = ['.attrs', '.text', '.comments'] as const;
type ExtractSuffix = (typeof EXTRACT_SUFFIXES)[number];

export async function htmlExtractToFiles(
  htmlPath: string,
  outputPrefix: string,
  options: ExtractOptions = {},
): Promise<void> {
  const htmlStream = streamFileDecoded(htmlPath, options.inputEncoding ?? null);
  const streams = Object.fromEntries(
    EXTRACT_SUFFIXES.map((suffix) => [
      suffix,
      fs.createWriteStream(outputPrefix + suffix),
    ]),
  ) as Record<ExtractSuffix, fs.WriteStream>;
  await htmlStreamExtract(
    htmlStream,
    streams['.attrs'],
    streams['.text'],
    streams['.comments'],
    options,
  );
}

export async function htmlExtractToFilesAtomic(
  htmlPath: string,
  outputPrefix: string,
  tmpDir: string,
  options: ExtractOptions = {},
): Promise<void> {
  const tmpPrefix = path.join(tmpDir, `html_${randomUUID()}`);

  await htmlExtractToFiles(htmlPath, tmpPrefix, options);

  function commitSuffix(suffix: ExtractSuffix): void {
    try {
      fs.renameSync(tmpPrefix + suffix, outputPrefix + suffix);
    } catch (err) {
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        err.code === 'EEXIST'
      ) {
        console.info(
          `[htmlExtractToFilesAtomic] Output already exists for ${suffix}, discarding tmp file`,
        );
        try {
          fs.unlinkSync(tmpPrefix + suffix);
        } catch (unlinkErr) {
          console.error(
            `[htmlExtractToFilesAtomic] Failed to delete ${tmpPrefix + suffix}:`,
            unlinkErr,
          );
        }
        return;
      }
      throw err;
    }
  }

  commitSuffix('.attrs');
  commitSuffix('.text');
  commitSuffix('.comments');
}
