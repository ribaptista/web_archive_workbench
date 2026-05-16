import type { DB } from '../db/conn';

export interface RequestRow {
  id: string;
  status_code: number;
  mimetype: string;
  is_successful: number;
  resource_version_url: string;
  resource_version_timestamp: number;
  encoding: string | null;
  body_digest: string;
  location: string | null;
  location_original: string | null;
  location_timestamp: number | null;
  is_foreign_redirect: number | null;
}

export interface ResourceVersionRow {
  url: string;
  timestamp: number;
  successful_request_id: string | null;
  last_errored_request_id: string | null;
}

export class TestRepository {
  constructor(private readonly db: DB) {}

  getFirstRequest(): RequestRow | undefined {
    return this.db
      .prepare<[], RequestRow>(`SELECT * FROM request LIMIT 1`)
      .get();
  }

  getRequestById(id: string): RequestRow | undefined {
    return this.db
      .prepare<[string], RequestRow>(`SELECT * FROM request WHERE id = ?`)
      .get(id);
  }

  getResourceVersion(
    url: string,
    timestamp: number,
  ): ResourceVersionRow | undefined {
    return this.db
      .prepare<
        [string, number],
        ResourceVersionRow
      >(`SELECT * FROM resource_version WHERE url = ? AND timestamp = ?`)
      .get(url, timestamp);
  }

  countRequestErrors(requestId: string): number {
    return (
      this.db
        .prepare<
          [string],
          { n: number }
        >(`SELECT COUNT(*) AS n FROM request_errors WHERE request_id = ?`)
        .get(requestId)?.n ?? 0
    );
  }
}
