// All writes to the shared `hackathons` table go through here so that
// normalization, tags, source attribution and change auditing stay consistent
// whether the write comes from manual entry, CSV import, an admin or a sync.
import { eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { Database } from "../db/client";
import { hackathonChanges, hackathonSources, hackathons } from "../db/schema";
import type { HackathonInput } from "@shared/schemas";
import type { DataQualityStatus, PlatformId, Visibility } from "@shared/constants";
import { findContradictions } from "@shared/status";
import { toHackathonColumns } from "./event-normalizer";
import { datedEvent, runBatch, tagStatements, type HackathonRow } from "../db/queries/hackathons";

export interface CreateOptions {
	id?: string;
	ownerId: string | null;
	visibility: Visibility;
	isDemo?: boolean;
	internalStatus?: DataQualityStatus;
	lastVerifiedAt?: Date | null;
	lastCheckedAt?: Date | null;
	sourceUpdatedAt?: Date | null;
	/** Source attribution row; defaults to the event's own platform + canonical URL. */
	source?: {
		platformId: PlatformId;
		externalEventId: string | null;
		sourceEventUrl: string;
		sourceRegistrationUrl: string | null;
		sourceUpdatedAt: Date | null;
		metadata?: Record<string, unknown> | null;
	};
}

/** Build (but do not run) the statements that create a hackathon. */
export function createHackathonStatements(db: Database, input: HackathonInput, opts: CreateOptions): { id: string; stmts: BatchItem<"sqlite">[] } {
	const id = opts.id ?? crypto.randomUUID();
	const now = new Date();
	const cols = toHackathonColumns(input);
	const contradictions = findContradictions(
		{
			registrationOpenAt: cols.registrationOpenAt?.getTime() ?? null,
			registrationDeadlineAt: cols.registrationDeadlineAt?.getTime() ?? null,
			eventStartAt: cols.eventStartAt?.getTime() ?? null,
			eventEndAt: cols.eventEndAt?.getTime() ?? null,
			sourceStatus: cols.sourceStatus,
			lastVerifiedAt: opts.lastVerifiedAt?.getTime() ?? null,
		},
		now.getTime(),
	);
	const source = opts.source ?? {
		platformId: input.platform,
		externalEventId: null,
		sourceEventUrl: input.canonicalUrl,
		sourceRegistrationUrl: input.registrationUrl,
		sourceUpdatedAt: null,
	};
	const stmts: BatchItem<"sqlite">[] = [
		db.insert(hackathons).values({
			id,
			...cols,
			createdByUserId: opts.ownerId,
			visibility: opts.visibility,
			isDemo: opts.isDemo ?? false,
			internalStatus: contradictions.length ? "needs_review" : (opts.internalStatus ?? "unverified"),
			contradictions: JSON.stringify(contradictions),
			lastVerifiedAt: opts.lastVerifiedAt ?? null,
			lastCheckedAt: opts.lastCheckedAt ?? now,
			sourceUpdatedAt: opts.sourceUpdatedAt ?? null,
			createdAt: now,
			updatedAt: now,
		}),
		db.insert(hackathonSources).values({
			hackathonId: id,
			platformId: source.platformId,
			externalEventId: source.externalEventId,
			sourceEventUrl: source.sourceEventUrl,
			sourceRegistrationUrl: source.sourceRegistrationUrl,
			sourceUpdatedAt: source.sourceUpdatedAt,
			lastCheckedAt: now,
			metadata: source.metadata ? JSON.stringify(source.metadata).slice(0, 4000) : null,
		}),
		...tagStatements(db, id, input.topics, input.technologies),
	];
	return { id, stmts };
}

export async function createHackathon(db: Database, input: HackathonInput, opts: CreateOptions, extra: BatchItem<"sqlite">[] = []) {
	const { id, stmts } = createHackathonStatements(db, input, opts);
	await runBatch(db, [...stmts, ...extra]);
	return id;
}

export const TRACKED_DATE_FIELDS = ["registrationOpenAt", "registrationDeadlineAt", "eventStartAt", "eventEndAt"] as const;

export interface DateChange {
	field: (typeof TRACKED_DATE_FIELDS)[number];
	oldValue: Date | null;
	newValue: Date | null;
}

export function diffDates(before: HackathonRow, after: ReturnType<typeof toHackathonColumns>): DateChange[] {
	const changes: DateChange[] = [];
	for (const field of TRACKED_DATE_FIELDS) {
		const a = before[field]?.getTime() ?? null;
		const b = after[field]?.getTime() ?? null;
		if (a !== b) changes.push({ field, oldValue: before[field] ?? null, newValue: after[field] ?? null });
	}
	return changes;
}

export interface UpdateOptions {
	changedBy: "owner" | "admin" | "sync";
	changedByUserId: string | null;
	markVerified?: boolean;
	internalStatus?: DataQualityStatus;
	lastCheckedAt?: Date;
	sourceUpdatedAt?: Date | null;
}

/** Replace a hackathon's editable fields. Returns the date changes it made. */
export async function updateHackathon(
	db: Database,
	existing: HackathonRow,
	input: HackathonInput,
	opts: UpdateOptions,
	extra: BatchItem<"sqlite">[] = [],
): Promise<DateChange[]> {
	const now = new Date();
	const cols = toHackathonColumns(input);
	const changes = diffDates(existing, cols);
	const lastVerifiedAt = opts.markVerified ? now : existing.lastVerifiedAt;
	const contradictions = findContradictions(
		{ ...datedEvent({ ...existing, ...cols, lastVerifiedAt } as HackathonRow) },
		now.getTime(),
	);
	const internalStatus = contradictions.length
		? "needs_review"
		: (opts.internalStatus ?? (opts.markVerified ? "verified" : (existing.internalStatus as DataQualityStatus)));
	const stmts: BatchItem<"sqlite">[] = [
		db
			.update(hackathons)
			.set({
				...cols,
				internalStatus,
				contradictions: JSON.stringify(contradictions),
				lastVerifiedAt,
				lastCheckedAt: opts.lastCheckedAt ?? now,
				sourceUpdatedAt: opts.sourceUpdatedAt === undefined ? existing.sourceUpdatedAt : opts.sourceUpdatedAt,
				updatedAt: now,
			})
			.where(eq(hackathons.id, existing.id)),
		...tagStatements(db, existing.id, input.topics, input.technologies),
		...changes.map((c) =>
			db.insert(hackathonChanges).values({
				hackathonId: existing.id,
				field: c.field,
				oldValue: c.oldValue?.toISOString() ?? null,
				newValue: c.newValue?.toISOString() ?? null,
				changedBy: opts.changedBy,
				changedByUserId: opts.changedByUserId,
			}),
		),
		...extra,
	];
	await runBatch(db, stmts);
	return changes;
}
