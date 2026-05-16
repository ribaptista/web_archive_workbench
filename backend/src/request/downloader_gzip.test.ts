import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { gzip } from 'zlib';
import { describe, it, expect } from 'vitest';
import { downloadEntry } from './downloader';
import { buildAssetPath, buildGzipPath } from './paths';
import {
  createMockPool,
  seedResourceVersion,
  registerDownloaderHooks,
  domainName,
  normalizedDomain,
  replayBaseUrl,
  type DownloaderTestContext,
} from './downloader.test_setup';

const gzipAsync = promisify(gzip);

describe('downloadEntry – gzip', () => {
  const ctx = {} as DownloaderTestContext;
  registerDownloaderHooks(ctx);

  it('valid gzip response: decompressed asset and raw gzip file both saved', async () => {
    const timestamp = 20210101000000;
    const original = 'http://example.com/page';
    seedResourceVersion(ctx.cdxRepo, domainName, original, timestamp);

    const htmlContent = '<html><body>Hello gzip</body></html>';
    const gzippedBody = await gzipAsync(Buffer.from(htmlContent));

    ({ mockAgent: ctx.mockAgent, pool: ctx.pool } = createMockPool({
      [`${replayBaseUrl}${timestamp}id_/${original}`]: {
        statusCode: 200,
        body: gzippedBody,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'x-archive-orig-content-type': 'text/html; charset=utf-8',
        },
      },
    }));

    const task = {
      runId: ctx.runId,
      timestamp,
      original,
      domainName,
      normalizedDomain,
      outputFolder: ctx.outputFolder,
      replayBaseUrl,
    };

    const result = await downloadEntry(
      ctx.db,
      ctx.reqRepo,
      ctx.cdxRepo,
      ctx.runRepo,
      task,
      ctx.pool!,
    );

    expect(result).toBe(true);

    const rv = ctx.testRepo.getResourceVersion(original, timestamp);
    expect(rv?.successful_request_id).toEqual(expect.any(String));

    const requestId = rv!.successful_request_id!;
    const request = ctx.testRepo.getRequestById(requestId)!;
    expect(request).toMatchObject({
      status_code: 200,
      mimetype: 'text/html',
      is_successful: 1,
    });
    expect(ctx.testRepo.countRequestErrors(requestId)).toBe(0);

    // Decompressed asset saved at assets path
    const assetPath = buildAssetPath(ctx.outputFolder, request.body_digest);
    expect(fs.existsSync(assetPath)).toBe(true);
    expect(fs.readFileSync(assetPath, 'utf-8')).toBe(htmlContent);

    // HTML extraction files present (decompressed body is valid html)
    expect(fs.existsSync(assetPath + '.text')).toBe(true);

    // Raw gzip file saved under raw_responses/<runId>/gzip/
    const gzipFilePath = buildGzipPath(
      ctx.outputFolder,
      ctx.runId,
      requestId,
      true,
    );
    expect(fs.existsSync(gzipFilePath)).toBe(true);
    expect(fs.readFileSync(gzipFilePath)).toEqual(gzippedBody);
  });

  it('corrupted gzip response: raw gzip_failed file saved, no asset, marked unsuccessful', async () => {
    const timestamp = 20210101000000;
    const original = 'http://example.com/page';
    seedResourceVersion(ctx.cdxRepo, domainName, original, timestamp);

    // Valid gzip magic bytes but corrupted payload
    const corruptedGzip = Buffer.from([
      0x1f, 0x8b, 0x00, 0xde, 0xad, 0xbe, 0xef,
    ]);

    ({ mockAgent: ctx.mockAgent, pool: ctx.pool } = createMockPool({
      [`${replayBaseUrl}${timestamp}id_/${original}`]: {
        statusCode: 200,
        body: corruptedGzip,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'x-archive-orig-content-type': 'text/html; charset=utf-8',
        },
      },
    }));

    const task = {
      runId: ctx.runId,
      timestamp,
      original,
      domainName,
      normalizedDomain,
      outputFolder: ctx.outputFolder,
      replayBaseUrl,
    };

    const result = await downloadEntry(
      ctx.db,
      ctx.reqRepo,
      ctx.cdxRepo,
      ctx.runRepo,
      task,
      ctx.pool!,
    );

    expect(result).toBe(false);

    const rv = ctx.testRepo.getResourceVersion(original, timestamp);
    expect(rv?.successful_request_id).toBeNull();
    expect(rv?.last_errored_request_id).toEqual(expect.any(String));

    const requestId = rv!.last_errored_request_id!;
    expect(ctx.testRepo.countRequestErrors(requestId)).toBe(1);

    // No decompressed asset
    // (body_digest is null when parse failed — check no assets dir content instead)
    expect(fs.existsSync(path.join(ctx.outputFolder, 'assets'))).toBe(false);

    // Raw corrupted gzip saved under raw_responses/<runId>/gzip_failed/
    const gzipFailedPath = buildGzipPath(
      ctx.outputFolder,
      ctx.runId,
      requestId,
      false,
    );
    expect(fs.existsSync(gzipFailedPath)).toBe(true);
    expect(fs.readFileSync(gzipFailedPath)).toEqual(corruptedGzip);
  });
});
