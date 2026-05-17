CREATE TABLE `search` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT,
  `created_at` TEXT NOT NULL DEFAULT (datetime('now')),
  `status` TEXT NOT NULL,
  `file_count` INTEGER NOT NULL,
  `scanned_file_count` INTEGER NOT NULL,
  `error_name` TEXT,
  `error_message` TEXT
);
--> statement-breakpoint
CREATE TABLE `search_condition` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT,
  `search_id` INTEGER NOT NULL REFERENCES search(id),
  `regex` TEXT NOT NULL,
  `not_regex_nearby` TEXT,
  `context_size` INTEGER NOT NULL DEFAULT 64
);
--> statement-breakpoint
CREATE TABLE `search_file` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT,
  `search_id` INTEGER NOT NULL REFERENCES search(id),
  `request_id` TEXT NOT NULL REFERENCES request(id),
  `resource_version_url` TEXT NOT NULL,
  `resource_version_timestamp` INTEGER NOT NULL,
  `match_count` INTEGER NOT NULL DEFAULT 0,
  `context_digest` TEXT NOT NULL,
  `is_duplicate_context_digest` INTEGER NOT NULL DEFAULT 0,
  UNIQUE(`search_id`, `resource_version_url`, `resource_version_timestamp`)
);
--> statement-breakpoint
CREATE TABLE `search_file_error` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT,
  `search_id` INTEGER NOT NULL REFERENCES search(id),
  `request_id` TEXT NOT NULL REFERENCES request(id),
  `resource_version_url` TEXT NOT NULL,
  `resource_version_timestamp` INTEGER NOT NULL,
  `error_name` TEXT NOT NULL,
  `error_message` TEXT NOT NULL,
  UNIQUE(`search_id`, `resource_version_url`, `resource_version_timestamp`)
);
--> statement-breakpoint
CREATE TABLE `search_match` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT,
  `search_file_id` INTEGER NOT NULL REFERENCES search_file(id),
  `search_condition_id` INTEGER NOT NULL REFERENCES search_condition(id),
  `match_offset` INTEGER NOT NULL,
  `match_length` INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE `search_domain` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT,
  `search_id` INTEGER NOT NULL REFERENCES search(id),
  `domain_name` TEXT NOT NULL REFERENCES domain(name),
  UNIQUE(`search_id`, `domain_name`)
);
--> statement-breakpoint
CREATE INDEX `idx_search_file_search_id` ON `search_file`(`search_id`);
--> statement-breakpoint
CREATE INDEX `idx_search_condition_search_id` ON `search_condition`(`search_id`);
--> statement-breakpoint
CREATE INDEX `idx_search_domain_search_id` ON `search_domain`(`search_id`);
--> statement-breakpoint
CREATE INDEX `idx_search_match_file_condition` ON `search_match`(`search_file_id`, `search_condition_id`);
--> statement-breakpoint
CREATE INDEX `idx_request_body_digest_resource_version` ON `request`(`body_digest`, `resource_version_url`, `resource_version_timestamp`);
--> statement-breakpoint
CREATE INDEX `idx_request_html_candidates` ON `request`(`is_successful`, `location`, `mimetype`, `resource_version_url`, `resource_version_timestamp`) WHERE is_successful = 1 AND location IS NULL AND mimetype = 'text/html';
