// Hackathon read queries: visibility, combined filters, search, sorting,
// pagination and mapping rows to API shapes.
import { and, asc, desc, eq, exists, gte, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { Database } from "../client";
import {
	bookmarks,
	collectionItems,
	collections,
	hackathonSources,
	hackathonTags,
	hackathons as h,
	tags,
	userHackathonTracking,
} from "../schema";
import { eventStatusSql, num, registrationStatusSql } from "./status-sql";
import type { HackathonListQuery } from "@shared/schemas";
import type { HackathonDetail, HackathonSummary, HackathonViewerState, HackathonSourceLink } from "@shared/types";
import {
	DAY_MS,
	REGISTERED_TRACKING_STATUSES,
	TOPIC_LABELS,
	type DataQualityStatus,
	type EventStatus,
	type ParticipationMode,
	type PlatformId,
	type Priority,
	type PublicationStatus,
	type RegistrationStatus,
	type SourceStatus,
	type TopicId,
	type TrackingStatus,
	type Visibility,
} from "@shared/constants";
import { findContradictions, fromMinorUnits, toMinorUnits, type DatedEvent } from "@shared/status";
import { normalizeTechnology } from "../../services/event-normalizer";
import { parseJsonArray, toIso } from "../../lib/http";

export type HackathonRow = typeof h.$inferSelect;

/** Who is asking. Determines which private records and personal state are visible. */
export interface Viewer {
	userId: string | null;
	isAdmin: boolean;
	showDemo: boolean;
	interests: TopicId[];
}

export const anonymousViewer: Viewer = { userId: null, isAdmin: false, showDemo: true, interests: [] };

/** Public records, plus the viewer's own private records. Admins see the same — privacy applies to them too. */
export function visibleTo(viewer: Viewer): SQL {
	return viewer.userId ? or(eq(h.visibility, "public"), eq(h.createdByUserId, viewer.userId))! : eq(h.visibility, "public");
}

export function escapeLike(s: string): string {
	return s.replace(/[\\%_]/g, (m) => "\\" + m);
}

function containsCi(column: SQL | typeof h.searchText, value: string): SQL {
	return sql`${column} LIKE ${"%" + escapeLike(value.toLowerCase()) + "%"} ESCAPE '\\'`;
}

export function searchTerms(q: string | undefined): string[] {
	if (!q) return [];
	return q
		.toLowerCase()
		.split(/\s+/)
		.map((t) => t.trim())
		.filter(Boolean)
		.slice(0, 6);
}

export function datedEvent(row: HackathonRow): DatedEvent {
	return {
		registrationOpenAt: row.registrationOpenAt?.getTime() ?? null,
		registrationDeadlineAt: row.registrationDeadlineAt?.getTime() ?? null,
		eventStartAt: row.eventStartAt?.getTime() ?? null,
		eventEndAt: row.eventEndAt?.getTime() ?? null,
		sourceStatus: (row.sourceStatus as SourceStatus | null) ?? null,
		lastVerifiedAt: row.lastVerifiedAt?.getTime() ?? null,
	};
}

const DEADLINE_WINDOW_MS: Record<string, number> = { "24h": DAY_MS, "3d": 3 * DAY_MS, "7d": 7 * DAY_MS, "30d": 30 * DAY_MS };

function topicExists(db: Database, topicIds: string[]): SQL {
	return exists(
		db
			.select({ one: sql`1` })
			.from(hackathonTags)
			.innerJoin(tags, eq(tags.id, hackathonTags.tagId))
			.where(and(eq(hackathonTags.hackathonId, h.id), eq(tags.kind, "topic"), inArray(tags.slug, topicIds))),
	);
}

/** All filter conditions combined with AND. Unknown values never satisfy an eligibility filter. */
export function buildListConditions(db: Database, q: HackathonListQuery, viewer: Viewer, now: number): SQL[] {
	const conds: (SQL | undefined)[] = [visibleTo(viewer)];
	const NOW = num(now);

	if (!(q.includeDemo ?? viewer.showDemo)) conds.push(eq(h.isDemo, false));

	for (const term of searchTerms(q.q)) conds.push(containsCi(h.searchText, term));

	if (q.platforms.length) {
		conds.push(
			or(
				inArray(h.primaryPlatformId, q.platforms),
				exists(
					db
						.select({ one: sql`1` })
						.from(hackathonSources)
						.where(and(eq(hackathonSources.hackathonId, h.id), inArray(hackathonSources.platformId, q.platforms))),
				),
			),
		);
	}

	if (q.registration.length) {
		// "Open" means accepting registrations, which includes "closing soon".
		const statuses = new Set<RegistrationStatus>(q.registration);
		if (statuses.has("open")) statuses.add("closing_soon");
		conds.push(inArray(registrationStatusSql(now), [...statuses]));
	}
	if (q.status.length) conds.push(inArray(eventStatusSql(now), q.status));
	if (q.modes.length) conds.push(inArray(h.participationMode, q.modes));
	if (q.topics.length) conds.push(topicExists(db, q.topics));

	if (q.deadline === "none") {
		conds.push(isNull(h.registrationDeadlineAt));
	} else if (q.deadline === "custom") {
		if (q.deadlineFrom) conds.push(sql`${h.registrationDeadlineAt} >= ${num(Date.parse(q.deadlineFrom))}`);
		if (q.deadlineTo) conds.push(sql`${h.registrationDeadlineAt} <= ${num(Date.parse(q.deadlineTo))}`);
		if (!q.deadlineFrom && !q.deadlineTo) conds.push(sql`${h.registrationDeadlineAt} IS NOT NULL`);
	} else if (q.deadline) {
		conds.push(sql`${h.registrationDeadlineAt} > ${NOW} AND ${h.registrationDeadlineAt} <= ${num(now + DEADLINE_WINDOW_MS[q.deadline])}`);
	}

	if (q.beginner) conds.push(eq(h.isBeginnerFriendly, true));
	if (q.students) conds.push(eq(h.isStudentEligible, true));
	if (q.international) conds.push(eq(h.isInternational, true));
	if (q.free) conds.push(eq(h.participationFeeMinor, 0));

	if (q.minPrize !== undefined && q.prizeCurrency) {
		conds.push(and(eq(h.prizeCurrency, q.prizeCurrency), gte(h.prizeAmountMinor, toMinorUnits(q.minPrize, q.prizeCurrency))));
	}
	if (q.teamSize !== undefined) {
		// Only events that state a team size, and whose stated bounds allow this size.
		conds.push(
			sql`(${h.teamSizeMin} IS NOT NULL OR ${h.teamSizeMax} IS NOT NULL)
				AND (${h.teamSizeMin} IS NULL OR ${h.teamSizeMin} <= ${q.teamSize})
				AND (${h.teamSizeMax} IS NULL OR ${h.teamSizeMax} >= ${q.teamSize})`,
		);
	}
	if (q.country) conds.push(containsCi(sql`lower(coalesce(${h.country}, '') || ' ' || coalesce(${h.location}, ''))`, q.country));
	if (q.organizer) conds.push(containsCi(sql`lower(coalesce(${h.organizer}, ''))`, q.organizer));

	if (viewer.userId) {
		if (q.saved) {
			conds.push(
				exists(
					db
						.select({ one: sql`1` })
						.from(bookmarks)
						.where(and(eq(bookmarks.hackathonId, h.id), eq(bookmarks.userId, viewer.userId))),
				),
			);
		}
		if (q.tracked) {
			conds.push(
				exists(
					db
						.select({ one: sql`1` })
						.from(userHackathonTracking)
						.where(and(eq(userHackathonTracking.hackathonId, h.id), eq(userHackathonTracking.userId, viewer.userId))),
				),
			);
		}
		if (q.mine) conds.push(eq(h.createdByUserId, viewer.userId));
	}

	return conds.filter((c): c is SQL => c !== undefined);
}

/** Text-match score plus overlap with the viewer's interests. Transparent and rule-based. */
function relevanceSql(db: Database, q: HackathonListQuery, viewer: Viewer): SQL {
	const parts: SQL[] = [sql`0`];
	for (const term of searchTerms(q.q)) {
		const like = "%" + escapeLike(term) + "%";
		parts.push(sql`(CASE WHEN lower(${h.title}) LIKE ${like} ESCAPE '\\' THEN 3 ELSE 0 END)`);
		parts.push(sql`(CASE WHEN lower(coalesce(${h.organizer}, '')) LIKE ${like} ESCAPE '\\' THEN 1 ELSE 0 END)`);
	}
	if (viewer.interests.length) {
		parts.push(sql`(CASE WHEN ${topicExists(db, viewer.interests)} THEN 2 ELSE 0 END)`);
	}
	return sql.join(parts, sql` + `);
}

function deadlineOrder(column: typeof h.registrationDeadlineAt | typeof h.eventStartAt, now: number): SQL[] {
	const NOW = num(now);
	// Upcoming first (soonest first), then past (most recent first), then unknown.
	return [
		sql`(CASE WHEN ${column} IS NULL THEN 2 WHEN ${column} <= ${NOW} THEN 1 ELSE 0 END) ASC`,
		sql`(CASE WHEN ${column} <= ${NOW} THEN -${column} ELSE ${column} END) ASC`,
	];
}

function orderFor(db: Database, q: HackathonListQuery, viewer: Viewer, now: number): SQL[] {
	switch (q.sort) {
		case "start":
			return [...deadlineOrder(h.eventStartAt, now), asc(h.id)];
		case "recent":
			return [desc(h.createdAt), asc(h.id)];
		case "verified":
			return [sql`${h.lastVerifiedAt} DESC NULLS LAST`, asc(h.id)];
		case "alpha":
			return [asc(h.normalizedTitle), asc(h.id)];
		case "relevance":
			return [sql`(${relevanceSql(db, q, viewer)}) DESC`, ...deadlineOrder(h.registrationDeadlineAt, now), asc(h.id)];
		case "prize": {
			// Only amounts in the selected currency are ranked; other currencies are
			// never compared as if they were equivalent and sort after, by deadline.
			const currency = q.prizeCurrency ?? "USD";
			return [
				sql`(CASE WHEN ${h.prizeCurrency} = ${currency} THEN ${h.prizeAmountMinor} END) DESC NULLS LAST`,
				...deadlineOrder(h.registrationDeadlineAt, now),
				asc(h.id),
			];
		}
		case "deadline":
		default:
			return [...deadlineOrder(h.registrationDeadlineAt, now), asc(h.id)];
	}
}

interface TagSet {
	topics: TopicId[];
	technologies: string[];
}

export async function loadTags(db: Database, ids: string[]): Promise<Map<string, TagSet>> {
	const map = new Map<string, TagSet>();
	for (const id of ids) map.set(id, { topics: [], technologies: [] });
	if (!ids.length) return map;
	const rows = await db
		.select({ hackathonId: hackathonTags.hackathonId, kind: tags.kind, slug: tags.slug, label: tags.label })
		.from(hackathonTags)
		.innerJoin(tags, eq(tags.id, hackathonTags.tagId))
		.where(inArray(hackathonTags.hackathonId, ids))
		.orderBy(asc(tags.label));
	for (const r of rows) {
		const set = map.get(r.hackathonId)!;
		if (r.kind === "topic") set.topics.push(r.slug as TopicId);
		else set.technologies.push(r.label);
	}
	return map;
}

export async function loadViewerState(db: Database, userId: string | null, ids: string[]): Promise<Map<string, HackathonViewerState>> {
	const map = new Map<string, HackathonViewerState>();
	if (!userId || !ids.length) return map;
	const [bms, trs] = await db.batch([
		db
			.select({ id: bookmarks.id, hackathonId: bookmarks.hackathonId })
			.from(bookmarks)
			.where(and(eq(bookmarks.userId, userId), inArray(bookmarks.hackathonId, ids))),
		db
			.select({
				id: userHackathonTracking.id,
				hackathonId: userHackathonTracking.hackathonId,
				status: userHackathonTracking.participationStatus,
				priority: userHackathonTracking.priority,
			})
			.from(userHackathonTracking)
			.where(and(eq(userHackathonTracking.userId, userId), inArray(userHackathonTracking.hackathonId, ids))),
	]);
	for (const id of ids) map.set(id, { bookmarked: false, bookmarkId: null, tracking: null });
	for (const b of bms) Object.assign(map.get(b.hackathonId)!, { bookmarked: true, bookmarkId: b.id });
	for (const t of trs) {
		map.get(t.hackathonId)!.tracking = { id: t.id, status: t.status as TrackingStatus, priority: t.priority as Priority };
	}
	return map;
}

function truncate(s: string | null, n: number): string | null {
	if (!s) return null;
	const flat = s.replace(/\s+/g, " ").trim();
	return flat.length > n ? flat.slice(0, n - 1).trimEnd() + "…" : flat;
}

export function toSummary(
	row: HackathonRow,
	registrationStatus: RegistrationStatus,
	eventStatus: EventStatus,
	tagSet: TagSet | undefined,
	viewerState: HackathonViewerState | undefined,
	viewerUserId: string | null,
): HackathonSummary {
	const feeCurrency = row.participationFeeCurrency;
	return {
		id: row.id,
		title: row.title,
		organizer: row.organizer,
		platform: row.primaryPlatformId as PlatformId,
		shortDescription: truncate(row.description, 280),
		canonicalUrl: row.canonicalUrl,
		registrationUrl: row.registrationUrl,
		coverImageUrl: row.coverImageUrl,
		registrationOpenAt: toIso(row.registrationOpenAt),
		registrationDeadlineAt: toIso(row.registrationDeadlineAt),
		eventStartAt: toIso(row.eventStartAt),
		eventEndAt: toIso(row.eventEndAt),
		eventTimezone: row.eventTimezone,
		participationMode: (row.participationMode as ParticipationMode | null) ?? null,
		location: row.location,
		country: row.country,
		topics: tagSet?.topics ?? [],
		technologies: tagSet?.technologies ?? [],
		prizeAmount: row.prizeAmountMinor !== null && row.prizeCurrency ? fromMinorUnits(row.prizeAmountMinor, row.prizeCurrency) : null,
		prizeCurrency: row.prizeCurrency,
		teamSizeMin: row.teamSizeMin,
		teamSizeMax: row.teamSizeMax,
		participationFeeAmount:
			row.participationFeeMinor === null ? null : row.participationFeeMinor === 0 ? 0 : fromMinorUnits(row.participationFeeMinor, feeCurrency ?? "USD"),
		participationFeeCurrency: feeCurrency,
		eligibilitySummary: row.eligibilitySummary,
		isStudentEligible: row.isStudentEligible,
		isBeginnerFriendly: row.isBeginnerFriendly,
		isInternational: row.isInternational,
		registrationStatus,
		eventStatus,
		sourceStatus: (row.sourceStatus as SourceStatus | null) ?? null,
		dataQuality: row.internalStatus as DataQualityStatus,
		lastVerifiedAt: toIso(row.lastVerifiedAt),
		lastCheckedAt: toIso(row.lastCheckedAt),
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
		isDemo: row.isDemo,
		visibility: row.visibility as Visibility,
		isOwner: viewerUserId !== null && row.createdByUserId === viewerUserId,
		publicationStatus: row.publicationStatus as PublicationStatus,
		viewer: viewerUserId ? (viewerState ?? { bookmarked: false, bookmarkId: null, tracking: null }) : null,
	};
}

export interface ListResult {
	items: HackathonSummary[];
	total: number;
}

export async function listHackathons(db: Database, q: HackathonListQuery, viewer: Viewer, now: number): Promise<ListResult> {
	const where = and(...buildListConditions(db, q, viewer, now));
	const [rows, countRows] = await db.batch([
		db
			.select({ row: h, registrationStatus: registrationStatusSql(now), eventStatus: eventStatusSql(now) })
			.from(h)
			.where(where)
			.orderBy(...orderFor(db, q, viewer, now))
			.limit(q.pageSize)
			.offset((q.page - 1) * q.pageSize),
		db.select({ total: sql<number>`count(*)` }).from(h).where(where),
	]);
	const items = await summarize(db, rows, viewer);
	return { items, total: Number(countRows[0]?.total ?? 0) };
}

type StatusRow = { row: HackathonRow; registrationStatus: RegistrationStatus; eventStatus: EventStatus };

export async function summarize(db: Database, rows: StatusRow[], viewer: Viewer): Promise<HackathonSummary[]> {
	const ids = rows.map((r) => r.row.id);
	const [tagMap, viewerMap] = await Promise.all([loadTags(db, ids), loadViewerState(db, viewer.userId, ids)]);
	return rows.map((r) => toSummary(r.row, r.registrationStatus, r.eventStatus, tagMap.get(r.row.id), viewerMap.get(r.row.id), viewer.userId));
}

/** Fetch summaries for specific ids the viewer is allowed to see, preserving the given order. */
export async function getSummariesByIds(db: Database, ids: string[], viewer: Viewer, now: number): Promise<Map<string, HackathonSummary>> {
	const out = new Map<string, HackathonSummary>();
	for (let i = 0; i < ids.length; i += 80) {
		const chunk = ids.slice(i, i + 80);
		const rows = await db
			.select({ row: h, registrationStatus: registrationStatusSql(now), eventStatus: eventStatusSql(now) })
			.from(h)
			.where(and(visibleTo(viewer), inArray(h.id, chunk)));
		for (const s of await summarize(db, rows, viewer)) out.set(s.id, s);
	}
	return out;
}

/** Row lookup honouring visibility. Returns null when missing *or* not visible (no existence leak). */
export async function getVisibleRow(db: Database, id: string, viewer: Viewer): Promise<HackathonRow | null> {
	const rows = await db
		.select()
		.from(h)
		.where(and(eq(h.id, id), visibleTo(viewer)))
		.limit(1);
	return rows[0] ?? null;
}

export async function getHackathonDetail(
	db: Database,
	id: string,
	viewer: Viewer,
	now: number,
	/** Override the visibility rule (admin review of pending submissions). */
	visibility: SQL = visibleTo(viewer),
): Promise<HackathonDetail | null> {
	const rows = await db
		.select({ row: h, registrationStatus: registrationStatusSql(now), eventStatus: eventStatusSql(now) })
		.from(h)
		.where(and(eq(h.id, id), visibility))
		.limit(1);
	if (!rows[0]) return null;
	const [summary] = await summarize(db, rows, viewer);
	const row = rows[0].row;
	const sources = await db.select().from(hackathonSources).where(eq(hackathonSources.hackathonId, id)).orderBy(asc(hackathonSources.createdAt));

	let viewerDetail: HackathonDetail["viewerDetail"] = null;
	if (viewer.userId) {
		const [tr, bm, cols] = await db.batch([
			db
				.select({ notes: userHackathonTracking.personalNotes, team: userHackathonTracking.teamName })
				.from(userHackathonTracking)
				.where(and(eq(userHackathonTracking.userId, viewer.userId), eq(userHackathonTracking.hackathonId, id))),
			db
				.select({ note: bookmarks.note })
				.from(bookmarks)
				.where(and(eq(bookmarks.userId, viewer.userId), eq(bookmarks.hackathonId, id))),
			db
				.select({ id: collections.id })
				.from(collectionItems)
				.innerJoin(collections, eq(collections.id, collectionItems.collectionId))
				.where(and(eq(collections.userId, viewer.userId), eq(collectionItems.hackathonId, id))),
		]);
		viewerDetail = {
			personalNotes: tr[0]?.notes ?? null,
			teamName: tr[0]?.team ?? null,
			bookmarkNote: bm[0]?.note ?? null,
			collectionIds: cols.map((c) => c.id),
		};
	}

	const sourceLinks: HackathonSourceLink[] = sources.map((s) => ({
		id: s.id,
		platform: s.platformId as PlatformId,
		externalEventId: s.externalEventId,
		sourceEventUrl: s.sourceEventUrl,
		sourceRegistrationUrl: s.sourceRegistrationUrl,
		sourceUpdatedAt: toIso(s.sourceUpdatedAt),
		lastCheckedAt: toIso(s.lastCheckedAt),
	}));

	const stored = parseJsonArray<string>(row.contradictions);
	const live = findContradictions(datedEvent(row), now);
	return {
		...summary,
		description: row.description,
		prizeDetails: row.prizeDetails,
		eligibilityDetails: row.eligibilityDetails,
		additionalNotes: row.additionalNotes,
		contradictions: [...new Set([...stored, ...live])],
		sources: sourceLinks,
		reviewNote: summary.isOwner || viewer.isAdmin ? row.reviewNote : null,
		viewerDetail,
	};
}

// ---------------------------------------------------------------------------
// Writes. Note: drizzle's D1 batch() cannot execute raw db.run(sql) statements
// that have bound parameters, so everything placed in a batch uses the query
// builder. Tags are rebuilt with INSERT ... SELECT so that a whole hackathon
// save (row + tags + source link) fits in one atomic D1 batch.
// ---------------------------------------------------------------------------

export function tagStatements(db: Database, hackathonId: string, topics: TopicId[], technologies: string[]): BatchItem<"sqlite">[] {
	const wanted = new Map<string, { kind: string; slug: string; label: string }>();
	for (const t of topics) wanted.set(`topic:${t}`, { kind: "topic", slug: t, label: TOPIC_LABELS[t] });
	for (const raw of technologies) {
		const tech = normalizeTechnology(raw);
		wanted.set(`technology:${tech.slug}`, { kind: "technology", ...tech });
	}
	const stmts: BatchItem<"sqlite">[] = [db.delete(hackathonTags).where(eq(hackathonTags.hackathonId, hackathonId))];
	if (wanted.size) {
		stmts.push(db.insert(tags).values([...wanted.values()]).onConflictDoNothing());
		for (const t of wanted.values()) {
			// INSERT ... SELECT resolves the tag id inside the same atomic batch.
			stmts.push(
				db
					.insert(hackathonTags)
					.select(
						db
							.select({ hackathonId: sql<string>`${hackathonId}`.as("hackathon_id"), tagId: tags.id })
							.from(tags)
							.where(and(eq(tags.kind, t.kind), eq(tags.slug, t.slug))),
					)
					.onConflictDoNothing(),
			);
		}
	}
	return stmts;
}

export async function runBatch(db: Database, stmts: BatchItem<"sqlite">[]) {
	if (!stmts.length) return [];
	return db.batch(stmts as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
}

// ---------------------------------------------------------------------------
// Dashboard statistics — derived from D1, never hard-coded.
// ---------------------------------------------------------------------------

export async function dashboardCounts(db: Database, viewer: Viewer, now: number) {
	const reg = registrationStatusSql(now);
	const ev = eventStatusSql(now);
	const NOW = num(now);
	const in7 = num(now + 7 * DAY_MS);
	const where = and(visibleTo(viewer), viewer.showDemo ? undefined : eq(h.isDemo, false));
	const [row] = await db
		.select({
			total: sql<number>`count(*)`,
			upcoming: sql<number>`coalesce(sum(CASE WHEN ${ev} = 'upcoming' THEN 1 ELSE 0 END), 0)`,
			ongoing: sql<number>`coalesce(sum(CASE WHEN ${ev} = 'ongoing' THEN 1 ELSE 0 END), 0)`,
			registrationOpen: sql<number>`coalesce(sum(CASE WHEN ${reg} IN ('open','closing_soon') THEN 1 ELSE 0 END), 0)`,
			next7: sql<number>`coalesce(sum(CASE WHEN ${h.registrationDeadlineAt} > ${NOW} AND ${h.registrationDeadlineAt} <= ${in7} THEN 1 ELSE 0 END), 0)`,
			demo: sql<number>`coalesce(sum(CASE WHEN ${h.isDemo} = 1 THEN 1 ELSE 0 END), 0)`,
		})
		.from(h)
		.where(where);

	let saved: number | null = null;
	let registered: number | null = null;
	if (viewer.userId) {
		const [s, r] = await db.batch([
			db
				.select({ n: sql<number>`count(*)` })
				.from(bookmarks)
				.innerJoin(h, eq(h.id, bookmarks.hackathonId))
				.where(and(eq(bookmarks.userId, viewer.userId), where)),
			db
				.select({ n: sql<number>`count(*)` })
				.from(userHackathonTracking)
				.innerJoin(h, eq(h.id, userHackathonTracking.hackathonId))
				.where(
					and(
						eq(userHackathonTracking.userId, viewer.userId),
						inArray(userHackathonTracking.participationStatus, REGISTERED_TRACKING_STATUSES),
						where,
					),
				),
		]);
		saved = Number(s[0]?.n ?? 0);
		registered = Number(r[0]?.n ?? 0);
	}
	return {
		upcoming: Number(row?.upcoming ?? 0),
		registrationOpen: Number(row?.registrationOpen ?? 0),
		deadlinesNext7Days: Number(row?.next7 ?? 0),
		ongoing: Number(row?.ongoing ?? 0),
		saved,
		registered,
		demoEventCount: Number(row?.demo ?? 0),
		totalVisibleEvents: Number(row?.total ?? 0),
		generatedAt: new Date(now).toISOString(),
	};
}

