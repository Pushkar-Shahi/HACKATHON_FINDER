// JSON shapes returned by the Worker API. Dates are ISO-8601 UTC strings.
import type {
	CalendarEntryKind,
	DataQualityStatus,
	EventStatus,
	ExperienceLevel,
	IntegrationMode,
	IntegrationStatus,
	NotificationChannel,
	NotificationType,
	ParticipationMode,
	PlatformId,
	PreferredMode,
	Priority,
	PublicationStatus,
	RegistrationStatus,
	ReminderInterval,
	SourcePlatformId,
	SourceStatus,
	TopicId,
	TrackingStatus,
	Visibility,
} from "./constants";

export interface PaginationMeta {
	page: number;
	pageSize: number;
	total: number;
	totalPages: number;
}

export interface ApiSuccess<T, M = Record<string, unknown>> {
	data: T;
	meta?: M;
}

export interface ApiErrorBody {
	error: {
		code: string;
		message: string;
		fields?: Record<string, string[]>;
	};
}

export interface ViewerTracking {
	id: string;
	status: TrackingStatus;
	priority: Priority;
}

export interface HackathonViewerState {
	bookmarked: boolean;
	bookmarkId: string | null;
	tracking: ViewerTracking | null;
}

export interface HackathonSummary {
	id: string;
	title: string;
	organizer: string | null;
	platform: PlatformId;
	shortDescription: string | null;
	canonicalUrl: string;
	registrationUrl: string | null;
	coverImageUrl: string | null;
	registrationOpenAt: string | null;
	registrationDeadlineAt: string | null;
	eventStartAt: string | null;
	eventEndAt: string | null;
	eventTimezone: string | null;
	participationMode: ParticipationMode | null;
	location: string | null;
	country: string | null;
	topics: TopicId[];
	technologies: string[];
	prizeAmount: number | null;
	prizeCurrency: string | null;
	teamSizeMin: number | null;
	teamSizeMax: number | null;
	participationFeeAmount: number | null;
	participationFeeCurrency: string | null;
	eligibilitySummary: string | null;
	isStudentEligible: boolean | null;
	isBeginnerFriendly: boolean | null;
	isInternational: boolean | null;
	registrationStatus: RegistrationStatus;
	eventStatus: EventStatus;
	sourceStatus: SourceStatus | null;
	dataQuality: DataQualityStatus;
	lastVerifiedAt: string | null;
	lastCheckedAt: string | null;
	createdAt: string;
	updatedAt: string;
	isDemo: boolean;
	visibility: Visibility;
	isOwner: boolean;
	publicationStatus: PublicationStatus;
	viewer: HackathonViewerState | null;
}

export interface HackathonSourceLink {
	id: string;
	platform: PlatformId;
	externalEventId: string | null;
	sourceEventUrl: string;
	sourceRegistrationUrl: string | null;
	sourceUpdatedAt: string | null;
	lastCheckedAt: string | null;
}

export interface HackathonDetail extends HackathonSummary {
	description: string | null;
	prizeDetails: string | null;
	eligibilityDetails: string | null;
	additionalNotes: string | null;
	contradictions: string[];
	sources: HackathonSourceLink[];
	reviewNote: string | null;
	viewerDetail: {
		personalNotes: string | null;
		teamName: string | null;
		bookmarkNote: string | null;
		collectionIds: string[];
	} | null;
}

export interface DashboardStats {
	upcoming: number;
	registrationOpen: number;
	deadlinesNext7Days: number;
	ongoing: number;
	saved: number | null;
	registered: number | null;
	demoEventCount: number;
	totalVisibleEvents: number;
	generatedAt: string;
}

export interface Recommendation {
	hackathon: HackathonSummary;
	score: number;
	reasons: string[];
	cautions: string[];
}

export interface ActivityItem {
	id: string;
	action: string;
	hackathonId: string | null;
	hackathonTitle: string | null;
	details: Record<string, unknown>;
	createdAt: string;
}

export interface TrackingRecord {
	id: string;
	hackathonId: string;
	status: TrackingStatus;
	priority: Priority;
	personalNotes: string | null;
	teamName: string | null;
	createdAt: string;
	updatedAt: string;
	hackathon: HackathonSummary;
}

export interface BookmarkRecord {
	id: string;
	hackathonId: string;
	note: string | null;
	createdAt: string;
	collectionIds: string[];
	hackathon: HackathonSummary;
}

export interface CollectionRecord {
	id: string;
	name: string;
	description: string | null;
	itemCount: number;
	createdAt: string;
	updatedAt: string;
}

export interface MilestoneRecord {
	id: string;
	title: string;
	dueAt: string;
	notes: string | null;
	completedAt: string | null;
	hackathonId: string | null;
	hackathonTitle: string | null;
}

export interface CalendarEntry {
	id: string;
	kind: CalendarEntryKind;
	at: string;
	title: string;
	hackathonId: string | null;
	milestoneId: string | null;
	platform: PlatformId | null;
	isDemo: boolean;
	eventTimezone: string | null;
}

export interface NotificationRecord {
	id: string;
	type: NotificationType;
	title: string;
	message: string;
	channel: NotificationChannel;
	hackathonId: string | null;
	deliveredAt: string | null;
	readAt: string | null;
	createdAt: string;
}

export interface NotificationPreferences {
	deliveryTime: string;
	timezone: string;
	reminders: { interval: ReminderInterval; channel: NotificationChannel; enabled: boolean }[];
	deadlineChanged: { in_app: boolean; email: boolean };
	emailConfigured: boolean;
}

export interface Profile {
	userId: string;
	email: string;
	name: string;
	role: "user" | "admin";
	displayName: string | null;
	country: string | null;
	timezone: string | null;
	experienceLevel: ExperienceLevel | null;
	preferredMode: PreferredMode;
	isStudent: boolean | null;
	interests: TopicId[];
	showDemoEvents: boolean;
	createdAt: string;
}

export interface SourceStatusReport {
	platform: SourcePlatformId;
	name: string;
	homepageUrl: string;
	integrationMode: IntegrationMode;
	integrationMethod: string;
	status: IntegrationStatus;
	statusDetail: string;
	policySummary: string;
	manualWorkflow: string;
	autoSyncConfigured: boolean;
	autoSyncEnabled: boolean;
	lastAttemptedSyncAt: string | null;
	lastSuccessfulSyncAt: string | null;
	lastError: string | null;
	lastRun: {
		added: number;
		updated: number;
		skipped: number;
		status: string;
		finishedAt: string | null;
	} | null;
	eventCount: number;
}

export interface AppConfig {
	environment: string;
	emailConfigured: boolean;
	googleAuthConfigured: boolean;
	passwordResetAvailable: boolean;
}

export type CsvRowStatus = "valid" | "invalid" | "duplicate";

export interface CsvPreviewRow {
	row: number;
	status: CsvRowStatus;
	title: string | null;
	canonicalUrl: string | null;
	errors: string[];
	duplicateOf: { id: string; title: string; reason: string } | null;
}

export interface CsvPreview {
	headers: string[];
	unknownHeaders: string[];
	missingRequiredHeaders: string[];
	totalRows: number;
	validCount: number;
	invalidCount: number;
	duplicateCount: number;
	rows: CsvPreviewRow[];
}

export interface CsvImportResult {
	imported: number;
	skipped: number;
	createdIds: string[];
}
