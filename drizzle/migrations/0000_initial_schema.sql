CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_user_id_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `activity_log` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`hackathon_id` text,
	`action` text NOT NULL,
	`details` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`hackathon_id`) REFERENCES `hackathons`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `activity_user_idx` ON `activity_log` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `app_rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `bookmarks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`hackathon_id` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`hackathon_id`) REFERENCES `hackathons`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bookmarks_user_hackathon_uq` ON `bookmarks` (`user_id`,`hackathon_id`);--> statement-breakpoint
CREATE INDEX `bookmarks_hackathon_idx` ON `bookmarks` (`hackathon_id`);--> statement-breakpoint
CREATE TABLE `collection_items` (
	`collection_id` text NOT NULL,
	`hackathon_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`collection_id`, `hackathon_id`),
	FOREIGN KEY (`collection_id`) REFERENCES `collections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`hackathon_id`) REFERENCES `hackathons`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `collection_items_hackathon_idx` ON `collection_items` (`hackathon_id`);--> statement-breakpoint
CREATE TABLE `collections` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `collections_user_name_uq` ON `collections` (`user_id`,`name`);--> statement-breakpoint
CREATE TABLE `duplicate_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`hackathon_id` text NOT NULL,
	`candidate_id` text NOT NULL,
	`confidence` text NOT NULL,
	`reasons` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`resolved_at` integer,
	`resolved_by_user_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`hackathon_id`) REFERENCES `hackathons`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`candidate_id`) REFERENCES `hackathons`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `duplicate_pair_uq` ON `duplicate_candidates` (`hackathon_id`,`candidate_id`);--> statement-breakpoint
CREATE INDEX `duplicate_status_idx` ON `duplicate_candidates` (`status`);--> statement-breakpoint
CREATE TABLE `hackathon_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`hackathon_id` text NOT NULL,
	`field` text NOT NULL,
	`old_value` text,
	`new_value` text,
	`changed_by` text NOT NULL,
	`changed_by_user_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`hackathon_id`) REFERENCES `hackathons`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `hackathon_changes_hackathon_idx` ON `hackathon_changes` (`hackathon_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `hackathon_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`hackathon_id` text NOT NULL,
	`platform_id` text NOT NULL,
	`external_event_id` text,
	`source_event_url` text NOT NULL,
	`source_registration_url` text,
	`source_updated_at` integer,
	`last_checked_at` integer,
	`metadata` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`hackathon_id`) REFERENCES `hackathons`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`platform_id`) REFERENCES `platforms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hackathon_sources_external_uq` ON `hackathon_sources` (`platform_id`,`external_event_id`);--> statement-breakpoint
CREATE INDEX `hackathon_sources_hackathon_idx` ON `hackathon_sources` (`hackathon_id`);--> statement-breakpoint
CREATE TABLE `hackathon_tags` (
	`hackathon_id` text NOT NULL,
	`tag_id` integer NOT NULL,
	PRIMARY KEY(`hackathon_id`, `tag_id`),
	FOREIGN KEY (`hackathon_id`) REFERENCES `hackathons`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `hackathon_tags_tag_idx` ON `hackathon_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `hackathons` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`normalized_title` text NOT NULL,
	`description` text,
	`organizer` text,
	`primary_platform_id` text NOT NULL,
	`canonical_url` text NOT NULL,
	`canonical_url_key` text NOT NULL,
	`registration_url` text,
	`cover_image_url` text,
	`registration_open_at` integer,
	`registration_deadline_at` integer,
	`event_start_at` integer,
	`event_end_at` integer,
	`event_timezone` text,
	`participation_mode` text,
	`location` text,
	`country` text,
	`prize_amount_minor` integer,
	`prize_currency` text,
	`prize_details` text,
	`team_size_min` integer,
	`team_size_max` integer,
	`participation_fee_minor` integer,
	`participation_fee_currency` text,
	`eligibility_summary` text,
	`eligibility_details` text,
	`is_student_eligible` integer,
	`is_beginner_friendly` integer,
	`is_international` integer,
	`additional_notes` text,
	`source_status` text,
	`internal_status` text DEFAULT 'unverified' NOT NULL,
	`contradictions` text DEFAULT '[]' NOT NULL,
	`last_checked_at` integer,
	`last_verified_at` integer,
	`source_updated_at` integer,
	`created_by_user_id` text,
	`visibility` text DEFAULT 'private' NOT NULL,
	`publication_status` text DEFAULT 'none' NOT NULL,
	`review_note` text,
	`is_demo` integer DEFAULT false NOT NULL,
	`search_text` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`primary_platform_id`) REFERENCES `platforms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `hackathons_deadline_idx` ON `hackathons` (`registration_deadline_at`);--> statement-breakpoint
CREATE INDEX `hackathons_start_idx` ON `hackathons` (`event_start_at`);--> statement-breakpoint
CREATE INDEX `hackathons_platform_idx` ON `hackathons` (`primary_platform_id`);--> statement-breakpoint
CREATE INDEX `hackathons_mode_idx` ON `hackathons` (`participation_mode`);--> statement-breakpoint
CREATE INDEX `hackathons_status_idx` ON `hackathons` (`source_status`,`internal_status`);--> statement-breakpoint
CREATE INDEX `hackathons_visibility_idx` ON `hackathons` (`visibility`,`created_by_user_id`);--> statement-breakpoint
CREATE INDEX `hackathons_url_key_idx` ON `hackathons` (`canonical_url_key`);--> statement-breakpoint
CREATE INDEX `hackathons_title_idx` ON `hackathons` (`normalized_title`);--> statement-breakpoint
CREATE INDEX `hackathons_created_idx` ON `hackathons` (`created_at`);--> statement-breakpoint
CREATE INDEX `hackathons_demo_idx` ON `hackathons` (`is_demo`);--> statement-breakpoint
CREATE INDEX `hackathons_publication_idx` ON `hackathons` (`publication_status`);--> statement-breakpoint
CREATE TABLE `milestones` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`hackathon_id` text,
	`title` text NOT NULL,
	`due_at` integer NOT NULL,
	`notes` text,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`hackathon_id`) REFERENCES `hackathons`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `milestones_user_due_idx` ON `milestones` (`user_id`,`due_at`);--> statement-breakpoint
CREATE TABLE `notification_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`notification_type` text NOT NULL,
	`reminder_interval` text NOT NULL,
	`channel` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`delivery_time` text DEFAULT '09:00' NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_prefs_uq` ON `notification_preferences` (`user_id`,`notification_type`,`reminder_interval`,`channel`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`hackathon_id` text,
	`type` text NOT NULL,
	`channel` text NOT NULL,
	`reminder_interval` text,
	`title` text NOT NULL,
	`message` text NOT NULL,
	`scheduled_at` integer NOT NULL,
	`delivered_at` integer,
	`read_at` integer,
	`deadline_version` integer,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`failure_reason` text,
	`idempotency_key` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`hackathon_id`) REFERENCES `hackathons`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_idempotency_key_unique` ON `notifications` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `notifications_due_idx` ON `notifications` (`status`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `notifications_user_idx` ON `notifications` (`user_id`,`channel`,`status`,`delivered_at`);--> statement-breakpoint
CREATE INDEX `notifications_hackathon_idx` ON `notifications` (`hackathon_id`);--> statement-breakpoint
CREATE TABLE `platforms` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`homepage_url` text NOT NULL,
	`integration_mode` text DEFAULT 'manual' NOT NULL,
	`integration_status` text DEFAULT 'manual_mode' NOT NULL,
	`auto_sync_enabled` integer DEFAULT false NOT NULL,
	`last_attempted_sync_at` integer,
	`last_successful_sync_at` integer,
	`last_sync_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`display_name` text,
	`country` text,
	`timezone` text,
	`experience_level` text,
	`preferred_mode` text DEFAULT 'any' NOT NULL,
	`is_student` integer,
	`interests` text DEFAULT '[]' NOT NULL,
	`show_demo_events` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `rate_limit` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`count` integer NOT NULL,
	`last_request` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rate_limit_key_unique` ON `rate_limit` (`key`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_user_id_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `sync_record_errors` (
	`id` text PRIMARY KEY NOT NULL,
	`sync_run_id` text NOT NULL,
	`platform_id` text NOT NULL,
	`external_event_id` text,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`sync_run_id`) REFERENCES `sync_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sync_record_errors_run_idx` ON `sync_record_errors` (`sync_run_id`);--> statement-breakpoint
CREATE TABLE `sync_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`platform_id` text NOT NULL,
	`trigger` text NOT NULL,
	`triggered_by_user_id` text,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`records_fetched` integer DEFAULT 0 NOT NULL,
	`records_added` integer DEFAULT 0 NOT NULL,
	`records_updated` integer DEFAULT 0 NOT NULL,
	`records_skipped` integer DEFAULT 0 NOT NULL,
	`error_message` text,
	`diagnostics` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`platform_id`) REFERENCES `platforms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sync_runs_platform_idx` ON `sync_runs` (`platform_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`slug` text NOT NULL,
	`label` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_kind_slug_uq` ON `tags` (`kind`,`slug`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`role` text DEFAULT 'user' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `user_hackathon_tracking` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`hackathon_id` text NOT NULL,
	`participation_status` text DEFAULT 'interested' NOT NULL,
	`priority` text DEFAULT 'medium' NOT NULL,
	`personal_notes` text,
	`team_name` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`hackathon_id`) REFERENCES `hackathons`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tracking_user_hackathon_uq` ON `user_hackathon_tracking` (`user_id`,`hackathon_id`);--> statement-breakpoint
CREATE INDEX `tracking_hackathon_idx` ON `user_hackathon_tracking` (`hackathon_id`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);