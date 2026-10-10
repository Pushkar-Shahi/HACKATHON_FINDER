// Personal tracker: /api/me/tracking. Every query is scoped to the signed-in
// user's id, so one user can never read or change another user's records.
import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { AppEnv } from "../env";
import { currentUserId, requireUser, viewerFor } from "../middleware/authentication";
import { validate } from "../middleware/validation";
import { trackingCreateSchema, trackingUpdateSchema } from "@shared/schemas";
import { TRACKING_STATUSES, type Priority, type TrackingStatus } from "@shared/constants";
import type { TrackingRecord } from "@shared/types";
import { userHackathonTracking } from "../db/schema";
import { getSummariesByIds, getVisibleRow } from "../db/queries/hackathons";
import { conflict, created, notFound, ok } from "../lib/http";
import { activityInsert } from "../services/activity";
import { scheduleReminders } from "../services/reminders";

export const trackerRoutes = new Hono<AppEnv>();
trackerRoutes.use("*", requireUser);

const listQuery = z.object({
	status: z
		.string()
		.optional()
		.transform((s) => (s ? s.split(",").filter(Boolean) : []))
		.pipe(z.array(z.enum(TRACKING_STATUSES))),
	q: z.string().trim().max(200).optional(),
	sort: z.enum(["deadline", "start", "priority", "updated"]).default("deadline"),
});

const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };
const far = Number.MAX_SAFE_INTEGER;

trackerRoutes.get("/", validate("query", listQuery), async (c) => {
	const userId = currentUserId(c);
	const { status, q, sort } = c.req.valid("query");
	const rows = await c.var.db.select().from(userHackathonTracking).where(eq(userHackathonTracking.userId, userId)).limit(1000);
	const summaries = await getSummariesByIds(c.var.db, rows.map((r) => r.hackathonId), await viewerFor(c), Date.now());
	const needle = q?.toLowerCase();
	const now = Date.now();
	const upcomingFirst = (iso: string | null) => {
		if (!iso) return far;
		const t = Date.parse(iso);
		return t < now ? far / 2 + (now - t) : t;
	};
	let records: TrackingRecord[] = rows
		.filter((r) => summaries.has(r.hackathonId))
		.map((r) => ({
			id: r.id,
			hackathonId: r.hackathonId,
			status: r.participationStatus as TrackingStatus,
			priority: r.priority as Priority,
			personalNotes: r.personalNotes,
			teamName: r.teamName,
			createdAt: r.createdAt.toISOString(),
			updatedAt: r.updatedAt.toISOString(),
			hackathon: summaries.get(r.hackathonId)!,
		}));
	if (status.length) records = records.filter((r) => status.includes(r.status));
	if (needle) {
		records = records.filter((r) =>
			[r.hackathon.title, r.hackathon.organizer, r.personalNotes, r.teamName].some((v) => v?.toLowerCase().includes(needle)),
		);
	}
	records.sort((a, b) => {
		if (sort === "start") return upcomingFirst(a.hackathon.eventStartAt) - upcomingFirst(b.hackathon.eventStartAt);
		if (sort === "priority") return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || upcomingFirst(a.hackathon.registrationDeadlineAt) - upcomingFirst(b.hackathon.registrationDeadlineAt);
		if (sort === "updated") return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
		return upcomingFirst(a.hackathon.registrationDeadlineAt) - upcomingFirst(b.hackathon.registrationDeadlineAt);
	});
	return ok(c, records, { total: records.length });
});

trackerRoutes.post("/", validate("json", trackingCreateSchema), async (c) => {
	const userId = currentUserId(c);
	const body = c.req.valid("json");
	const row = await getVisibleRow(c.var.db, body.hackathonId, await viewerFor(c));
	if (!row) throw notFound("Hackathon");
	const id = crypto.randomUUID();
	const [inserted] = await c.var.db
		.insert(userHackathonTracking)
		.values({ id, userId, hackathonId: row.id, participationStatus: body.status, priority: body.priority, personalNotes: body.personalNotes, teamName: body.teamName })
		.onConflictDoNothing()
		.returning();
	if (!inserted) throw conflict("This hackathon is already in your tracker");
	await activityInsert(c.var.db, userId, "tracking_added", row.id, { status: body.status, title: row.title });
	await scheduleReminders(c.var.db, Date.now(), { userId, hackathonId: row.id });
	return created(c, { id: inserted.id, status: inserted.participationStatus, priority: inserted.priority });
});

trackerRoutes.patch("/:id", validate("json", trackingUpdateSchema), async (c) => {
	const userId = currentUserId(c);
	const body = c.req.valid("json");
	const [existing] = await c.var.db
		.select()
		.from(userHackathonTracking)
		.where(and(eq(userHackathonTracking.id, c.req.param("id")), eq(userHackathonTracking.userId, userId)));
	if (!existing) throw notFound("Tracker record");
	const set: Partial<typeof userHackathonTracking.$inferInsert> = {};
	if (body.status !== undefined) set.participationStatus = body.status;
	if (body.priority !== undefined) set.priority = body.priority;
	if (body.personalNotes !== undefined) set.personalNotes = body.personalNotes;
	if (body.teamName !== undefined) set.teamName = body.teamName;
	const db = c.var.db;
	const activity = [];
	if (body.status !== undefined && body.status !== existing.participationStatus) {
		activity.push(activityInsert(db, userId, "tracking_status_changed", existing.hackathonId, { from: existing.participationStatus, to: body.status }));
	}
	if (body.priority !== undefined && body.priority !== existing.priority) {
		activity.push(activityInsert(db, userId, "tracking_priority_changed", existing.hackathonId, { to: body.priority }));
	}
	if (body.personalNotes !== undefined && body.personalNotes !== existing.personalNotes) {
		activity.push(activityInsert(db, userId, "tracking_notes_updated", existing.hackathonId, {}));
	}
	await db.batch([
		db
			.update(userHackathonTracking)
			.set({ ...set, updatedAt: new Date() })
			.where(and(eq(userHackathonTracking.id, existing.id), eq(userHackathonTracking.userId, userId))),
		...activity,
	]);
	if (body.status !== undefined) await scheduleReminders(db, Date.now(), { userId, hackathonId: existing.hackathonId });
	return ok(c, { id: existing.id, ...set });
});

trackerRoutes.delete("/:id", async (c) => {
	const userId = currentUserId(c);
	const [deleted] = await c.var.db
		.delete(userHackathonTracking)
		.where(and(eq(userHackathonTracking.id, c.req.param("id")), eq(userHackathonTracking.userId, userId)))
		.returning();
	if (!deleted) throw notFound("Tracker record");
	await activityInsert(c.var.db, userId, "tracking_removed", deleted.hackathonId, {});
	await scheduleReminders(c.var.db, Date.now(), { userId, hackathonId: deleted.hackathonId });
	return ok(c, { deleted: true });
});


