import {
  sqliteTable,
  text,
  integer,
  real,
  primaryKey,
  foreignKey,
  unique,
  index,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const run = sqliteTable('run', {
  id: text('id').primaryKey(),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
  newEntryCount: integer('new_entry_count').notNull().default(0),
  entryTotalCount: integer('entry_total_count').notNull().default(0),
  successfulEntryCount: integer('successful_entry_count').notNull().default(0),
  erroredEntryCount: integer('errored_entry_count').notNull().default(0),
});

export const runArgs = sqliteTable('run_args', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runId: text('run_id')
    .notNull()
    .references(() => run.id),
  argName: text('arg_name').notNull(),
  argValue: text('arg_value').notNull(),
});

export const domain = sqliteTable('domain', {
  name: text('name').primaryKey(),
  runId: text('run_id')
    .notNull()
    .references(() => run.id),
  normalizedName: text('normalized_name').notNull(),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
  entryTotalCount: integer('entry_total_count').notNull().default(0),
  successfulEntryCount: integer('successful_entry_count').notNull().default(0),
  erroredEntryCount: integer('errored_entry_count').notNull().default(0),
  pendingEntryCount: integer('pending_entry_count').notNull().default(0),
});

export const cdxSource = sqliteTable('cdx_source', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  baseUrl: text('base_url').notNull().unique(),
  replayBaseUrl: text('replay_base_url').notNull(),
});

export const cdxEntry = sqliteTable(
  'cdx_entry',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    runId: text('run_id')
      .notNull()
      .references(() => run.id),
    domainName: text('domain_name')
      .notNull()
      .references(() => domain.name),
    line: integer('line').notNull(),
    urlKey: text('url_key'),
    timestamp: integer('timestamp'),
    original: text('original'),
    mimetype: text('mimetype'),
    statusCode: integer('status_code'),
    digest: text('digest'),
    length: integer('length'),
    raw: text('raw').notNull(),
    isValid: integer('is_valid').notNull(),
    cdxSourceId: integer('cdx_source_id')
      .notNull()
      .references(() => cdxSource.id),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    unique().on(table.cdxSourceId, table.raw),
    index('idx_cdx_entry_raw').on(table.raw),
    index('idx_cdx_entry_run_id').on(table.runId),
  ],
);

export const treeNode = sqliteTable(
  'tree_node',
  {
    path: text('path').primaryKey(),
    level: integer('level').notNull(),
  },
  (table) => [unique().on(table.path, table.level)],
);

export const resource = sqliteTable('resource', {
  url: text('url').primaryKey(),
  normalizedUrl: text('normalized_url').references(() => treeNode.path, {
    onDelete: 'cascade',
  }),
});

export const resourceVersion = sqliteTable(
  'resource_version',
  {
    url: text('url').notNull(),
    timestamp: integer('timestamp').notNull(),
    successfulRequestId: text('successful_request_id'),
    lastErroredRequestId: text('last_errored_request_id'),
  },
  (table) => [
    primaryKey({ columns: [table.url, table.timestamp] }),
    foreignKey({
      columns: [table.url],
      foreignColumns: [resource.url],
    }),
    index('idx_resource_version_successful_request_id').on(
      table.successfulRequestId,
    ),
  ],
);

export const resourceVersionSource = sqliteTable(
  'resource_version_source',
  {
    url: text('url').notNull(),
    timestamp: integer('timestamp').notNull(),
    domainName: text('domain_name')
      .notNull()
      .references(() => domain.name),
  },
  (table) => [
    foreignKey({
      columns: [table.url, table.timestamp],

      foreignColumns: [resourceVersion.url, resourceVersion.timestamp],
    }),
    unique().on(table.url, table.timestamp, table.domainName),
    index('idx_resource_version_source_domain_name').on(table.domainName),
    index('idx_resource_version_source_domain_name_url_timestamp').on(
      table.domainName,
      table.url,
      table.timestamp,
    ),
  ],
);

export const request = sqliteTable(
  'request',
  {
    id: text('id').primaryKey(),
    runId: text('run_id')
      .notNull()
      .references(() => run.id),
    resourceVersionUrl: text('resource_version_url').notNull(),
    resourceVersionTimestamp: integer('resource_version_timestamp').notNull(),
    statusCode: integer('status_code'),
    mimetype: text('mimetype'),
    location: text('location'),
    locationOriginal: text('location_original'),
    locationTimestamp: integer('location_timestamp'),
    bodyDigest: text('body_digest'),
    inferredGzip: integer('inferred_gzip'),
    durationMs: integer('duration_ms').notNull(),
    proxyAddress: text('proxy_address'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    isSuccessful: integer('is_successful').notNull(),
    encoding: text('encoding'),
    encodingSource: text('encoding_source'),
    chardetConfidence: real('chardet_confidence'),
    isForeignRedirect: integer('is_foreign_redirect'),
    redirectDomain: text('redirect_domain'),
    redirectNormalizedDomain: text('redirect_normalized_domain'),
  },
  (table) => [
    foreignKey({
      columns: [table.resourceVersionUrl, table.resourceVersionTimestamp],
      foreignColumns: [resourceVersion.url, resourceVersion.timestamp],
    }),
    index('idx_request_run_id_id').on(table.runId, table.id),
    index('idx_request_resource_version').on(
      table.resourceVersionUrl,
      table.resourceVersionTimestamp,
    ),
    index('idx_request_run_id_resource_version_is_successful').on(
      table.runId,
      table.resourceVersionUrl,
      table.resourceVersionTimestamp,
      table.isSuccessful,
    ),
    index('idx_request_mimetype_location_body_digest').on(
      table.mimetype,
      table.location,
      table.bodyDigest,
    ),
    index('idx_request_body_digest_resource_version').on(
      table.bodyDigest,
      table.resourceVersionUrl,
      table.resourceVersionTimestamp,
    ),
  ],
);

export const requestErrors = sqliteTable(
  'request_errors',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    requestId: text('request_id')
      .notNull()
      .references(() => request.id),
    errorName: text('error_name').notNull(),
    errorCode: text('error_code').notNull(),
    errorMessage: text('error_message').notNull(),
  },
  (table) => [
    index('idx_request_errors_request_id').on(table.requestId),
    index('idx_request_errors_request_id_error_name_error_code').on(
      table.requestId,
      table.errorName,
      table.errorCode,
    ),
  ],
);

export const responseHeader = sqliteTable('response_header', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  requestId: text('request_id')
    .notNull()
    .references(() => request.id),
  headerName: text('header_name').notNull(),
  headerValue: text('header_value').notNull(),
});

export const runDomainStats = sqliteTable(
  'run_domain_stats',
  {
    runId: text('run_id')
      .notNull()
      .references(() => run.id),
    domainName: text('domain_name')
      .notNull()
      .references(() => domain.name),
    attemptedEntryCount: integer('attempted_entry_count').notNull().default(0),
    successfulEntryCount: integer('successful_entry_count')
      .notNull()
      .default(0),
    erroredEntryCount: integer('errored_entry_count').notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.runId, table.domainName] })],
);

export const runErrorTypeStats = sqliteTable(
  'run_error_type_stats',
  {
    runId: text('run_id')
      .notNull()
      .references(() => run.id),
    domainName: text('domain_name')
      .notNull()
      .references(() => domain.name),
    errorName: text('error_name').notNull(),
    errorCode: text('error_code').notNull(),
    count: integer('count').notNull().default(0),
  },
  (table) => [
    primaryKey({
      columns: [
        table.runId,
        table.domainName,
        table.errorName,
        table.errorCode,
      ],
    }),
  ],
);

// ---------------------------------------------------------------------------
// Admin / search tables (0001_search migration)
// ---------------------------------------------------------------------------

export const search = sqliteTable('search', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
  status: text('status').notNull(),
  fileCount: integer('file_count').notNull(),
  scannedFileCount: integer('scanned_file_count').notNull(),
  errorName: text('error_name'),
  errorMessage: text('error_message'),
});

export const searchCondition = sqliteTable(
  'search_condition',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    searchId: integer('search_id')
      .notNull()
      .references(() => search.id),
    regex: text('regex').notNull(),
    notRegexNearby: text('not_regex_nearby'),
    contextSize: integer('context_size').notNull().default(64),
  },
  (table) => [index('idx_search_condition_search_id').on(table.searchId)],
);

export const searchFile = sqliteTable(
  'search_file',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    searchId: integer('search_id')
      .notNull()
      .references(() => search.id),
    requestId: text('request_id')
      .notNull()
      .references(() => request.id),
    resourceVersionUrl: text('resource_version_url').notNull(),
    resourceVersionTimestamp: integer('resource_version_timestamp').notNull(),
    matchCount: integer('match_count').notNull().default(0),
    contextDigest: text('context_digest').notNull(),
    isDuplicateContextDigest: integer('is_duplicate_context_digest')
      .notNull()
      .default(0),
  },
  (table) => [
    index('idx_search_file_search_id').on(table.searchId),
    unique().on(
      table.searchId,
      table.resourceVersionUrl,
      table.resourceVersionTimestamp,
    ),
  ],
);

export const searchFileError = sqliteTable(
  'search_file_error',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    searchId: integer('search_id')
      .notNull()
      .references(() => search.id),
    requestId: text('request_id')
      .notNull()
      .references(() => request.id),
    resourceVersionUrl: text('resource_version_url').notNull(),
    resourceVersionTimestamp: integer('resource_version_timestamp').notNull(),
    errorName: text('error_name').notNull(),
    errorMessage: text('error_message').notNull(),
  },
  (table) => [
    unique().on(
      table.searchId,
      table.resourceVersionUrl,
      table.resourceVersionTimestamp,
    ),
  ],
);

export const searchMatch = sqliteTable(
  'search_match',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    searchFileId: integer('search_file_id')
      .notNull()
      .references(() => searchFile.id),
    searchConditionId: integer('search_condition_id')
      .notNull()
      .references(() => searchCondition.id),
    matchOffset: integer('match_offset').notNull(),
    matchLength: integer('match_length').notNull(),
  },
  (table) => [
    index('idx_search_match_file_condition').on(
      table.searchFileId,
      table.searchConditionId,
    ),
  ],
);

export const searchDomain = sqliteTable(
  'search_domain',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    searchId: integer('search_id')
      .notNull()
      .references(() => search.id),
    name: text('name')
      .notNull()
      .references(() => domain.name),
  },
  (table) => [
    index('idx_search_domain_search_id').on(table.searchId),
    unique().on(table.searchId, table.name),
  ],
);

export const reactionType = sqliteTable('reaction_type', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  label: text('label').notNull(),
  icon: text('icon').notNull(),
});

export const reaction = sqliteTable(
  'reaction',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    reactionTypeId: integer('reaction_type_id')
      .notNull()
      .references(() => reactionType.id),
    resourceVersionUrl: text('resource_version_url').notNull(),
    resourceVersionTimestamp: integer('resource_version_timestamp').notNull(),
  },
  (table) => [
    unique().on(
      table.reactionTypeId,
      table.resourceVersionUrl,
      table.resourceVersionTimestamp,
    ),
    index('idx_reaction_url_timestamp_type').on(
      table.resourceVersionUrl,
      table.resourceVersionTimestamp,
      table.reactionTypeId,
    ),
  ],
);
