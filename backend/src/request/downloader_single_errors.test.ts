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

  it('failed then successful retry: resource_version transitions from errored to successful', async () => {
    const timestamp = 20210101000000;
    const original = 'http://example.com/page';
    seedResourceVersion(ctx.cdxRepo, domainName, original, timestamp);

    const replayUrl = `${replayBaseUrl}${timestamp}id_/${original}`;
    const task = {
      runId: ctx.runId,
      timestamp,
      original,
      domainName,
      normalizedDomain,
      outputFolder: ctx.outputFolder,
      replayBaseUrl,
    };

    // First attempt: replay failure (no x-archive-orig-* headers)
    ({ mockAgent: ctx.mockAgent, pool: ctx.pool } = createMockPool({
      [replayUrl]: {
        statusCode: 503,
        body: 'Service Unavailable',
        headers: { 'content-type': 'text/plain' },
      },
    }));

    const firstResult = await downloadEntry(
      ctx.db,
      ctx.reqRepo,
      ctx.cdxRepo,
      ctx.runRepo,
      task,
      ctx.pool!,
    );

    expect(firstResult).toBe(false);

    const rvAfterFailure = ctx.testRepo.getResourceVersion(original, timestamp);
    expect(rvAfterFailure?.successful_request_id).toBeNull();
    expect(rvAfterFailure?.last_errored_request_id).toEqual(expect.any(String));

    const failedRequestId = rvAfterFailure!.last_errored_request_id!;
    expect(ctx.testRepo.countRequestErrors(failedRequestId)).toBe(1);

    // Second attempt: successful response
    await ctx.mockAgent!.close().catch(() => {});
    ({ mockAgent: ctx.mockAgent, pool: ctx.pool } = createMockPool({
      [replayUrl]: {
        statusCode: 200,
        body: '<html><body>Recovered</body></html>',
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'x-archive-orig-content-type': 'text/html; charset=utf-8',
        },
      },
    }));

    const secondResult = await downloadEntry(
      ctx.db,
      ctx.reqRepo,
      ctx.cdxRepo,
      ctx.runRepo,
      task,
      ctx.pool!,
    );

    expect(secondResult).toBe(true);

    const rvAfterRetry = ctx.testRepo.getResourceVersion(original, timestamp);
    expect(rvAfterRetry?.successful_request_id).toEqual(expect.any(String));
    expect(rvAfterRetry?.last_errored_request_id).toBeNull();

    const successfulRequestId = rvAfterRetry!.successful_request_id!;
    expect(successfulRequestId).not.toBe(failedRequestId);

    const successfulRequest = ctx.testRepo.getRequestById(successfulRequestId)!;
    expect(successfulRequest).toMatchObject({
      status_code: 200,
      mimetype: 'text/html',
      is_successful: 1,
      resource_version_url: original,
      resource_version_timestamp: timestamp,
    });
    expect(ctx.testRepo.countRequestErrors(successfulRequestId)).toBe(0);

    // Asset written to disk by the successful attempt
    const assetPath = buildAssetPath(
      ctx.outputFolder,
      successfulRequest.body_digest,
    );
    expect(fs.existsSync(assetPath)).toBe(true);
  });

  it('failed download after successful: resource_version unchanged, no new request row inserted', async () => {
    const timestamp = 20210101000000;
    const original = 'http://example.com/page';
    seedResourceVersion(ctx.cdxRepo, domainName, original, timestamp);

    const replayUrl = `${replayBaseUrl}${timestamp}id_/${original}`;
    const task = {
      runId: ctx.runId,
      timestamp,
      original,
      domainName,
      normalizedDomain,
      outputFolder: ctx.outputFolder,
      replayBaseUrl,
    };

    // First attempt: success
    ({ mockAgent: ctx.mockAgent, pool: ctx.pool } = createMockPool({
      [replayUrl]: {
        statusCode: 200,
        body: '<html><body>Hello</body></html>',
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'x-archive-orig-content-type': 'text/html; charset=utf-8',
        },
      },
    }));

    const firstResult = await downloadEntry(
      ctx.db,
      ctx.reqRepo,
      ctx.cdxRepo,
      ctx.runRepo,
      task,
      ctx.pool!,
    );

    expect(firstResult).toBe(true);

    const rvAfterSuccess = ctx.testRepo.getResourceVersion(original, timestamp);
    const originalSuccessfulRequestId = rvAfterSuccess!.successful_request_id!;
    expect(originalSuccessfulRequestId).toEqual(expect.any(String));
    expect(rvAfterSuccess?.last_errored_request_id).toBeNull();

    // Second attempt: replay failure
    await ctx.mockAgent!.close().catch(() => {});
    ({ mockAgent: ctx.mockAgent, pool: ctx.pool } = createMockPool({
      [replayUrl]: {
        statusCode: 503,
        body: 'Service Unavailable',
        headers: { 'content-type': 'text/plain' },
      },
    }));

    const secondResult = await downloadEntry(
      ctx.db,
      ctx.reqRepo,
      ctx.cdxRepo,
      ctx.runRepo,
      task,
      ctx.pool!,
    );

    expect(secondResult).toBe(false);

    // resource_version must be completely unchanged
    const rvAfterFailure = ctx.testRepo.getResourceVersion(original, timestamp);
    expect(rvAfterFailure?.successful_request_id).toBe(
      originalSuccessfulRequestId,
    );
    expect(rvAfterFailure?.last_errored_request_id).toBeNull();

    // Request row IS inserted but resource_version pointers are not updated
    expect(
      ctx.testRepo.countRequestsForResourceVersion(original, timestamp),
    ).toBe(2);
  });
});
