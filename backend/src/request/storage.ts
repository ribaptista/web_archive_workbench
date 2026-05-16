import { BodyParser } from '../http/body_parser';
import { htmlExtractToFiles } from '../storage/html';
import { buildGzipPath, buildTmpPath, buildAssetPath } from './paths';
import { saveFileUnsafe, saveFileSafe } from '../storage/fs';
import { type ContentType } from '../http/content_type';

const HTML_SKIP_TAGS = [
  'script',
  'style',
  'head',
  'template',
  'meta',
  'link',
  'base',
  'noscript',
  'svg',
  'math',
] as string[];

async function saveGzip(
  rawBody: Buffer,
  decompressSucceeded: boolean,
  requestId: string,
  outputFolder: string,
  runId: string,
): Promise<string> {
  const filePath = buildGzipPath(
    outputFolder,
    runId,
    requestId,
    decompressSucceeded,
  );
  await saveFileUnsafe(filePath, rawBody);
  return filePath;
}

async function saveFinalBody(
  finalBody: Buffer,
  finalAssetPath: string,
  outputFolder: string,
  runId: string,
): Promise<boolean> {
  const tmpPath = buildTmpPath(outputFolder, runId);
  return saveFileSafe(finalAssetPath, tmpPath, finalBody);
}

async function extractHtml(
  finalAssetPath: string,
  contentType: ContentType,
  outputFolder: string,
  runId: string,
): Promise<void> {
  const tmpPrefix = buildTmpPath(outputFolder, runId);
  await htmlExtractToFiles(finalAssetPath, finalAssetPath, tmpPrefix, {
    skipTags: HTML_SKIP_TAGS,
    inputEncoding: contentType.encoding?.encoding,
  });
}

async function handleParsedBody(
  bodyParser: BodyParser,
  contentType: ContentType,
  outputFolder: string,
  runId: string,
): Promise<string | undefined> {
  const bodyDigest = bodyParser.getBodyDigest();
  const finalBody = bodyParser.getParsed();
  const finalAssetPath = buildAssetPath(outputFolder, bodyDigest);
  const isNewFile = await saveFinalBody(
    finalBody,
    finalAssetPath,
    outputFolder,
    runId,
  );

  if (isNewFile && contentType.mimeType === 'text/html') {
    await extractHtml(finalAssetPath, contentType, outputFolder, runId);
  }
  return finalAssetPath;
}

export async function saveRequestToDisk(
  bodyParser: BodyParser,
  contentType: ContentType,
  requestId: string,
  outputFolder: string,
  runId: string,
) {
  const parsedSuccessfully = bodyParser.isParsed();
  const inferredGzip = bodyParser.getCompressionFormat() === 'gzip';

  if (inferredGzip) {
    await saveGzip(
      bodyParser.getRaw(),
      parsedSuccessfully,
      requestId,
      outputFolder,
      runId,
    );
  }
  if (parsedSuccessfully) {
    await handleParsedBody(bodyParser, contentType, outputFolder, runId);
  }
}
