// Zod schemas shared by the React forms (client-side validation) and the Worker
// routes (authoritative server-side validation). Never trust the client copy:
// every route re-validates with the same schema.
import { z } from "zod";
import {
	DEADLINE_WINDOWS,
	EVENT_STATUSES,
	EXPERIENCE_LEVELS,
	MAX_CSV_BYTES,
	MAX_PAGE_SIZE,
	DEFAULT_PAGE_SIZE,
	NOTIFICATION_CHANNELS,
	PARTICIPATION_MODES,
	PLATFORM_IDS,
	PREFERRED_MODES,
	PRIORITIES,
	REGISTRATION_STATUSES,
	REMINDER_INTERVALS,
	SORT_OPTIONS,
	SOURCE_STATUSES,
	TOPIC_IDS,
	TRACKING_STATUSES,
	DATA_QUALITY_STATUSES,
} from "./constants";

// ---------------------------------------------------------------------------
// Primitive helpers
// ---------------------------------------------------------------------------

/** Only http(s) links are ever stored or rendered (blocks javascript:, data:, etc). */
export function isHttpUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return (url.protocol === "https:" || url.protocol === "http:") && url.hostname.length > 0;
	} catch {
		return false;
	}
}

export function isValidTimeZone(tz: string): boolean {
	if (!tz || tz.length > 64) return false;
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: tz });
		return true;
	} catch {
		return false;
	}
}

export function isValidCurrency(code: string): boolean {
	if (!/^[A-Z]{3}$/.test(code)) return false;
	try {
		new Intl.NumberFormat("en-US", { style: "currency", currency: code });
		return true;
	} catch {
		return false;
	}
}

export const httpUrlSchema = z
	.string()
	.trim()
	.max(2048, "URL is too long")
	.refine(isHttpUrl, "Must be a valid http(s) URL");

/** Optional free text: trims, converts empty strings to null. */
export const optionalText = (max: number) =>
	z
		.string()
		.trim()
		.max(max, `Must be at most ${max} characters`)
		.nullish()
		.transform((v) => (v ? v : null));

const optionalUrl = z
	.union([httpUrlSchema, z.literal("")])
	.nullish()
	.transform((v) => (v ? v : null));

/** ISO-8601 instant with an explicit offset or Z, e.g. 2026-11-01T18:29:00Z. */
export const isoDateTimeSchema = z.iso.datetime({ offset: true, message: "Must be an ISO date-time with a timezone offset" });
const optionalDateTime = z
	.union([isoDateTimeSchema, z.literal("")])
	.nullish()
	.transform((v) => (v ? new Date(v).toISOString() : null));

export const timeZoneSchema = z.string().trim().refine(isValidTimeZone, "Unknown IANA time zone");
export const currencySchema = z
	.string()
	.trim()
	.toUpperCase()
	.refine(isValidCurrency, "Must be a 3-letter ISO 4217 currency code");

const optionalBool = z.boolean().nullish().transform((v) => (v === undefined ? null : v));
const money = z.number().finite().nonnegative("Must be zero or more").max(1e12, "Amount is too large");

// ---------------------------------------------------------------------------
// Hackathon (manual entry / owner edit / admin edit)
// ---------------------------------------------------------------------------

export const hackathonInputSchema = z
	.object({
		title: z.string().trim().min(3, "Title must be at least 3 characters").max(200),
		organizer: optionalText(200),
		platform: z.enum(PLATFORM_IDS),
		canonicalUrl: httpUrlSchema,
		registrationUrl: optionalUrl,
		coverImageUrl: optionalUrl,
		description: optionalText(10_000),
		registrationOpenAt: optionalDateTime,
		registrationDeadlineAt: optionalDateTime,
		eventStartAt: optionalDateTime,
		eventEndAt: optionalDateTime,
		eventTimezone: timeZoneSchema.nullish().transform((v) => v ?? null),
		participationMode: z.enum(PARTICIPATION_MODES).nullish().transform((v) => v ?? null),
		location: optionalText(200),
		country: optionalText(100),
		topics: z.array(z.enum(TOPIC_IDS)).max(10).default([]),
		technologies: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
		prizeAmount: money.nullish().transform((v) => v ?? null),
		prizeCurrency: currencySchema.nullish().transform((v) => v ?? null),
		prizeDetails: optionalText(2000),
		teamSizeMin: z.number().int().min(1).max(100).nullish().transform((v) => v ?? null),
		teamSizeMax: z.number().int().min(1).max(100).nullish().transform((v) => v ?? null),
		participationFeeAmount: money.nullish().transform((v) => v ?? null),
		participationFeeCurrency: currencySchema.nullish().transform((v) => v ?? null),
		eligibilitySummary: optionalText(500),
		eligibilityDetails: optionalText(5000),
		isStudentEligible: optionalBool,
		isBeginnerFriendly: optionalBool,
		isInternational: optionalBool,
		sourceStatus: z.enum(SOURCE_STATUSES).nullish().transform((v) => v ?? null),
		additionalNotes: optionalText(5000),
	})
	.superRefine((v, ctx) => {
		// Dates arrive as instants with explicit offsets, so they are unambiguous.
		// eventTimezone is the event's own display zone and stays null when unknown;
		// wall-clock input (the form, CSV) must name a zone before conversion.
		const t = (s: string | null) => (s ? Date.parse(s) : null);
		const open = t(v.registrationOpenAt);
		const deadline = t(v.registrationDeadlineAt);
		const start = t(v.eventStartAt);
		const end = t(v.eventEndAt);
		if (open !== null && deadline !== null && open > deadline) {
			ctx.addIssue({ code: "custom", path: ["registrationOpenAt"], message: "Registration cannot open after the deadline" });
		}
		if (start !== null && end !== null && start > end) {
			ctx.addIssue({ code: "custom", path: ["eventEndAt"], message: "Event end must be after the start" });
		}
		if (v.prizeAmount !== null && !v.prizeCurrency) {
			ctx.addIssue({ code: "custom", path: ["prizeCurrency"], message: "Currency is required with a prize amount" });
		}
		if (v.participationFeeAmount !== null && v.participationFeeAmount > 0 && !v.participationFeeCurrency) {
			ctx.addIssue({ code: "custom", path: ["participationFeeCurrency"], message: "Currency is required with a fee" });
		}
		if (v.teamSizeMin !== null && v.teamSizeMax !== null && v.teamSizeMin > v.teamSizeMax) {
			ctx.addIssue({ code: "custom", path: ["teamSizeMax"], message: "Maximum team size must be at least the minimum" });
		}
	});
export type HackathonInput = z.output<typeof hackathonInputSchema>;
export type HackathonInputRaw = z.input<typeof hackathonInputSchema>;

export const adminHackathonUpdateSchema = z.object({
	event: hackathonInputSchema,
	internalStatus: z.enum(DATA_QUALITY_STATUSES).optional(),
	markVerified: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Discovery query
// ---------------------------------------------------------------------------

const csvList = <T extends string>(values: readonly [T, ...T[]]) =>
	z
		.string()
		.max(1000)
		.optional()
		.transform((s) =>
			s
				? s
						.split(",")
						.map((x) => x.trim())
						.filter(Boolean)
				: [],
		)
		.pipe(z.array(z.enum(values)).max(values.length));

const boolFlag = z
	.enum(["true", "false"])
	.optional()
	.transform((v) => (v === undefined ? undefined : v === "true"));

export const hackathonListQuerySchema = z.object({
	q: z.string().trim().max(200).optional(),
	platforms: csvList(PLATFORM_IDS),
	registration: csvList(REGISTRATION_STATUSES),
	status: csvList(EVENT_STATUSES),
	modes: csvList(PARTICIPATION_MODES),
	topics: csvList(TOPIC_IDS),
	deadline: z.enum(DEADLINE_WINDOWS).optional(),
	deadlineFrom: isoDateTimeSchema.optional(),
	deadlineTo: isoDateTimeSchema.optional(),
	beginner: boolFlag,
	students: boolFlag,
	international: boolFlag,
	free: boolFlag,
	minPrize: z.coerce.number().nonnegative().max(1e12).optional(),
	prizeCurrency: currencySchema.optional(),
	teamSize: z.coerce.number().int().min(1).max(100).optional(),
	country: z.string().trim().max(100).optional(),
	organizer: z.string().trim().max(200).optional(),
	saved: boolFlag,
	tracked: boolFlag,
	mine: boolFlag,
	includeDemo: boolFlag,
	sort: z.enum(SORT_OPTIONS).default("deadline"),
	page: z.coerce.number().int().min(1).max(1000).default(1),
	pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type HackathonListQuery = z.output<typeof hackathonListQuerySchema>;

// ---------------------------------------------------------------------------
// Personal tracking, bookmarks, collections, milestones
// ---------------------------------------------------------------------------

const idSchema = z.string().trim().min(1).max(64);

export const trackingCreateSchema = z.object({
	hackathonId: idSchema,
	status: z.enum(TRACKING_STATUSES).default("interested"),
	priority: z.enum(PRIORITIES).default("medium"),
	personalNotes: optionalText(10_000),
	teamName: optionalText(100),
});

export const trackingUpdateSchema = z
	.object({
		status: z.enum(TRACKING_STATUSES).optional(),
		priority: z.enum(PRIORITIES).optional(),
		personalNotes: optionalText(10_000).optional(),
		teamName: optionalText(100).optional(),
	})
	.refine((v) => Object.values(v).some((x) => x !== undefined), "Provide at least one field to update");

export const bookmarkCreateSchema = z.object({
	hackathonId: idSchema,
	note: optionalText(2000),
	collectionId: idSchema.optional(),
});

export const bookmarkUpdateSchema = z.object({ note: optionalText(2000) });

export const collectionCreateSchema = z.object({
	name: z.string().trim().min(1, "Name is required").max(60),
	description: optionalText(300),
});
export const collectionUpdateSchema = collectionCreateSchema.partial();

export const collectionItemSchema = z.object({ hackathonId: idSchema });
export const collectionMoveSchema = z.object({
	hackathonId: idSchema,
	fromCollectionId: idSchema.nullish(),
	toCollectionId: idSchema,
});

export const milestoneCreateSchema = z.object({
	title: z.string().trim().min(1, "Title is required").max(200),
	dueAt: isoDateTimeSchema,
	hackathonId: idSchema.nullish().transform((v) => v ?? null),
	notes: optionalText(2000),
});
export const milestoneUpdateSchema = z.object({
	title: z.string().trim().min(1).max(200).optional(),
	dueAt: isoDateTimeSchema.optional(),
	notes: optionalText(2000).optional(),
	completed: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Profile and notification preferences
// ---------------------------------------------------------------------------

export const profileUpdateSchema = z.object({
	displayName: optionalText(80).optional(),
	country: optionalText(100).optional(),
	timezone: timeZoneSchema.nullish(),
	experienceLevel: z.enum(EXPERIENCE_LEVELS).nullish(),
	preferredMode: z.enum(PREFERRED_MODES).optional(),
	isStudent: z.boolean().nullish(),
	interests: z.array(z.enum(TOPIC_IDS)).max(TOPIC_IDS.length).optional(),
	showDemoEvents: z.boolean().optional(),
});

export const deliveryTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24-hour)");

export const notificationPreferencesUpdateSchema = z.object({
	deliveryTime: deliveryTimeSchema,
	timezone: timeZoneSchema,
	reminders: z
		.array(
			z.object({
				interval: z.enum(REMINDER_INTERVALS),
				channel: z.enum(NOTIFICATION_CHANNELS),
				enabled: z.boolean(),
			}),
		)
		.max(REMINDER_INTERVALS.length * NOTIFICATION_CHANNELS.length),
	deadlineChanged: z.object({ in_app: z.boolean(), email: z.boolean() }),
});
export type NotificationPreferencesUpdate = z.output<typeof notificationPreferencesUpdateSchema>;

export const notificationUpdateSchema = z.object({ read: z.boolean() });

// ---------------------------------------------------------------------------
// CSV import
// ---------------------------------------------------------------------------

export const csvImportSchema = z.object({
	csv: z.string().min(1, "The file is empty").max(MAX_CSV_BYTES, "The file is larger than 1 MB"),
	/** Row numbers (1-based, excluding the header) to import. Omit for preview. */
	rows: z.array(z.number().int().min(1)).max(1000).optional(),
});

export const accountDeleteSchema = z.object({
	confirm: z.literal("DELETE", { message: 'Type "DELETE" to confirm' }),
});

export const publicationRequestSchema = z.object({ note: optionalText(500) });
export const publicationDecisionSchema = z.object({
	approve: z.boolean(),
	note: optionalText(500),
});
export const duplicateResolutionSchema = z.object({
	action: z.enum(["merge", "dismiss"]),
	/** When merging, which record survives. */
	keepId: idSchema.optional(),
});
export const platformUpdateSchema = z.object({ autoSyncEnabled: z.boolean() });
