import { describe, it, expect } from 'vitest';
import { downloadEntry } from './downloader';
import {
  createMockPool,
  seedResourceVersion,
  registerDownloaderHooks,
  domainName,
  normalizedDomain,
  replayBaseUrl,
  type DownloaderTestContext,
} from './downloader.test_setup';

describe('downloadEntry – HTTP error responses', () => {
  const ctx = {} as DownloaderTestContext;
  registerDownloaderHooks(ctx);

  it('valid archived 404: x-archive-orig headers present, marked successful', async () => {
    const timestamp = 20210101000000;
    const original = 'http://example.com/missing';
    seedResourceVersion(ctx.cdxRepo, domainName, original, timestamp);

    ({ mockAgent: ctx.mockAgent, pool: ctx.pool } = createMockPool({
      [`${replayBaseUrl}${timestamp}id_/${original}`]: {
        statusCode: 404,
        body: '<html><body>Not found</body></html>',
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

    const request = ctx.testRepo.getRequestById(rv!.successful_request_id!)!;
    expect(request).toMatchObject({
      status_code: 404,
      mimetype: 'text/html',
      is_successful: 1,
      resource_version_url: original,
      resource_version_timestamp: timestamp,
    });

    expect(ctx.testRepo.countRequestErrors(rv!.successful_request_id!)).toBe(0);
  });

  it('replay failure: 404 without x-archive-orig headers, marked unsuccessful with error', async () => {
    const timestamp = 20210101000000;
    const original = 'http://example.com/missing';
    seedResourceVersion(ctx.cdxRepo, domainName, original, timestamp);

    ({ mockAgent: ctx.mockAgent, pool: ctx.pool } = createMockPool({
      [`${replayBaseUrl}${timestamp}id_/${original}`]: {
        statusCode: 404,
        body: 'Not found',
        headers: {
          'content-type': 'text/plain',
          // no x-archive-orig-* headers — Wayback itself returned 404
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

    const request = ctx.testRepo.getFirstRequest()!;
    expect(request).toMatchObject({
      status_code: 404,
      is_successful: 0,
      resource_version_url: original,
      resource_version_timestamp: timestamp,
    });

    expect(ctx.testRepo.countRequestErrors(rv!.last_errored_request_id!)).toBe(
      1,
    );
  });
});
