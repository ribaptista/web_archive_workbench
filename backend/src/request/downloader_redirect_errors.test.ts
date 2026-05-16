import { describe, it, expect } from 'vitest';
import { downloadEntry } from './downloader';
import { MAX_REDIRECT_COUNT } from '../http/redirect/redirect_chain';
import {
  createMockPool,
  seedResourceVersion,
  registerDownloaderHooks,
  domainName,
  normalizedDomain,
  replayBaseUrl,
  type DownloaderTestContext,
} from './downloader.test_setup';

describe('downloadEntry – redirect errors', () => {
  const ctx = {} as DownloaderTestContext;
  registerDownloaderHooks(ctx);

  function makeTask(original: string, timestamp: number) {
    return {
      runId: ctx.runId,
      timestamp,
      original,
      domainName,
      normalizedDomain,
      outputFolder: ctx.outputFolder,
      replayBaseUrl,
    };
  }

  it('missing location header: request recorded as errored', async () => {
    const timestamp = 20210101000000;
    const original = 'http://example.com/page';
    seedResourceVersion(ctx.cdxRepo, domainName, original, timestamp);

    ({ mockAgent: ctx.mockAgent, pool: ctx.pool } = createMockPool({
      [`${replayBaseUrl}${timestamp}id_/${original}`]: {
        statusCode: 301,
        body: '',
        headers: {},
      },
    }));

    const result = await downloadEntry(
      ctx.db,
      ctx.reqRepo,
      ctx.cdxRepo,
      ctx.runRepo,
      makeTask(original, timestamp),
      ctx.pool!,
    );

    expect(result).toBe(false);

    const rv = ctx.testRepo.getResourceVersion(original, timestamp);
    expect(rv?.successful_request_id).toBeNull();
    expect(rv?.last_errored_request_id).toEqual(expect.any(String));

    const request = ctx.testRepo.getRequestById(rv!.last_errored_request_id!)!;
    expect(request).toMatchObject({ status_code: 301, is_successful: 0 });
    expect(ctx.testRepo.countRequestErrors(rv!.last_errored_request_id!)).toBe(
      1,
    );
  });

  it('multiple location headers: request recorded as errored', async () => {
    const timestamp = 20210101000000;
    const original = 'http://example.com/page';
    seedResourceVersion(ctx.cdxRepo, domainName, original, timestamp);

    ({ mockAgent: ctx.mockAgent, pool: ctx.pool } = createMockPool({
      [`${replayBaseUrl}${timestamp}id_/${original}`]: {
        statusCode: 301,
        body: '',
        headers: {
          location: [
            `${replayBaseUrl}20210101000001id_/${original}`,
            `${replayBaseUrl}20210101000002id_/${original}`,
          ] as unknown as string,
        },
      },
    }));

    const result = await downloadEntry(
      ctx.db,
      ctx.reqRepo,
      ctx.cdxRepo,
      ctx.runRepo,
      makeTask(original, timestamp),
      ctx.pool!,
    );

    expect(result).toBe(false);

    const rv = ctx.testRepo.getResourceVersion(original, timestamp);
    expect(rv?.successful_request_id).toBeNull();
    expect(rv?.last_errored_request_id).toEqual(expect.any(String));
    expect(ctx.testRepo.countRequestErrors(rv!.last_errored_request_id!)).toBe(
      1,
    );
  });

  it('redirect loop: second hop recorded as errored', async () => {
    const timestamp = 20210101000000;
    const original = 'http://example.com/page';
    const firstHopUrl = `${replayBaseUrl}${timestamp}id_/${original}`;
    seedResourceVersion(ctx.cdxRepo, domainName, original, timestamp);

    // A → B → A (B's location points back to A's replay URL)
    const hopTimestamp = 20210101000001;
    const hopOriginal = 'http://example.com/hop';
    const hopUrl = `${replayBaseUrl}${hopTimestamp}id_/${hopOriginal}`;

    ({ mockAgent: ctx.mockAgent, pool: ctx.pool } = createMockPool({
      [firstHopUrl]: {
        statusCode: 301,
        body: '',
        headers: { location: hopUrl },
      },
      [hopUrl]: {
        statusCode: 301,
        body: '',
        headers: { location: firstHopUrl }, // loop back to A
      },
    }));

    const result = await downloadEntry(
      ctx.db,
      ctx.reqRepo,
      ctx.cdxRepo,
      ctx.runRepo,
      makeTask(original, timestamp),
      ctx.pool!,
    );

    expect(result).toBe(false);

    // First hop (original) should be recorded as successful (301, no errors yet)
    const rvA = ctx.testRepo.getResourceVersion(original, timestamp);
    expect(rvA?.successful_request_id).toEqual(expect.any(String));

    // Second hop (hopOriginal) should be recorded as errored (loop detected)
    const rvB = ctx.testRepo.getResourceVersion(hopOriginal, hopTimestamp);
    expect(rvB?.successful_request_id).toBeNull();
    expect(rvB?.last_errored_request_id).toEqual(expect.any(String));
    expect(ctx.testRepo.countRequestErrors(rvB!.last_errored_request_id!)).toBe(
      1,
    );
  });

  it('max redirects exceeded: last hop recorded as errored', async () => {
    const timestamp = 20210101000000;
    const original = 'http://example.com/page';
    seedResourceVersion(ctx.cdxRepo, domainName, original, timestamp);

    // Build a chain of MAX_REDIRECT_COUNT + 1 unique URLs
    const CHAIN_LENGTH = MAX_REDIRECT_COUNT + 1;
    const urls: string[] = [];
    for (let i = 0; i < CHAIN_LENGTH; i++) {
      urls.push(
        `${replayBaseUrl}${timestamp + i}id_/http://example.com/page${i}`,
      );
    }

    const intercepts: Parameters<typeof createMockPool>[0] = {};
    // First URL is the initial request for `original`
    intercepts[`${replayBaseUrl}${timestamp}id_/${original}`] = {
      statusCode: 301,
      body: '',
      headers: { location: urls[0] },
    };
    // urls[0]..urls[CHAIN_LENGTH-2] each redirect to the next
    for (let i = 0; i < CHAIN_LENGTH - 1; i++) {
      intercepts[urls[i]] = {
        statusCode: 301,
        body: '',
        headers: { location: urls[i + 1] },
      };
    }

    ({ mockAgent: ctx.mockAgent, pool: ctx.pool } = createMockPool(intercepts));

    const result = await downloadEntry(
      ctx.db,
      ctx.reqRepo,
      ctx.cdxRepo,
      ctx.runRepo,
      makeTask(original, timestamp),
      ctx.pool!,
    );

    expect(result).toBe(false);

    // The original hop should be successful (first redirect recorded ok)
    const rvOrigin = ctx.testRepo.getResourceVersion(original, timestamp);
    expect(rvOrigin?.successful_request_id).toEqual(expect.any(String));

    // MAX_REDIRECT_COUNT=20: the chain fills after 20 fetches (original + urls[0..18]).
    // The 20th fetch (urls[18]) resolves to urls[19] but canFollowRedirect fails → errored.
    // urls[18] has original=page18, timestamp=timestamp+18.
    const lastHopOriginal = `http://example.com/page${CHAIN_LENGTH - 3}`;
    const lastHopTimestamp = timestamp + CHAIN_LENGTH - 3;
    const rvLast = ctx.testRepo.getResourceVersion(
      lastHopOriginal,
      lastHopTimestamp,
    );
    expect(rvLast?.successful_request_id).toBeNull();
    expect(rvLast?.last_errored_request_id).toEqual(expect.any(String));
    expect(
      ctx.testRepo.countRequestErrors(rvLast!.last_errored_request_id!),
    ).toBe(1);
  });

  it('location pointing to a different base URL: request recorded as errored', async () => {
    const timestamp = 20210101000000;
    const original = 'http://example.com/page';
    seedResourceVersion(ctx.cdxRepo, domainName, original, timestamp);

    // Location is a valid URL but not on the Wayback replay base
    const externalLocation = 'https://example.com/some-other-site';

    ({ mockAgent: ctx.mockAgent, pool: ctx.pool } = createMockPool({
      [`${replayBaseUrl}${timestamp}id_/${original}`]: {
        statusCode: 301,
        body: '',
        headers: { location: externalLocation },
      },
    }));

    const result = await downloadEntry(
      ctx.db,
      ctx.reqRepo,
      ctx.cdxRepo,
      ctx.runRepo,
      makeTask(original, timestamp),
      ctx.pool!,
    );

    expect(result).toBe(false);

    const rv = ctx.testRepo.getResourceVersion(original, timestamp);
    expect(rv?.successful_request_id).toBeNull();
    expect(rv?.last_errored_request_id).toEqual(expect.any(String));

    const request = ctx.testRepo.getRequestById(rv!.last_errored_request_id!)!;
    // location is recorded even though parsing failed
    expect(request.location).toBe(externalLocation);
    expect(ctx.testRepo.countRequestErrors(rv!.last_errored_request_id!)).toBe(
      1,
    );
  });

  it('location not matching REPLAY_URL_SUFFIX_REGEX: request recorded as errored', async () => {
    const timestamp = 20210101000000;
    const original = 'http://example.com/page';
    seedResourceVersion(ctx.cdxRepo, domainName, original, timestamp);

    // URL starts with replayBaseUrl but the suffix doesn't match \d+id_/...
    const badSuffixLocation = `${replayBaseUrl}not-a-timestamp/http://example.com/page`;

    ({ mockAgent: ctx.mockAgent, pool: ctx.pool } = createMockPool({
      [`${replayBaseUrl}${timestamp}id_/${original}`]: {
        statusCode: 301,
        body: '',
        headers: { location: badSuffixLocation },
      },
    }));

    const result = await downloadEntry(
      ctx.db,
      ctx.reqRepo,
      ctx.cdxRepo,
      ctx.runRepo,
      makeTask(original, timestamp),
      ctx.pool!,
    );

    expect(result).toBe(false);

    const rv = ctx.testRepo.getResourceVersion(original, timestamp);
    expect(rv?.successful_request_id).toBeNull();
    expect(rv?.last_errored_request_id).toEqual(expect.any(String));
    expect(ctx.testRepo.countRequestErrors(rv!.last_errored_request_id!)).toBe(
      1,
    );
  });

  it('parsed original URL is invalid: request recorded as errored', async () => {
    const timestamp = 20210101000000;
    const original = 'http://example.com/page';
    seedResourceVersion(ctx.cdxRepo, domainName, original, timestamp);

    // Suffix matches REPLAY_URL_SUFFIX_REGEX but the "original" part is not a valid URL
    const invalidOriginal = 'not-a-valid-url';
    const badLocation = `${replayBaseUrl}${timestamp + 1}id_/${invalidOriginal}`;

    ({ mockAgent: ctx.mockAgent, pool: ctx.pool } = createMockPool({
      [`${replayBaseUrl}${timestamp}id_/${original}`]: {
        statusCode: 301,
        body: '',
        headers: { location: badLocation },
      },
    }));

    const result = await downloadEntry(
      ctx.db,
      ctx.reqRepo,
      ctx.cdxRepo,
      ctx.runRepo,
      makeTask(original, timestamp),
      ctx.pool!,
    );

    expect(result).toBe(false);

    const rv = ctx.testRepo.getResourceVersion(original, timestamp);
    expect(rv?.successful_request_id).toBeNull();
    expect(rv?.last_errored_request_id).toEqual(expect.any(String));
    expect(ctx.testRepo.countRequestErrors(rv!.last_errored_request_id!)).toBe(
      1,
    );
  });
});
