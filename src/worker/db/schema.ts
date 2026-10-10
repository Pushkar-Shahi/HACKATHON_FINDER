// Drizzle schema for Cloudflare D1 (SQLite dialect).
//
// Conventions:
//  - Text primary keys generated with crypto.randomUUID().
//  - All instants are stored as INTEGER epoch milliseconds in UTC
//    (Drizzle "timestamp_ms" mode maps them to JS Date objects).
//  - Money is stored as INTEGER minor units (cents/paise) plus an ISO 4217 code.
//  - Nullable columns mean "not known" — the app never back-fills guesses.
//
// Migrations are generated with `npm run db:generate` into drizzle/migrations
// and applied with Wrangler (`npm run db:migrate:local|remote`).
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const id = () =>
	text("id")
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID());
const createdAt = () =>
	integer("created_at", { mode: "timestamp_ms" })
		.notNull()
		.$defaultFn(() => new Date());
const updatedAt = () =>
	integer("updated_at", { mode: "timestamp_ms" })
		.notNull()
		.$defaultFn(() => new Date())
		.$onUpdateFn(() => new Date());
const ts = (name: string) => integer(name, { mode: "timestamp_ms" });
const bool = (name: string) => integer(name, { mode: "boolean" });

// ---------------------------------------------------------------------------
// Better Auth tables (names and fields follow Better Auth's core schema).
// `role` is an additional field declared with `input: false` in the auth
// config, so it can never be set through sign-up or profile endpoints.
// ---------------------------------------------------------------------------

export const user = sqliteTable("user", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	email: text("email").notNull().unique(),
	emailVerified: bool("email_verified").notNull().default(false),
	image: text("image"),
	role: text("role").notNull().default("user"),
	createdAt: ts("created_at").notNull(),
	updatedAt: ts("updated_at").notNull(),
});

export const session = sqliteTable(
	"session",
	{
		id: text("id").primaryKey(),
		expiresAt: ts("expires_at").notNull(),
		token: text("token").notNull().unique(),
		createdAt: ts("created_at").notNull(),
		updatedAt: ts("updated_at").notNull(),
		ipAddress: text("ip_address"),
		userAgent: text("user_agent"),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
	},
	(t) => [index("session_user_id_idx").on(t.userId)],
);

export const account = sqliteTable(
	"account",
	{
		id: text("id").primaryKey(),
		accountId: text("account_id").notNull(),
		providerId: text("provider_id").notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		accessToken: text("access_token"),
		refreshToken: text("refresh_token"),
		idToken: text("id_token"),
		accessTokenExpiresAt: ts("access_token_expires_at"),
		refreshTokenExpiresAt: ts("refresh_token_expires_at"),
		scope: text("scope"),
		password: text("password"),
		createdAt: ts("created_at").notNull(),
		updatedAt: ts("updated_at").notNull(),
	},
	(t) => [index("account_user_id_idx").on(t.userId)],
);

export const verification = sqliteTable(
	"verification",
	{
		id: text("id").primaryKey(),
		identifier: text("identifier").notNull(),
		value: text("value").notNull(),
		expiresAt: ts("expires_at").notNull(),
		createdAt: ts("created_at").notNull(),
		updatedAt: ts("updated_at").notNull(),
	},
	(t) => [index("verification_identifier_idx").on(t.identifier)],
);

/** Better Auth's database-backed rate limiter (sign-in, sign-up, password reset). */
export const rateLimit = sqliteTable("rate_limit", {
	id: text("id").primaryKey(),
	key: text("key").notNull().unique(),
	count: integer("count").notNull(),
	lastRequest: integer("last_request").notNull(),
});

export const authSchema = { user, session, account, verification, rateLimit };

// ---------------------------------------------------------------------------
// Application tables
// ---------------------------------------------------------------------------

export const profiles = sqliteTable("profiles", {
	userId: text("user_id")
		.primaryKey()
		.references(() => user.id, { onDelete: "cascade" }),
	displayName: text("display_name"),
	country: text("country"),
	timezone: text("timezone"),
	experienceLevel: text("experience_level"),
	preferredMode: text("preferred_mode").notNull().default("any"),
	isStudent: bool("is_student"),
	/** JSON array of topic ids, e.g. ["ai","ml"]. */
	interests: text("interests").notNull().default("[]"),
	showDemoEvents: bool("show_demo_events").notNull().default(true),
	createdAt: createdAt(),
	updatedAt: updatedAt(),
});

/** One row per external platform. Secrets never live here — only status. */
export const platforms = sqliteTable("platforms", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	homepageUrl: text("homepage_url").notNull(),
	integrationMode: text("integration_mode").notNull().default("manual"),
	integrationStatus: text("integration_status").notNull().default("manual_mode"),
	autoSyncEnabled: bool("auto_sync_enabled").notNull().default(false),
	lastAttemptedSyncAt: ts("last_attempted_sync_at"),
	lastSuccessfulSyncAt: ts("last_successful_sync_at"),
	/** Sanitized, non-sensitive error summary from the most recent failed attempt. */
	lastSyncError: text("last_sync_error"),
	createdAt: createdAt(),
	updatedAt: updatedAt(),
});

export const hackathons = sqliteTable(
	"hackathons",
	{
		id: id(),
		title: text("title").notNull(),
		normalizedTitle: text("normalized_title").notNull(),
		description: text("description"),
		organizer: text("organizer"),
		primaryPlatformId: text("primary_platform_id")
			.notNull()
			.references(() => platforms.id),
		canonicalUrl: text("canonical_url").notNull(),
		/** Normalized form of canonical_url used for duplicate detection. */
		canonicalUrlKey: text("canonical_url_key").notNull(),
		registrationUrl: text("registration_url"),
		coverImageUrl: text("cover_image_url"),
		registrationOpenAt: ts("registration_open_at"),
		registrationDeadlineAt: ts("registration_deadline_at"),
		eventStartAt: ts("event_start_at"),
		eventEndAt: ts("event_end_at"),
		eventTimezone: text("event_timezone"),
		participationMode: text("participation_mode"),
		location: text("location"),
		country: text("country"),
		prizeAmountMinor: integer("prize_amount_minor"),
		prizeCurrency: text("prize_currency"),
		prizeDetails: text("prize_details"),
		teamSizeMin: integer("team_size_min"),
		teamSizeMax: integer("team_size_max"),
		participationFeeMinor: integer("participation_fee_minor"),
		participationFeeCurrency: text("participation_fee_currency"),
		eligibilitySummary: text("eligibility_summary"),
		eligibilityDetails: text("eligibility_details"),
		/** Tri-state eligibility flags: 1 = stated yes, 0 = stated no, NULL = not stated. */
		isStudentEligible: bool("is_student_eligible"),
		isBeginnerFriendly: bool("is_beginner_friendly"),
		isInternational: bool("is_international"),
		additionalNotes: text("additional_notes"),
		/** Status explicitly reported by the source/owner: open | closed | cancelled. */
		sourceStatus: text("source_status"),
		/** Data quality: verified | unverified | needs_review. */
		internalStatus: text("internal_status").notNull().default("unverified"),
		/** JSON array of human-readable contradiction descriptions. */
		contradictions: text("contradictions").notNull().default("[]"),
		lastCheckedAt: ts("last_checked_at"),
		lastVerifiedAt: ts("last_verified_at"),
		sourceUpdatedAt: ts("source_updated_at"),
		createdByUserId: text("created_by_user_id").references(() => user.id, { onDelete: "set null" }),
		/** public = shared discovery feed; private = visible only to its creator. */
		visibility: text("visibility").notNull().default("private"),
		/** Owner-requested publication into the shared feed: none | pending | approved | rejected. */
		publicationStatus: text("publication_status").notNull().default("none"),
		reviewNote: text("review_note"),
		isDemo: bool("is_demo").notNull().default(false),
		/** Lower-cased concatenation of searchable fields (title, organizer, tags, ...). */
		searchText: text("search_text").notNull().default(""),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		index("hackathons_deadline_idx").on(t.registrationDeadlineAt),
		index("hackathons_start_idx").on(t.eventStartAt),
		index("hackathons_platform_idx").on(t.primaryPlatformId),
		index("hackathons_mode_idx").on(t.participationMode),
		index("hackathons_status_idx").on(t.sourceStatus, t.internalStatus),
		index("hackathons_visibility_idx").on(t.visibility, t.createdByUserId),
		index("hackathons_url_key_idx").on(t.canonicalUrlKey),
		index("hackathons_title_idx").on(t.normalizedTitle),
		index("hackathons_created_idx").on(t.createdAt),
		index("hackathons_demo_idx").on(t.isDemo),
		index("hackathons_publication_idx").on(t.publicationStatus),
	],
);

/** Source attribution. One hackathon can legitimately be listed on several platforms. */
export const hackathonSources = sqliteTable(
	"hackathon_sources",
	{
		id: id(),
		hackathonId: text("hackathon_id")
			.notNull()
			.references(() => hackathons.id, { onDelete: "cascade" }),
		platformId: text("platform_id")
			.notNull()
			.references(() => platforms.id),
		externalEventId: text("external_event_id"),
		sourceEventUrl: text("source_event_url").notNull(),
		sourceRegistrationUrl: text("source_registration_url"),
		sourceUpdatedAt: ts("source_updated_at"),
		lastCheckedAt: ts("last_checked_at"),
		/** Small JSON object of permitted, non-sensitive provider metadata. */
		metadata: text("metadata"),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		uniqueIndex("hackathon_sources_external_uq").on(t.platformId, t.externalEventId),
		index("hackathon_sources_hackathon_idx").on(t.hackathonId),
	],
);

export const tags = sqliteTable(
	"tags",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		/** topic (fixed taxonomy) | technology (free-form, normalized) */
		kind: text("kind").notNull(),
		slug: text("slug").notNull(),
		label: text("label").notNull(),
	},
	(t) => [uniqueIndex("tags_kind_slug_uq").on(t.kind, t.slug)],
);

export const hackathonTags = sqliteTable(
	"hackathon_tags",
	{
		hackathonId: text("hackathon_id")
			.notNull()
			.references(() => hackathons.id, { onDelete: "cascade" }),
		tagId: integer("tag_id")
			.notNull()
			.references(() => tags.id, { onDelete: "cascade" }),
	},
	(t) => [primaryKey({ columns: [t.hackathonId, t.tagId] }), index("hackathon_tags_tag_idx").on(t.tagId)],
);

/** Audit trail of important date changes (used for change notifications and review). */
export const hackathonChanges = sqliteTable(
	"hackathon_changes",
	{
		id: id(),
		hackathonId: text("hackathon_id")
			.notNull()
			.references(() => hackathons.id, { onDelete: "cascade" }),
		field: text("field").notNull(),
		oldValue: text("old_value"),
		newValue: text("new_value"),
		/** sync | admin | owner */
		changedBy: text("changed_by").notNull(),
		changedByUserId: text("changed_by_user_id"),
		createdAt: createdAt(),
	},
	(t) => [index("hackathon_changes_hackathon_idx").on(t.hackathonId, t.createdAt)],
);

export const userHackathonTracking = sqliteTable(
	"user_hackathon_tracking",
	{
		id: id(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		hackathonId: text("hackathon_id")
			.notNull()
			.references(() => hackathons.id, { onDelete: "cascade" }),
		participationStatus: text("participation_status").notNull().default("interested"),
		priority: text("priority").notNull().default("medium"),
		personalNotes: text("personal_notes"),
		teamName: text("team_name"),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [
		uniqueIndex("tracking_user_hackathon_uq").on(t.userId, t.hackathonId),
		index("tracking_hackathon_idx").on(t.hackathonId),
	],
);

export const bookmarks = sqliteTable(
	"bookmarks",
	{
		id: id(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		hackathonId: text("hackathon_id")
			.notNull()
			.references(() => hackathons.id, { onDelete: "cascade" }),
		note: text("note"),
		createdAt: createdAt(),
	},
	(t) => [uniqueIndex("bookmarks_user_hackathon_uq").on(t.userId, t.hackathonId), index("bookmarks_hackathon_idx").on(t.hackathonId)],
);

export const collections = sqliteTable(
	"collections",
	{
		id: id(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		description: text("description"),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [uniqueIndex("collections_user_name_uq").on(t.userId, t.name)],
);

export const collectionItems = sqliteTable(
	"collection_items",
	{
		collectionId: text("collection_id")
			.notNull()
			.references(() => collections.id, { onDelete: "cascade" }),
		hackathonId: text("hackathon_id")
			.notNull()
			.references(() => hackathons.id, { onDelete: "cascade" }),
		addedAt: createdAt(),
	},
	(t) => [primaryKey({ columns: [t.collectionId, t.hackathonId] }), index("collection_items_hackathon_idx").on(t.hackathonId)],
);

export const milestones = sqliteTable(
	"milestones",
	{
		id: id(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		hackathonId: text("hackathon_id").references(() => hackathons.id, { onDelete: "cascade" }),
		title: text("title").notNull(),
		dueAt: ts("due_at").notNull(),
		notes: text("notes"),
		completedAt: ts("completed_at"),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [index("milestones_user_due_idx").on(t.userId, t.dueAt)],
);

export const notificationPreferences = sqliteTable(
	"notification_preferences",
	{
		id: id(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		/** deadline_reminder | deadline_changed */
		notificationType: text("notification_type").notNull(),
		/** 7d | 3d | 24h | day_of for reminders; "none" for change notifications. */
		reminderInterval: text("reminder_interval").notNull(),
		/** in_app | email */
		channel: text("channel").notNull(),
		enabled: bool("enabled").notNull().default(true),
		/** Preferred local delivery time "HH:MM" for day-based reminders. */
		deliveryTime: text("delivery_time").notNull().default("09:00"),
		timezone: text("timezone").notNull().default("UTC"),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	(t) => [uniqueIndex("notification_prefs_uq").on(t.userId, t.notificationType, t.reminderInterval, t.channel)],
);

export const notifications = sqliteTable(
	"notifications",
	{
		id: id(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		hackathonId: text("hackathon_id").references(() => hackathons.id, { onDelete: "cascade" }),
		type: text("type").notNull(),
		channel: text("channel").notNull(),
		reminderInterval: text("reminder_interval"),
		title: text("title").notNull(),
		message: text("message").notNull(),
		scheduledAt: ts("scheduled_at").notNull(),
		deliveredAt: ts("delivered_at"),
		readAt: ts("read_at"),
		/** Registration deadline (epoch ms) the notification was computed from. */
		deadlineVersion: integer("deadline_version"),
		/** scheduled | delivering | delivered | cancelled | skipped | failed */
		status: text("status").notNull().default("scheduled"),
		failureReason: text("failure_reason"),
		/**
		 * type:user:hackathon:deadlineVersion:interval:channel — the unique
		 * constraint makes scheduling and delivery idempotent across cron runs.
		 */
		idempotencyKey: text("idempotency_key").notNull().unique(),
		createdAt: createdAt(),
	},
	(t) => [
		index("notifications_due_idx").on(t.status, t.scheduledAt),
		index("notifications_user_idx").on(t.userId, t.channel, t.status, t.deliveredAt),
		index("notifications_hackathon_idx").on(t.hackathonId),
	],
);

export const activityLog = sqliteTable(
	"activity_log",
	{
		id: id(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		hackathonId: text("hackathon_id").references(() => hackathons.id, { onDelete: "set null" }),
		action: text("action").notNull(),
		details: text("details").notNull().default("{}"),
		createdAt: createdAt(),
	},
	(t) => [index("activity_user_idx").on(t.userId, t.createdAt)],
);

export const syncRuns = sqliteTable(
	"sync_runs",
	{
		id: id(),
		platformId: text("platform_id")
			.notNull()
			.references(() => platforms.id),
		/** cron | admin */
		trigger: text("trigger").notNull(),
		triggeredByUserId: text("triggered_by_user_id"),
		/** running | success | partial | failed | unavailable | skipped */
		status: text("status").notNull(),
		startedAt: ts("started_at").notNull(),
		finishedAt: ts("finished_at"),
		recordsFetched: integer("records_fetched").notNull().default(0),
		recordsAdded: integer("records_added").notNull().default(0),
		recordsUpdated: integer("records_updated").notNull().default(0),
		recordsSkipped: integer("records_skipped").notNull().default(0),
		errorMessage: text("error_message"),
		/** JSON object with non-sensitive diagnostics (pages fetched, durations...). */
		diagnostics: text("diagnostics").notNull().default("{}"),
	},
	(t) => [index("sync_runs_platform_idx").on(t.platformId, t.startedAt)],
);

/** Individual records rejected during a sync — the "failed import review" queue. */
export const syncRecordErrors = sqliteTable(
	"sync_record_errors",
	{
		id: id(),
		syncRunId: text("sync_run_id")
			.notNull()
			.references(() => syncRuns.id, { onDelete: "cascade" }),
		platformId: text("platform_id").notNull(),
		externalEventId: text("external_event_id"),
		reason: text("reason").notNull(),
		createdAt: createdAt(),
	},
	(t) => [index("sync_record_errors_run_idx").on(t.syncRunId)],
);

export const duplicateCandidates = sqliteTable(
	"duplicate_candidates",
	{
		id: id(),
		hackathonId: text("hackathon_id")
			.notNull()
			.references(() => hackathons.id, { onDelete: "cascade" }),
		candidateId: text("candidate_id")
			.notNull()
			.references(() => hackathons.id, { onDelete: "cascade" }),
		/** high | medium | low */
		confidence: text("confidence").notNull(),
		reasons: text("reasons").notNull().default("[]"),
		/** open | merged | dismissed */
		status: text("status").notNull().default("open"),
		resolvedAt: ts("resolved_at"),
		resolvedByUserId: text("resolved_by_user_id"),
		createdAt: createdAt(),
	},
	(t) => [uniqueIndex("duplicate_pair_uq").on(t.hackathonId, t.candidateId), index("duplicate_status_idx").on(t.status)],
);

/** Fixed-window counters for application rate limits (CSV import, event creation...). */
export const appRateLimits = sqliteTable("app_rate_limits", {
	key: text("key").primaryKey(),
	windowStart: integer("window_start").notNull(),
	count: integer("count").notNull(),
});

export const schema = {
	...authSchema,
	profiles,
	platforms,
	hackathons,
	hackathonSources,
	tags,
	hackathonTags,
	hackathonChanges,
	userHackathonTracking,
	bookmarks,
	collections,
	collectionItems,
	milestones,
	notificationPreferences,
	notifications,
	activityLog,
	syncRuns,
	syncRecordErrors,
	duplicateCandidates,
	appRateLimits,
};
