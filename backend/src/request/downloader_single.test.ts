import fs from 'fs';
import { describe, it, expect } from 'vitest';
import { downloadEntry } from './downloader';
import { buildAssetPath } from './paths';
import {
  createMockPool,
  seedResourceVersion,
  registerDownloaderHooks,
  domainName,
  normalizedDomain,
  replayBaseUrl,
  type DownloaderTestContext,
} from './downloader.test_setup';

describe('downloadEntry – single request (no redirect)', () => {
  const ctx = {} as DownloaderTestContext;
  registerDownloaderHooks(ctx);

  it('200 OK text/html no redirect: writes to disk and marks resource_version successful', async () => {
    const original = 'http://example.com/';
    const timestamp = 20210101000000;
    seedResourceVersion(ctx.cdxRepo, domainName, original, timestamp);

    ({ mockAgent: ctx.mockAgent, pool: ctx.pool } = createMockPool({
      [`${replayBaseUrl}${timestamp}id_/${original}`]: {
        statusCode: 200,
        body: '<html><head><title>Hello</title></head><body>World</body></html>',
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
    expect(rv?.last_errored_request_id).toBeNull();

    const requestId = rv!.successful_request_id!;
    const request = ctx.testRepo.getRequestById(requestId)!;
    expect(request).toMatchObject({
      status_code: 200,
      mimetype: 'text/html',
      is_successful: 1,
      resource_version_url: original,
      resource_version_timestamp: timestamp,
      encoding: 'utf-8',
    });

    expect(ctx.testRepo.countRequestErrors(requestId)).toBe(0);

    const { body_digest: bodyDigest } = request;
    const assetBase = buildAssetPath(ctx.outputFolder, bodyDigest);
    expect(fs.existsSync(assetBase)).toBe(true);
    expect(fs.existsSync(assetBase + '.attrs')).toBe(true);
    expect(fs.existsSync(assetBase + '.text')).toBe(true);
    expect(fs.existsSync(assetBase + '.comments')).toBe(true);
  });

  it('200 OK image/png no redirect: writes asset to disk, no html extraction files', async () => {
    const timestamp = 20210101000000;
    const original = 'http://example.com/logo.png';
    seedResourceVersion(ctx.cdxRepo, domainName, original, timestamp);

    // Minimal 1×1 PNG
    const pngBody = Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108020000009001' +
        '2e00000000c4944415478016360f8cfc00000000200016e21bc330000000049454e44ae426082',
      'hex',
    );

    ({ mockAgent: ctx.mockAgent, pool: ctx.pool } = createMockPool({
      [`${replayBaseUrl}${timestamp}id_/${original}`]: {
        statusCode: 200,
        body: pngBody,
        headers: {
          'content-type': 'image/png',
          'x-archive-orig-content-type': 'image/png',
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
    expect(rv?.last_errored_request_id).toBeNull();

    const requestId = rv!.successful_request_id!;
    const request = ctx.testRepo.getRequestById(requestId)!;
    expect(request).toMatchObject({
      status_code: 200,
      mimetype: 'image/png',
      is_successful: 1,
      resource_version_url: original,
      resource_version_timestamp: timestamp,
    });

    expect(ctx.testRepo.countRequestErrors(requestId)).toBe(0);

    const { body_digest: bodyDigest } = request;
    const assetBase = buildAssetPath(ctx.outputFolder, bodyDigest);
    expect(fs.existsSync(assetBase)).toBe(true);
    expect(fs.existsSync(assetBase + '.attrs')).toBe(false);
    expect(fs.existsSync(assetBase + '.text')).toBe(false);
    expect(fs.existsSync(assetBase + '.comments')).toBe(false);
  });
});
