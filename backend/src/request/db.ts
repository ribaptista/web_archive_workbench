import type { DB } from '../db/conn';
import { CdxRepository } from '../cdx/repository';
import { RequestRepository } from './repository';
import { RunRepository } from '../run/repository';
import {
  RedirectResolution,
  SuccessfulRedirectResolution,
  isSuccessfulRedirectResolution,
} from './downloader';
import { BodyParser } from '../http/body_parser';
import type { IncomingHttpHeaders } from '../http/types';
import { RawResponse, RequestMetadata } from '../http/agent_pool';
import { type ContentType } from '../http/content_type';

export interface InsertRequestTxParams {
  db: DB;
  reqRepo: RequestRepository;
  cdxRepo: CdxRepository;
  runRepo: RunRepository;
  requestId: string;
  runId: string;
  domainName: string;
  urlOriginal: string;
  urlTimestamp: number;
  response: RawResponse | undefined;
  requestMetadata: RequestMetadata;
  redirectMetadata: RedirectResolution | undefined;
  bodyParser: BodyParser | undefined;
  contentType: ContentType | undefined;
  errors: { name?: string; code: string; message: string }[];
}

export interface InsertRequestTxResult {
  isDuplicateRedirect: boolean;
}

function updateStats(
  runRepo: RunRepository,
  runId: string,
  domainName: string,
  isSuccessful: boolean,
): void {
  const successfulCount = isSuccessful ? 1 : 0;
  const erroredCount = isSuccessful ? 0 : 1;
  runRepo.incrementStats(successfulCount, erroredCount, runId);
  runRepo.upsertDomainStats(runId, domainName, successfulCount, erroredCount);
}

function insertErrors(
  reqRepo: RequestRepository,
  runRepo: RunRepository,
  requestId: string,
  runId: string,
  domainName: string,
  errors: { name?: string; code: string; message: string }[],
): void {
  for (const { name = '', code, message } of errors) {
    reqRepo.insertError(requestId, name, code, message);
    runRepo.upsertErrorTypeStats(runId, domainName, name, code);
  }
}

function insertHeaders(
  reqRepo: RequestRepository,
  requestId: string,
  responseHeaders: IncomingHttpHeaders,
): void {
  for (const [name, value] of Object.entries(responseHeaders)) {
    if (value === undefined) continue;
    const values = Array.isArray(value) ? value : [value];
    for (const v of values) {
      reqRepo.insertHeader(requestId, name, v);
    }
  }
}

// Returns true if the resource version already existed (duplicate redirect).
function insertResourceVersionIfNotExists(
  cdxRepo: CdxRepository,
  domainName: string,
  normalizedUrl: string,
  originalUrl: string,
  timestamp: number,
): boolean {
  cdxRepo.insertTreeNodePaths([normalizedUrl]);
  cdxRepo.insertOrIgnoreResource(originalUrl, normalizedUrl);
  const r = cdxRepo.insertOrIgnoreResourceVersion(originalUrl, timestamp);
  const isDuplicate = r.changes === 0;
  const rvsr = cdxRepo.insertOrIgnoreResourceVersionSource(
    originalUrl,
    timestamp,
    domainName,
  );
  if (rvsr.changes > 0) {
    cdxRepo.incrementDomainEntryCount(domainName);
  }
  return isDuplicate;
}

function buildAndInsertRequest(
  reqRepo: RequestRepository,
  requestId: string,
  runId: string,
  urlOriginal: string,
  urlTimestamp: number,
  response: RawResponse | undefined,
  requestMetadata: RequestMetadata,
  isSuccessful: boolean,
  bodyParser: BodyParser | undefined,
  contentType: ContentType | undefined,
  redirectMetadata: RedirectResolution | undefined,
): void {
  const fullRedirect: SuccessfulRedirectResolution | undefined =
    redirectMetadata !== undefined &&
    isSuccessfulRedirectResolution(redirectMetadata)
      ? redirectMetadata
      : undefined;
  reqRepo.insertRequest({
    id: requestId,
    runId,
    resourceVersionUrl: urlOriginal,
    resourceVersionTimestamp: urlTimestamp,
    statusCode: response?.statusCode,
    bodyDigest: bodyParser?.isParsed() ? bodyParser.getBodyDigest() : undefined,
    inferredGzip: bodyParser?.getCompressionFormat() === 'gzip' ? 1 : undefined,
    durationMs: requestMetadata.durationMs,
    proxyAddress: requestMetadata.proxyAddress ?? undefined,
    isSuccessful: isSuccessful ? 1 : 0,
    mimetype: bodyParser !== undefined ? contentType?.mimeType : undefined,
    location: redirectMetadata?.location,
    locationOriginal: fullRedirect?.parsedReplayUrl.original,
    locationTimestamp: fullRedirect?.parsedReplayUrl.timestamp,
    encoding: contentType?.encoding?.encoding,
    encodingSource: contentType?.encoding?.source,
    chardetConfidence: contentType?.encoding?.chardetConfidence ?? undefined,
    isForeignRedirect:
      fullRedirect !== undefined
        ? fullRedirect.isForeignDomain
          ? 1
          : 0
        : undefined,
    redirectDomain: fullRedirect?.parsedReplayUrl.parsedOriginalUrl.domain,
    redirectNormalizedDomain:
      fullRedirect?.parsedReplayUrl.parsedOriginalUrl.normalizedDomain,
  });
}

export function insertRequestTx(
  params: InsertRequestTxParams,
): InsertRequestTxResult {
  const {
    db,
    reqRepo,
    cdxRepo,
    runRepo,
    requestId,
    runId,
    domainName,
    urlOriginal,
    urlTimestamp,
    requestMetadata,
    redirectMetadata,
    response,
    bodyParser,
    contentType,
    errors,
  } = params;

  const isSuccessful = errors.length === 0;
  let isDuplicateRedirect = false;

  db.transaction(() => {
    buildAndInsertRequest(
      reqRepo,
      requestId,
      runId,
      urlOriginal,
      urlTimestamp,
      response,
      requestMetadata,
      isSuccessful,
      bodyParser,
      contentType,
      redirectMetadata,
    );

    updateStats(runRepo, runId, domainName, isSuccessful);
    insertErrors(reqRepo, runRepo, requestId, runId, domainName, errors);
    insertHeaders(reqRepo, requestId, response?.headers ?? {});

    if (
      isSuccessful &&
      redirectMetadata !== undefined &&
      isSuccessfulRedirectResolution(redirectMetadata) &&
      !redirectMetadata.isForeignDomain
    ) {
      isDuplicateRedirect = insertResourceVersionIfNotExists(
        cdxRepo,
        domainName,
        redirectMetadata.parsedReplayUrl.parsedOriginalUrl.normalizedUrl,
        redirectMetadata.parsedReplayUrl.original,
        redirectMetadata.parsedReplayUrl.timestamp,
      );
    }

    updateResourceVersionResult(
      cdxRepo,
      urlOriginal,
      urlTimestamp,
      requestId,
      isSuccessful,
    );
  })();

  return { isDuplicateRedirect };
}

function updateResourceVersionResult(
  cdxRepo: CdxRepository,
  urlOriginal: string,
  urlTimestamp: number,
  requestId: string,
  isSuccessful: boolean,
): void {
  if (isSuccessful) {
    applySuccessfulResourceVersionResult(
      cdxRepo,
      urlOriginal,
      urlTimestamp,
      requestId,
    );
    return;
  }

  applyErroredResourceVersionResult(
    cdxRepo,
    urlOriginal,
    urlTimestamp,
    requestId,
  );
}

export interface ResourceVersionState {
  successfulRequestId: string | null;
  lastErroredRequestId: string | null;
  status: 'pending' | 'errored' | 'successful';
}

export function getResourceVersionState(
  cdxRepo: CdxRepository,
  urlOriginal: string,
  urlTimestamp: number,
): ResourceVersionState {
  const row = cdxRepo.getResourceVersionState(urlOriginal, urlTimestamp);
  if (!row)
    throw new Error(
      `resource_version not found: ${urlOriginal} @ ${urlTimestamp}`,
    );
  const {
    successful_request_id: successfulRequestId,
    last_errored_request_id: lastErroredRequestId,
  } = row;
  if (successfulRequestId != null && lastErroredRequestId != null)
    throw new Error(
      `Refreshing a previously successful resource is not implemented: ${urlOriginal} @ ${urlTimestamp}`,
    );
  const status: ResourceVersionState['status'] =
    successfulRequestId == null && lastErroredRequestId == null
      ? 'pending'
      : successfulRequestId == null
        ? 'errored'
        : 'successful';
  return { successfulRequestId, lastErroredRequestId, status };
}

// Returns true if this is the first successful download of the resource
// Uses optimistic locking: if .changes === 0, another worker won the race.
export function applySuccessfulResourceVersionResult(
  cdxRepo: CdxRepository,
  urlOriginal: string,
  urlTimestamp: number,
  requestId: string,
): boolean {
  const { successfulRequestId, lastErroredRequestId, status } =
    getResourceVersionState(cdxRepo, urlOriginal, urlTimestamp);
  // Treat an already-successful resource as a concurrent winner — don't
  // overwrite the existing successful_request_id or touch any counters.
  if (status === 'successful') return false;
  const r = cdxRepo.setSuccessfulRequest(
    requestId,
    urlOriginal,
    urlTimestamp,
    successfulRequestId,
    lastErroredRequestId,
  );
  if (r.changes === 0) return false; // lost race
  switch (status) {
    case 'pending':
      cdxRepo.updateDomainCounters(1, 0, -1, urlOriginal, urlTimestamp);
      return true;
    case 'errored':
      cdxRepo.updateDomainCounters(1, -1, 0, urlOriginal, urlTimestamp);
      return true;
  }
}

// Uses optimistic locking: if .changes === 0, another worker won the race.
export function applyErroredResourceVersionResult(
  cdxRepo: CdxRepository,
  urlOriginal: string,
  urlTimestamp: number,
  requestId: string,
): void {
  const { successfulRequestId, lastErroredRequestId, status } =
    getResourceVersionState(cdxRepo, urlOriginal, urlTimestamp);
  // Treat an already-successful resource as a concurrent winner — don't
  // overwrite the existing successful_request_id or touch any counters.
  if (status === 'successful') return;
  const r = cdxRepo.setLastErroredRequest(
    requestId,
    urlOriginal,
    urlTimestamp,
    successfulRequestId,
    lastErroredRequestId,
  );
  if (r.changes === 0) return; // lost race
  switch (status) {
    case 'pending':
      cdxRepo.updateDomainCounters(0, 1, -1, urlOriginal, urlTimestamp);
      break;
    // errored    → no counter change (already in errored bucket)
  }
}
