import fs from 'fs';
import { describe, it, expect } from 'vitest';
import { downloadEntry } from './downloader';
import { getAssetPath } from '../storage/id-path';
import {
  createMockPool,
  seedResourceVersion,
  registerDownloaderHooks,
  domainName,
  normalizedDomain,
  replayBaseUrl,
  type DownloaderTestContext,
} from './downloader.test_setup';

describe('downloadEntry – redirect', () => {
  const ctx = {} as DownloaderTestContext;
  registerDownloaderHooks(ctx);

  it('single hop redirect: redirect request recorded, target marked successful', async () => {
    const timestamp = 20210101000000;
    const original = 'http://example.com/old';
    const redirectTimestamp = 20210101000001;
    const redirectOriginal = 'http://example.com/new';
    seedResourceVersion(ctx.cdxRepo, domainName, original, timestamp);

    const redirectTarget = `${replayBaseUrl}${redirectTimestamp}id_/${redirectOriginal}`;

    ({ mockAgent: ctx.mockAgent, pool: ctx.pool } = createMockPool({
      [`${replayBaseUrl}${timestamp}id_/${original}`]: {
        statusCode: 301,
        body: '',
        headers: {
          location: redirectTarget,
        },
      },
      [redirectTarget]: {
        statusCode: 200,
        body: '<html><body>New page</body></html>',
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

    // Redirect hop: resource_version for original is marked successful (301 with no errors)
    // but the request row should have location fields populated
    const redirectHopRv = ctx.testRepo.getResourceVersion(original, timestamp);
    expect(redirectHopRv?.successful_request_id).toEqual(expect.any(String));
    expect(redirectHopRv?.last_errored_request_id).toBeNull();

    const redirectHopRequest = ctx.testRepo.getRequestById(
      redirectHopRv!.successful_request_id!,
    )!;
    expect(redirectHopRequest).toMatchObject({
      status_code: 301,
      is_successful: 1,
      location: redirectTarget,
      location_original: redirectOriginal,
      location_timestamp: redirectTimestamp,
    });

    // Terminal hop: resource_version for redirect target should be marked successful
    const terminalRv = ctx.testRepo.getResourceVersion(
      redirectOriginal,
      redirectTimestamp,
    );
    expect(terminalRv?.successful_request_id).toEqual(expect.any(String));
    expect(terminalRv?.last_errored_request_id).toBeNull();

    const terminalRequestId = terminalRv!.successful_request_id!;
    const terminalRequest = ctx.testRepo.getRequestById(terminalRequestId)!;
    expect(terminalRequest).toMatchObject({
      status_code: 200,
      mimetype: 'text/html',
      is_successful: 1,
      resource_version_url: redirectOriginal,
      resource_version_timestamp: redirectTimestamp,
    });

    expect(ctx.testRepo.countRequestErrors(terminalRequestId!)).toBe(0);

    const { body_digest: bodyDigest } = terminalRequest;
    const assetBase = getAssetPath(ctx.outputFolder, bodyDigest);
    expect(fs.existsSync(assetBase)).toBe(true);
    expect(fs.existsSync(assetBase + '.text')).toBe(true);
  });

  it('foreign domain redirect: hop recorded as successful with is_foreign_redirect set, no target resource_version created', async () => {
    const timestamp = 20210101000000;
    const original = 'http://example.com/page';
    const foreignTimestamp = 20210101000001;
    const foreignOriginal = 'http://other.com/page';
    seedResourceVersion(ctx.cdxRepo, domainName, original, timestamp);

    const redirectTarget = `${replayBaseUrl}${foreignTimestamp}id_/${foreignOriginal}`;

    ({ mockAgent: ctx.mockAgent, pool: ctx.pool } = createMockPool({
      [`${replayBaseUrl}${timestamp}id_/${original}`]: {
        statusCode: 301,
        body: '',
        headers: { location: redirectTarget },
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
      status_code: 301,
      is_successful: 1,
      is_foreign_redirect: 1,
      location: redirectTarget,
      location_original: foreignOriginal,
      location_timestamp: foreignTimestamp,
    });

    expect(ctx.testRepo.countRequestErrors(rv!.successful_request_id!)).toBe(0);

    // No resource_version row should be created for the foreign target
    expect(
      ctx.testRepo.getResourceVersion(foreignOriginal, foreignTimestamp),
    ).toBeUndefined();
  });

  it('subdomain redirect: not considered foreign, target resource_version created and marked successful', async () => {
    const timestamp = 20210101000000;
    const original = 'http://example.com/page';
    const subTimestamp = 20210101000001;
    const subOriginal = 'http://sub.example.com/page';
    seedResourceVersion(ctx.cdxRepo, domainName, original, timestamp);

    const redirectTarget = `${replayBaseUrl}${subTimestamp}id_/${subOriginal}`;

    ({ mockAgent: ctx.mockAgent, pool: ctx.pool } = createMockPool({
      [`${replayBaseUrl}${timestamp}id_/${original}`]: {
        statusCode: 301,
        body: '',
        headers: { location: redirectTarget },
      },
      [redirectTarget]: {
        statusCode: 200,
        body: '<html><body>Subdomain page</body></html>',
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

    const rvOrigin = ctx.testRepo.getResourceVersion(original, timestamp);
    expect(rvOrigin?.successful_request_id).toEqual(expect.any(String));

    const hopRequest = ctx.testRepo.getRequestById(
      rvOrigin!.successful_request_id!,
    )!;
    expect(hopRequest).toMatchObject({
      status_code: 301,
      is_successful: 1,
      is_foreign_redirect: 0,
      location: redirectTarget,
      location_original: subOriginal,
      location_timestamp: subTimestamp,
    });

    const rvSub = ctx.testRepo.getResourceVersion(subOriginal, subTimestamp);
    expect(rvSub?.successful_request_id).toEqual(expect.any(String));
    expect(rvSub?.last_errored_request_id).toBeNull();
  });
});
