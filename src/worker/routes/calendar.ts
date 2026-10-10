// Calendar entries, ICS export and personal preparation milestones.
import { Hono } from "hono";
import { and, asc, eq, gte, inArray, lte, or } from "drizzle-orm";
import { z } from "zod";
import type { AppEnv } from "../env";
import { currentUserId, requireUser, viewerFor } from "../middleware/authentication";
import { validate } from "../middleware/validation";
import { isoDateTimeSchema, milestoneCreateSchema, milestoneUpdateSchema } from "@shared/schemas";
import { DAY_MS, type CalendarEntryKind, type PlatformId } from "@shared/constants";
import type { CalendarEntry, MilestoneRecord } from "@shared/types";
import { bookmarks, hackathons as h, milestones, userHackathonTracking } from "../db/schema";
import { getVisibleRow, visibleTo } from "../db/queries/hackathons";
import { badRequest, created, notFound, ok, toIso } from "../lib/http";
import { buildIcs, hackathonToIcsEvents, type IcsEvent, type IcsKind } from "../services/calendar-export";
import { activityInsert } from "../services/activity";

export const calendarRoutes = new Hono<AppEnv>();

const rangeQuery = z
	.object({
		from: isoDateTimeSchema,
		to: isoDateTimeSchema,
		scope: z.enum(["mine", "all"]).default("all"),
	})
	.refine((v) => Date.parse(v.to) > Date.parse(v.from), "`to` must be after `from`")
	.refine((v) => Date.parse(v.to) - Date.parse(v.from) <= 100 * DAY_MS, "Range is limited to 100 days");

calendarRoutes.get("/", validate("query", rangeQuery), async (c) => {
	const { from, to, scope } = c.req.valid("query");
	const viewer = await viewerFor(c);
	if (scope === "mine" && !viewer.userId) throw badRequest("Sign in to see your own calendar");
	const fromD = new Date(from);
	const toD = new Date(to);
	const db = c.var.db;
	const within = (col: typeof h.registrationDeadlineAt) => and(gte(col, fromD), lte(col, toD));
	const mineCond = viewer.userId
		? or(
				eq(h.createdByUserId, viewer.userId),
				inArray(h.id, db.select({ id: bookmarks.hackathonId }).from(bookmarks).where(eq(bookmarks.userId, viewer.userId))),
				inArray(
					h.id,
					db.select({ id: userHackathonTracking.hackathonId }).from(userHackathonTracking).where(eq(userHackathonTracking.userId, viewer.userId)),
				),
			)
		: undefined;
	const rows = await db
		.select({
			id: h.id,
			title: h.title,
			platform: h.primaryPlatformId,
			isDemo: h.isDemo,
			tz: h.eventTimezone,
			open: h.registrationOpenAt,
			deadline: h.registrationDeadlineAt,
			start: h.eventStartAt,
			end: h.eventEndAt,
		})
		.from(h)
		.where(
			and(
				visibleTo(viewer),
				viewer.showDemo ? undefined : eq(h.isDemo, false),
				scope === "mine" ? mineCond : undefined,
				or(within(h.registrationOpenAt), within(h.registrationDeadlineAt), within(h.eventStartAt), within(h.eventEndAt)),
			),
		)
		.limit(1000);

	const entries: CalendarEntry[] = [];
	const push = (r: (typeof rows)[number], kind: CalendarEntryKind, at: Date | null) => {
		if (!at || at < fromD || at > toD) return;
		entries.push({ id: `${r.id}:${kind}`, kind, at: at.toISOString(), title: r.title, hackathonId: r.id, milestoneId: null, platform: r.platform as PlatformId, isDemo: r.isDemo, eventTimezone: r.tz });
	};
	for (const r of rows) {
		push(r, "registration_open", r.open);
		push(r, "registration_deadline", r.deadline);
		push(r, "event_start", r.start);
		push(r, "event_end", r.end);
	}
	if (viewer.userId) {
		const ms = await db
			.select({ m: milestones, title: h.title })
			.from(milestones)
			.leftJoin(h, eq(h.id, milestones.hackathonId))
			.where(and(eq(milestones.userId, viewer.userId), gte(milestones.dueAt, fromD), lte(milestones.dueAt, toD)));
		for (const { m } of ms) {
			entries.push({ id: `milestone:${m.id}`, kind: "milestone", at: m.dueAt.toISOString(), title: m.title, hackathonId: m.hackathonId, milestoneId: m.id, platform: null, isDemo: false, eventTimezone: null });
		}
	}
	entries.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
	return ok(c, entries, { from, to, scope });
});

const exportSchema = z.object({
	entries: z
		.array(
			z.object({
				hackathonId: z.string().max(64),
				kinds: z.array(z.enum(["registration_open", "registration_deadline", "event"])).min(1),
			}),
		)
		.max(200)
		.default([]),
	milestoneIds: z.array(z.string().max(64)).max(200).default([]),
});

calendarRoutes.post("/export.ics", validate("json", exportSchema), async (c) => {
	const { entries, milestoneIds } = c.req.valid("json");
	if (!entries.length && !milestoneIds.length) throw badRequest("Select at least one calendar entry to export");
	const viewer = await viewerFor(c);
	const db = c.var.db;
	const events: IcsEvent[] = [];
	const ids = [...new Set(entries.map((e) => e.hackathonId))];
	for (let i = 0; i < ids.length; i += 80) {
		const rows = await db
			.select()
			.from(h)
			.where(and(visibleTo(viewer), inArray(h.id, ids.slice(i, i + 80))));
		for (const row of rows) {
			const kinds = new Set(entries.filter((e) => e.hackathonId === row.id).flatMap((e) => e.kinds)) as Set<IcsKind>;
			events.push(...hackathonToIcsEvents(row, [...kinds]));
		}
	}
	if (milestoneIds.length && viewer.userId) {
		const rows = await db
			.select()
			.from(milestones)
			.where(and(eq(milestones.userId, viewer.userId), inArray(milestones.id, milestoneIds.slice(0, 90))));
		for (const m of rows) events.push({ uid: `milestone-${m.id}`, start: m.dueAt, summary: `Milestone: ${m.title}`, description: m.notes, alarmMinutesBefore: 60 });
	}
	if (!events.length) throw badRequest("None of the selected entries have dates you can export");
	return c.body(buildIcs(events, "HackRadar deadlines"), 200, {
		"Content-Type": "text/calendar; charset=utf-8",
		"Content-Disposition": 'attachment; filename="hackradar-calendar.ics"',
	});
});

// ---------------------------------------------------------------------------
// Milestones: /api/me/milestones
// ---------------------------------------------------------------------------

export const milestoneRoutes = new Hono<AppEnv>();
milestoneRoutes.use("*", requireUser);

function toMilestone(m: typeof milestones.$inferSelect, hackathonTitle: string | null): MilestoneRecord {
	return {
		id: m.id,
		title: m.title,
		dueAt: m.dueAt.toISOString(),
		notes: m.notes,
		completedAt: toIso(m.completedAt),
		hackathonId: m.hackathonId,
		hackathonTitle,
	};
}

milestoneRoutes.get("/", validate("query", z.object({ hackathonId: z.string().max(64).optional() })), async (c) => {
	const userId = currentUserId(c);
	const { hackathonId } = c.req.valid("query");
	const rows = await c.var.db
		.select({ m: milestones, title: h.title })
		.from(milestones)
		.leftJoin(h, eq(h.id, milestones.hackathonId))
		.where(and(eq(milestones.userId, userId), hackathonId ? eq(milestones.hackathonId, hackathonId) : undefined))
		.orderBy(asc(milestones.dueAt))
		.limit(500);
	return ok(c, rows.map((r) => toMilestone(r.m, r.title)));
});

milestoneRoutes.post("/", validate("json", milestoneCreateSchema), async (c) => {
	const userId = currentUserId(c);
	const body = c.req.valid("json");
	let title: string | null = null;
	if (body.hackathonId) {
		const row = await getVisibleRow(c.var.db, body.hackathonId, await viewerFor(c));
		if (!row) throw notFound("Hackathon");
		title = row.title;
	}
	const [m] = await c.var.db
		.insert(milestones)
		.values({ userId, hackathonId: body.hackathonId, title: body.title, dueAt: new Date(body.dueAt), notes: body.notes })
		.returning();
	await activityInsert(c.var.db, userId, "milestone_created", body.hackathonId, { title: body.title });
	return created(c, toMilestone(m, title));
});

milestoneRoutes.patch("/:id", validate("json", milestoneUpdateSchema), async (c) => {
	const userId = currentUserId(c);
	const body = c.req.valid("json");
	const set: Partial<typeof milestones.$inferInsert> = { updatedAt: new Date() };
	if (body.title !== undefined) set.title = body.title;
	if (body.dueAt !== undefined) set.dueAt = new Date(body.dueAt);
	if (body.notes !== undefined) set.notes = body.notes;
	if (body.completed !== undefined) set.completedAt = body.completed ? new Date() : null;
	const [m] = await c.var.db
		.update(milestones)
		.set(set)
		.where(and(eq(milestones.id, c.req.param("id")), eq(milestones.userId, userId)))
		.returning();
	if (!m) throw notFound("Milestone");
	return ok(c, toMilestone(m, null));
});

milestoneRoutes.delete("/:id", async (c) => {
	const userId = currentUserId(c);
	const [m] = await c.var.db
		.delete(milestones)
		.where(and(eq(milestones.id, c.req.param("id")), eq(milestones.userId, userId)))
		.returning({ id: milestones.id });
	if (!m) throw notFound("Milestone");
	return ok(c, { deleted: true });
});

