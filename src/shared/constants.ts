// Shared enumerations and constants used by both the Worker API and the React app.
// Keeping them in one place guarantees the client never sends a value the
// server would reject, and that labels stay consistent across the UI.

export const PLATFORM_IDS = ["devpost", "machinehack", "mlh", "unstop", "other"] as const;
export type PlatformId = (typeof PLATFORM_IDS)[number];

/** The four external platforms HackRadar has provider adapters for. */
export const SOURCE_PLATFORM_IDS = ["devpost", "machinehack", "mlh", "unstop"] as const;
export type SourcePlatformId = (typeof SOURCE_PLATFORM_IDS)[number];

export const PLATFORM_LABELS: Record<PlatformId, string> = {
	devpost: "Devpost",
	machinehack: "MachineHack",
	mlh: "MLH",
	unstop: "Unstop",
	other: "Other / direct",
};

export const PARTICIPATION_MODES = ["online", "in_person", "hybrid"] as const;
export type ParticipationMode = (typeof PARTICIPATION_MODES)[number];
export const PARTICIPATION_MODE_LABELS: Record<ParticipationMode, string> = {
	online: "Online",
	in_person: "In-person",
	hybrid: "Hybrid",
};

export const PREFERRED_MODES = ["any", ...PARTICIPATION_MODES] as const;
export type PreferredMode = (typeof PREFERRED_MODES)[number];

/**
 * Application-derived registration status. These are HackRadar classifications
 * computed from stored dates; they are not proof that registration is open on
 * the source platform.
 */
export const REGISTRATION_STATUSES = ["open", "opening_soon", "closing_soon", "closed", "unknown"] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];
export const REGISTRATION_STATUS_LABELS: Record<RegistrationStatus, string> = {
	open: "Open",
	opening_soon: "Opening soon",
	closing_soon: "Closing soon",
	closed: "Closed",
	unknown: "Unknown",
};

export const EVENT_STATUSES = ["upcoming", "ongoing", "completed", "cancelled", "needs_verification"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];
export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
	upcoming: "Upcoming",
	ongoing: "Ongoing",
	completed: "Completed",
	cancelled: "Cancelled",
	needs_verification: "Needs verification",
};

/** Status explicitly reported by a source (or the event owner/admin). */
export const SOURCE_STATUSES = ["open", "closed", "cancelled"] as const;
export type SourceStatus = (typeof SOURCE_STATUSES)[number];

export const DATA_QUALITY_STATUSES = ["verified", "unverified", "needs_review"] as const;
export type DataQualityStatus = (typeof DATA_QUALITY_STATUSES)[number];

export const TOPICS = [
	{ id: "ai", label: "Artificial intelligence" },
	{ id: "ml", label: "Machine learning" },
	{ id: "genai", label: "Generative AI" },
	{ id: "agentic_ai", label: "Agentic AI" },
	{ id: "data_science", label: "Data science" },
	{ id: "web", label: "Web development" },
	{ id: "mobile", label: "Mobile development" },
	{ id: "cybersecurity", label: "Cybersecurity" },
	{ id: "cloud", label: "Cloud computing" },
	{ id: "devops_mlops", label: "DevOps and MLOps" },
	{ id: "robotics", label: "Robotics" },
	{ id: "blockchain", label: "Blockchain and Web3" },
	{ id: "fintech", label: "FinTech" },
	{ id: "healthcare", label: "Healthcare" },
	{ id: "climate", label: "Climate and sustainability" },
	{ id: "open_innovation", label: "Open innovation" },
	{ id: "other", label: "Other" },
] as const;
export type TopicId = (typeof TOPICS)[number]["id"];
export const TOPIC_IDS = TOPICS.map((t) => t.id) as [TopicId, ...TopicId[]];
export const TOPIC_LABELS = Object.fromEntries(TOPICS.map((t) => [t.id, t.label])) as Record<TopicId, string>;
/** Topics grouped under the "AI and machine learning" quick view. */
export const AI_ML_TOPICS: TopicId[] = ["ai", "ml", "genai", "agentic_ai"];

export const TRACKING_STATUSES = [
	"interested",
	"shortlisted",
	"planning",
	"registered",
	"preparing",
	"submitted",
	"completed",
	"won",
	"not_participating",
] as const;
export type TrackingStatus = (typeof TRACKING_STATUSES)[number];
export const TRACKING_STATUS_LABELS: Record<TrackingStatus, string> = {
	interested: "Interested",
	shortlisted: "Shortlisted",
	planning: "Planning",
	registered: "Registered",
	preparing: "Preparing",
	submitted: "Submitted",
	completed: "Completed",
	won: "Won",
	not_participating: "Not participating",
};
/** Tracker statuses counted as "Registered" on the dashboard. */
export const REGISTERED_TRACKING_STATUSES: TrackingStatus[] = ["registered", "preparing", "submitted"];
/** Tracker statuses for which deadline reminders are no longer useful. */
export const INACTIVE_TRACKING_STATUSES: TrackingStatus[] = ["not_participating", "submitted", "completed", "won"];

export const PRIORITIES = ["low", "medium", "high"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABELS: Record<Priority, string> = { low: "Low", medium: "Medium", high: "High" };

export const EXPERIENCE_LEVELS = ["beginner", "intermediate", "advanced"] as const;
export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number];

export const REMINDER_INTERVALS = ["7d", "3d", "24h", "day_of"] as const;
export type ReminderInterval = (typeof REMINDER_INTERVALS)[number];
export const REMINDER_INTERVAL_LABELS: Record<ReminderInterval, string> = {
	"7d": "7 days before",
	"3d": "3 days before",
	"24h": "24 hours before",
	day_of: "On the deadline day",
};

export const NOTIFICATION_CHANNELS = ["in_app", "email"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_TYPES = ["deadline_reminder", "deadline_changed", "system"] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_STATUSES = ["scheduled", "delivering", "delivered", "cancelled", "skipped", "failed"] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export const INTEGRATION_STATUSES = [
	"connected",
	"manual_mode",
	"setup_required",
	"sync_failed",
	"temporarily_unavailable",
] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];
export const INTEGRATION_STATUS_LABELS: Record<IntegrationStatus, string> = {
	connected: "Connected",
	manual_mode: "Manual Mode",
	setup_required: "Setup Required",
	sync_failed: "Sync Failed",
	temporarily_unavailable: "Temporarily Unavailable",
};

export const INTEGRATION_MODES = ["manual", "authorized_feed"] as const;
export type IntegrationMode = (typeof INTEGRATION_MODES)[number];

export const SORT_OPTIONS = ["deadline", "start", "recent", "verified", "alpha", "relevance", "prize"] as const;
export type SortOption = (typeof SORT_OPTIONS)[number];
export const SORT_LABELS: Record<SortOption, string> = {
	deadline: "Deadline (soonest)",
	start: "Start date (soonest)",
	recent: "Recently added",
	verified: "Recently verified",
	alpha: "Alphabetical",
	relevance: "Most relevant",
	prize: "Highest prize",
};

export const DEADLINE_WINDOWS = ["24h", "3d", "7d", "30d", "custom", "none"] as const;
export type DeadlineWindow = (typeof DEADLINE_WINDOWS)[number];
export const DEADLINE_WINDOW_LABELS: Record<DeadlineWindow, string> = {
	"24h": "Next 24 hours",
	"3d": "Next 3 days",
	"7d": "Next 7 days",
	"30d": "Next 30 days",
	custom: "Custom range",
	none: "No verified deadline",
};

export const VISIBILITIES = ["public", "private"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const PUBLICATION_STATUSES = ["none", "pending", "approved", "rejected"] as const;
export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number];

export const CALENDAR_ENTRY_KINDS = [
	"registration_open",
	"registration_deadline",
	"event_start",
	"event_end",
	"milestone",
] as const;
export type CalendarEntryKind = (typeof CALENDAR_ENTRY_KINDS)[number];
export const CALENDAR_ENTRY_LABELS: Record<CalendarEntryKind, string> = {
	registration_open: "Registration opens",
	registration_deadline: "Registration deadline",
	event_start: "Event starts",
	event_end: "Event ends",
	milestone: "Milestone",
};

// ---- Time thresholds (milliseconds) ----
export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
/** A deadline within this window is classified as "closing soon". */
export const CLOSING_SOON_MS = 7 * DAY_MS;
/** Urgent highlight on cards. */
export const URGENT_MS = 48 * HOUR_MS;
/** An explicit source status is trusted for this long after verification. */
export const SOURCE_STATUS_FRESH_MS = 72 * HOUR_MS;
/** Verification older than this is shown as possibly outdated. */
export const VERIFICATION_STALE_MS = 7 * DAY_MS;

export const MAX_PAGE_SIZE = 50;
export const DEFAULT_PAGE_SIZE = 18;
export const MAX_CSV_BYTES = 1024 * 1024; // 1 MB
export const MAX_CSV_ROWS = 500;
export const MAX_JSON_BODY_BYTES = 64 * 1024;
