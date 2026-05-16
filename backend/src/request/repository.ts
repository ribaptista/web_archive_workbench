import type { Database as DB } from 'better-sqlite3';

export interface InsertRequestParams {
  id: string;
  runId: string;
  resourceVersionUrl: string;
  resourceVersionTimestamp: number;
  statusCode: number | undefined;
  bodyDigest: string | undefined;
  inferredGzip: number | undefined;
  durationMs: number;
  proxyAddress: string | undefined;
  isSuccessful: number;
  mimetype: string | undefined;
  location: string | undefined;
  locationOriginal: string | undefined;
  locationTimestamp: number | undefined;
  encoding: string | undefined;
  encodingSource: string | undefined;
  chardetConfidence: number | undefined;
  isForeignRedirect: number | undefined;
  redirectDomain: string | undefined;
  redirectNormalizedDomain: string | undefined;
}

export interface RequestCdxInfoRow {
  original: string;
  timestamp: string;
  domain: string;
}

export class RequestRepository {
  constructor(private readonly db: DB) {}

  insertRequest(params: InsertRequestParams): { changes: number } {
    return this.db
      .prepare(
        `INSERT INTO request (
           id, run_id,
           resource_version_url, resource_version_timestamp,
           status_code, body_digest, inferred_gzip,
           duration_ms, proxy_address, is_successful,
           mimetype, location, location_original, location_timestamp,
           encoding, encoding_source, chardet_confidence,
           is_foreign_redirect, redirect_domain, redirect_normalized_domain
         )
         VALUES (?, ?,
                ?, ?,
                ?, ?, ?,
                ?, ?, ?,
                ?, ?, ?, ?,
                ?, ?, ?,
                ?, ?, ?)`,
      )
      .run(
        params.id,
        params.runId,
        params.resourceVersionUrl,
        params.resourceVersionTimestamp,
        params.statusCode,
        params.bodyDigest,
        params.inferredGzip,
        params.durationMs,
        params.proxyAddress,
        params.isSuccessful,
        params.mimetype,
        params.location,
        params.locationOriginal,
        params.locationTimestamp,
        params.encoding,
        params.encodingSource,
        params.chardetConfidence,
        params.isForeignRedirect,
        params.redirectDomain,
        params.redirectNormalizedDomain,
      ) as { changes: number };
  }

  insertError(
    requestId: string,
    name: string,
    code: string,
    message: string,
  ): void {
    this.db
      .prepare(
        `INSERT INTO request_errors (request_id, error_name, error_code, error_message)
         VALUES (?, ?, ?, ?)`,
      )
      .run(requestId, name, code, message);
  }

  insertHeader(requestId: string, name: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO response_header (request_id, header_name, header_value)
         VALUES (?, ?, ?)`,
      )
      .run(requestId, name, value);
  }

  /** Fetches the CDX-derived info for a request — used by search results. */
  findCdxInfoByRequestId(requestId: string): RequestCdxInfoRow | undefined {
    return this.db
      .prepare<[string], RequestCdxInfoRow>(
        `SELECT r.resource_version_url AS original,
                r.resource_version_timestamp AS timestamp,
                rvs.domain_name AS domain
         FROM request r
         JOIN resource_version_source rvs
           ON rvs.url = r.resource_version_url
          AND rvs.timestamp = r.resource_version_timestamp
         WHERE r.id = ?
         LIMIT 1`,
      )
      .get(requestId);
  }
}
