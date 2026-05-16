import { randomUUID } from 'crypto';
import type { DB } from '../db/conn';
import {
  NetworkFetchError,
  ProxyPool,
  RawResponse,
  RequestMetadata,
} from '../http/proxy_pool';
import { BodyParser } from '../http/body_parser';
import { equalsOrSubdomain } from '../http/url';
import { RedirectAwareClient } from '../http/redirect/redirect_client';
import { RequestRepository } from './repository';
import { ReplayServer, ParsedReplayUrl } from '../cdx/replay';
import { CdxRepository } from '../cdx/repository';
import { saveRequestToDisk } from './storage';
import { insertRequestTx } from './db';
import { RunRepository } from '../run/repository';
import { resolveContentType, type ContentType } from '../http/content_type';

interface RequestError {
  name?: string;
  code: string;
  message: string;
}

function parseError(err: unknown): RequestError {
  if (err instanceof Error) {
    return {
      name: err.name,
      code: (err as { code?: string }).code ?? 'general',
      message: err.message,
    };
  }
  return {
    code: 'general',
    message: `Invalid error object: ${JSON.stringify(err)}`,
  };
}

export interface DownloadTask {
  runId: string;
  timestamp: number;
  original: string;
  domainName: string;
  normalizedDomain: string;
  outputFolder: string;
  replayBaseUrl: string;
}

export type SuccessfulRedirectResolution = {
  location: string;
  parsedReplayUrl: ParsedReplayUrl;
  isForeignDomain: boolean;
};

export type RedirectResolution =
  | SuccessfulRedirectResolution
  | {
      location?: string;
      error: unknown;
    };

export function isSuccessfulRedirectResolution(
  r: RedirectResolution,
): r is SuccessfulRedirectResolution {
  return !('error' in r);
}

function resolveRedirect(
  client: RedirectAwareClient,
  replayServer: ReplayServer,
  normalizedDomain: string,
): RedirectResolution | undefined {
  let location: string | undefined;
  try {
    location = client.peekNextLocation();
  } catch (error) {
    return {
      error,
    };
  }

  if (location === undefined) return undefined;

  try {
    const parsedReplayUrl = replayServer.parseReplayUrl(location);
    return {
      location,
      parsedReplayUrl,
      isForeignDomain: !equalsOrSubdomain(
        parsedReplayUrl.parsedOriginalUrl.normalizedDomain,
        normalizedDomain,
      ),
    };
  } catch (error) {
    return {
      location,
      error,
    };
  }
}

interface HopResult {
  response: RawResponse;
  bodyParser: BodyParser;
  contentType: ContentType;
  redirectMetadata: RedirectResolution | undefined;
  errors: unknown[];
}

async function processNextRedirectHop(
  client: RedirectAwareClient,
  replayServer: ReplayServer,
  task: DownloadTask,
  requestId: string,
  currentUrl: string,
): Promise<HopResult> {
  const response = await client.fetchNext();

  const errors: unknown[] = [];

  const bodyParser = new BodyParser(response.body);
  try {
    await bodyParser.parse();
  } catch (e) {
    errors.push(e);
  }

  const contentType = resolveContentType(
    response.headers,
    currentUrl,
    bodyParser.isParsed() ? bodyParser.getParsed() : undefined,
  );

  await saveRequestToDisk(
    bodyParser,
    contentType,
    requestId,
    task.outputFolder,
    task.runId,
  );

  const redirectMetadata = resolveRedirect(
    client,
    replayServer,
    task.normalizedDomain,
  );
  if (
    redirectMetadata !== undefined &&
    !isSuccessfulRedirectResolution(redirectMetadata)
  ) {
    errors.push(redirectMetadata.error);
  }

  if (
    redirectMetadata !== undefined &&
    isSuccessfulRedirectResolution(redirectMetadata)
  ) {
    const redirectError = client.canFollowRedirect();
    if (redirectError) {
      errors.push(redirectError);
    }
  }

  if (redirectMetadata === undefined) {
    const error = replayServer.validateReplayResponse(response.headers);
    if (error !== undefined) {
      errors.push(error);
    }
  }

  return { response, bodyParser, contentType, redirectMetadata, errors };
}

export async function downloadEntry(
  db: DB,
  reqRepo: RequestRepository,
  cdxRepo: CdxRepository,
  runRepo: RunRepository,
  task: DownloadTask,
  pool: ProxyPool,
): Promise<boolean> {
  const { runId } = task;
  const replayServer = new ReplayServer(task.replayBaseUrl);
  const client = new RedirectAwareClient(
    replayServer.buildReplayUrl(task.timestamp, task.original),
    pool,
  );

  let currentUrl: string | undefined;
  while ((currentUrl = client.peekNextLocation())) {
    const { original: currentOriginal, timestamp: currentTimestamp } =
      replayServer.parseReplayUrl(currentUrl);
    const requestId = randomUUID();

    let hop: HopResult | undefined;
    let errors: unknown[];
    let requestMetadata: RequestMetadata;
    try {
      hop = await processNextRedirectHop(
        client,
        replayServer,
        task,
        requestId,
        currentUrl,
      );
      errors = hop.errors;
      requestMetadata = hop.response.metadata;
    } catch (err) {
      if (!(err instanceof NetworkFetchError)) {
        throw err;
      }
      errors = [err.cause];
      requestMetadata = err.requestMetadata;
    }

    const { isDuplicateRedirect } = insertRequestTx({
      db,
      reqRepo,
      cdxRepo,
      runRepo,
      requestId,
      runId,
      domainName: task.domainName,
      urlOriginal: currentOriginal,
      urlTimestamp: currentTimestamp,
      response: hop?.response,
      requestMetadata,
      redirectMetadata: hop?.redirectMetadata,
      bodyParser: hop?.bodyParser,
      contentType: hop?.contentType,
      errors: errors.map(parseError),
    });

    if (!hop || hop.errors.length > 0) return false;

    if (isDuplicateRedirect) {
      return true;
    }

    // Follow redirect
    const { redirectMetadata } = hop;
    if (
      redirectMetadata !== undefined &&
      isSuccessfulRedirectResolution(redirectMetadata) &&
      !redirectMetadata.isForeignDomain
    ) {
      continue;
    }

    return true;
  }

  // Unreachable in normal operation — the loop always returns.
  throw new Error('RedirectAwareClient loop exited without a return');
}
