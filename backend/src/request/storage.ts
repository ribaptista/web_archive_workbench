import path from 'path';
import { BodyParser } from '../http/body_parser';
import { htmlExtractToFiles } from '../storage/html';
import { nestedIdPath, getAssetPath } from '../storage/id-path';
import { saveFileUnsafe, saveFileSafe } from '../storage/fs';
import { type ContentType } from '../http/content_type';

async function saveGzip(
  rawBody: Buffer,
  decompressSucceeded: boolean,
  requestId: string,
  outputFolder: string,
  runId: string,
): Promise<string> {
  const gzipSubdir = decompressSucceeded ? 'gzip' : 'gzip_failed';
  const gzipDir = path.join(outputFolder, 'raw_responses', runId, gzipSubdir);
  const filePath = nestedIdPath(gzipDir, requestId, 2);
  await saveFileUnsafe(filePath, rawBody);
  return filePath;
}

async function saveFinalBody(
  finalBody: Buffer,
  finalAssetPath: string,
  requestId: string,
  outputFolder: string,
  runId: string,
): Promise<boolean> {
  const tmpPath = path.join(
    outputFolder,
    'raw_responses',
    runId,
    'tmp',
    String(requestId),
  );
  return saveFileSafe(finalAssetPath, tmpPath, finalBody);
}

async function handleParsedBody(
  bodyParser: BodyParser,
  contentType: ContentType,
  requestId: string,
  outputFolder: string,
  runId: string,
): Promise<string | undefined> {
  const bodyDigest = bodyParser.getBodyDigest();
  const finalBody = bodyParser.getParsed();
  const finalAssetPath = getAssetPath(outputFolder, bodyDigest);
  const isNewFile = await saveFinalBody(
    finalBody,
    finalAssetPath,
    requestId,
    outputFolder,
    runId,
  );
  if (isNewFile && contentType.mimeType === 'text/html') {
    const tmpPrefix = path.join(
      outputFolder,
      'raw_responses',
      runId,
      'tmp',
      `html_${requestId}`,
    );
    await htmlExtractToFiles(finalAssetPath, finalAssetPath, tmpPrefix, {
      skipTags: [
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
      ],
      inputEncoding: contentType.encoding?.encoding,
    });
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
    await handleParsedBody(
      bodyParser,
      contentType,
      requestId,
      outputFolder,
      runId,
    );
  }
}
