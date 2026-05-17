CREATE TABLE `reaction_type` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT,
  `label` TEXT NOT NULL,
  `icon` TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reaction` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT,
  `reaction_type_id` INTEGER NOT NULL REFERENCES reaction_type(id),
  `resource_version_url` TEXT NOT NULL,
  `resource_version_timestamp` INTEGER NOT NULL,
  UNIQUE(`reaction_type_id`, `resource_version_url`, `resource_version_timestamp`)
);
--> statement-breakpoint
CREATE INDEX `idx_reaction_url_timestamp_type` ON `reaction`(`resource_version_url`, `resource_version_timestamp`, `reaction_type_id`);
--> statement-breakpoint
INSERT OR IGNORE INTO `reaction_type` (`id`, `label`, `icon`) VALUES (1, 'Like', 'Heart'), (2, 'Review later', 'Calendar');
