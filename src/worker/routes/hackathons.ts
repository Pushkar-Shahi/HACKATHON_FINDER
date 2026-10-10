// Discovery routes (anonymous browsing allowed) and the user's own events
// (manual entry, edits, publication requests, CSV import/export).
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { AppEnv } from "../env";
import { currentUserId, requireUser, viewerFor } from "../middleware/authentication";
import { validate } from "../middleware/validation";
import { rateLimit } from "../middleware/security";
import {
	csvImportSchema,
	hackathonInputSchema,
	hackathonListQuerySchema,
	httpUrlSchema,
	publicationRequestSchema,
} from "@shared/schemas";
import { MAX_CSV_BYTES } from "@shared/constants";
import { badRequest, conflict, created, forbidden, HttpError, notFound, ok } from "../lib/http";
import { getHackathonDetail, getSummariesByIds, getVisibleRow, listHackathons, runBatch } from "../db/queries/hackathons";
import { bookmarks, hackathons, userHackathonTracking } from "../db/schema";
import { createHackathon, createHackathonStatements, updateHackathon } from "../services/hackathon-writer";
import { canonicalUrlKey, normalizeTitle } from "../services/event-normalizer";
import { findDuplicates } from "../services/deduplication";
import { activityInsert } from "../services/activity";
import { buildIcs, hackathonToIcsEvents, type IcsKind } from "../services/calendar-export";
import { CsvParseError, hackathonsToCsv, prepareImport } from "../services/csv";
import { scheduleReminders } from "../services/reminders";
import type { BatchItem } from "drizzle-orm/batch";

const jsonLimit = bodyLimit({
	maxSize: 64 * 1024,
	onError: (c) => c.json({ error: { code: "payload_too_large", message: "Request body is too large" } }, 413),
});
const csvLimit = bodyLimit({
	maxSize: MAX_CSV_BYTES + 64 * 1024,
	onError: (c) => c.json({ error: { code: "payload_too_large", message: "CSV files are limited to 1 MB" } }, 413),
});

// ---------------------------------------------------------------------------
// Public discovery: /api/hackathons
// ---------------------------------------------------------------------------

export const hackathonRoutes = new Hono<AppEnv>();

hackathonRoutes.get("/", validate("query", hackathonListQuerySchema), async (c) => {
	const q = c.req.valid("query");
	if ((q.saved || q.tracked || q.mine) && !c.var.user) {
		throw new HttpError(401, "unauthorized", "Sign in to filter by your saved or tracked events");
	}
	if (q.minPrize !== undefined && !q.prizeCurrency) {
		throw badRequest("Choose a currency for the minimum prize filter", { prizeCurrency: ["Required with minPrize"] });
	}
	const viewer = await viewerFor(c);
	const now = Date.now();
	const { items, total } = await listHackathons(c.var.db, q, viewer, now);
	return ok(c, items, {
		page: q.page,
		pageSize: q.pageSize,
		total,
		totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
		generatedAt: new Date(now).toISOString(),
		prizeSortCurrency: q.sort === "prize" ? (q.prizeCurrency ?? "USD") : undefined,
	});
});

hackathonRoutes.get("/:id", async (c) => {
	const viewer = await viewerFor(c);
	const detail = await getHackathonDetail(c.var.db, c.req.param("id"), viewer, Date.now());
	if (!detail) throw notFound("Hackathon");
	return ok(c, detail);
});

const icsQuery = z.object({
	kinds: z
		.string()
		.optional()
		.transform((s) => (s ? s.split(",") : ["registration_open", "registration_deadline", "event"]))
		.pipe(z.array(z.enum(["registration_open", "registration_deadline", "event"])).min(1)),
});

hackathonRoutes.get("/:id/calendar.ics", validate("query", icsQuery), async (c) => {
	const viewer = await viewerFor(c);
	const row = await getVisibleRow(c.var.db, c.req.param("id"), viewer);
	if (!row) throw notFound("Hackathon");
	const events = hackathonToIcsEvents(row, c.req.valid("query").kinds as IcsKind[]);
	if (!events.length) throw badRequest("This event has no verified dates to export");
	const filename = `${row.normalizedTitle.replace(/\s+/g, "-").slice(0, 60) || "hackathon"}.ics`;
	return c.body(buildIcs(events, row.title), 200, {
		"Content-Type": "text/calendar; charset=utf-8",
		"Content-Disposition": `attachment; filename="${filename}"`,
	});
});

const duplicateCheckSchema = z.object({
	title: z.string().trim().min(1).max(200),
	canonicalUrl: httpUrlSchema,
	organizer: z.string().max(200).nullish(),
	eventStartAt: z.iso.datetime({ offset: true }).nullish(),
	registrationDeadlineAt: z.iso.datetime({ offset: true }).nullish(),
	excludeId: z.string().max(64).optional(),
});

/** Used by the Add/Edit form to warn about likely duplicates before saving. */
hackathonRoutes.post("/check-duplicates", requireUser, jsonLimit, validate("json", duplicateCheckSchema), async (c) => {
	const body = c.req.valid("json");
	const matches = await findDuplicates(
		c.var.db,
		{
			canonicalUrlKey: canonicalUrlKey(body.canonicalUrl),
			normalizedTitle: normalizeTitle(body.title),
			organizer: body.organizer ?? null,
			eventStartAt: body.eventStartAt ? Date.parse(body.eventStartAt) : null,
			registrationDeadlineAt: body.registrationDeadlineAt ? Date.parse(body.registrationDeadlineAt) : null,
		},
		{ userId: currentUserId(c), excludeId: body.excludeId },
	);
	return ok(c, matches);
});

// ---------------------------------------------------------------------------
// The user's own events: /api/me/events
// ---------------------------------------------------------------------------

export const myEventRoutes = new Hono<AppEnv>();
myEventRoutes.use("*", requireUser);

async function getOwnedEvent(c: Parameters<typeof currentUserId>[0], id: string) {
	const [row] = await c.var.db
		.select()
		.from(hackathons)
		.where(and(eq(hackathons.id, id), eq(hackathons.createdByUserId, currentUserId(c))));
	if (!row) throw notFound("Event");
	return row;
}

function assertOwnerEditable(row: typeof hackathons.$inferSelect) {
	// Once an event is part of the shared feed, only administrators may change it.
	if (row.visibility === "public") throw forbidden("This event is published in the shared feed; only administrators can change it.");
}

myEventRoutes.post("/", jsonLimit, rateLimit("event_create", 60, 3600), validate("json", hackathonInputSchema), async (c) => {
	const userId = currentUserId(c);
	const input = c.req.valid("json");
	const id = crypto.randomUUID();
	await createHackathon(c.var.db, input, { id, ownerId: userId, visibility: "private" }, [
		activityInsert(c.var.db, userId, "event_created", id, { title: input.title }),
	]);
	const detail = await getHackathonDetail(c.var.db, id, await viewerFor(c), Date.now());
	return created(c, detail);
});

myEventRoutes.put("/:id", jsonLimit, validate("json", hackathonInputSchema), async (c) => {
	const userId = currentUserId(c);
	const row = await getOwnedEvent(c, c.req.param("id"));
	assertOwnerEditable(row);
	const input = c.req.valid("json");
	const changes = await updateHackathon(c.var.db, row, input, { changedBy: "owner", changedByUserId: userId }, [
		activityInsert(c.var.db, userId, "event_updated", row.id, { title: input.title }),
	]);
	if (changes.some((ch) => ch.field === "registrationDeadlineAt")) {
		await scheduleReminders(c.var.db, Date.now(), { hackathonId: row.id });
	}
	return ok(c, await getHackathonDetail(c.var.db, row.id, await viewerFor(c), Date.now()));
});

myEventRoutes.delete("/:id", async (c) => {
	const userId = currentUserId(c);
	const row = await getOwnedEvent(c, c.req.param("id"));
	assertOwnerEditable(row);
	await c.var.db.batch([
		activityInsert(c.var.db, userId, "event_deleted", null, { title: row.title }),
		c.var.db.delete(hackathons).where(eq(hackathons.id, row.id)),
	]);
	return ok(c, { deleted: true });
});

/** Ask administrators to publish a private event into the shared discovery feed. */
myEventRoutes.post("/:id/publication", jsonLimit, validate("json", publicationRequestSchema), async (c) => {
	const userId = currentUserId(c);
	const row = await getOwnedEvent(c, c.req.param("id"));
	assertOwnerEditable(row);
	if (row.publicationStatus === "pending") throw conflict("A publication request is already pending");
	await c.var.db.batch([
		c.var.db
			.update(hackathons)
			.set({ publicationStatus: "pending", reviewNote: c.req.valid("json").note })
			.where(eq(hackathons.id, row.id)),
		activityInsert(c.var.db, userId, "publication_requested", row.id, { title: row.title }),
	]);
	return ok(c, { publicationStatus: "pending" });
});

myEventRoutes.delete("/:id/publication", async (c) => {
	const row = await getOwnedEvent(c, c.req.param("id"));
	if (row.publicationStatus !== "pending") throw conflict("There is no pending publication request");
	await c.var.db.update(hackathons).set({ publicationStatus: "none", reviewNote: null }).where(eq(hackathons.id, row.id));
	return ok(c, { publicationStatus: "none" });
});

myEventRoutes.post("/import/preview", csvLimit, rateLimit("csv_preview", 30, 3600), validate("json", csvImportSchema), async (c) => {
	try {
		const { preview } = await prepareImport(c.var.db, c.req.valid("json").csv, currentUserId(c));
		return ok(c, preview);
	} catch (err) {
		if (err instanceof CsvParseError) throw badRequest(err.message, { csv: [err.message] });
		throw err;
	}
});

myEventRoutes.post("/import", csvLimit, rateLimit("csv_import", 10, 3600), validate("json", csvImportSchema), async (c) => {
	const userId = currentUserId(c);
	const { csv, rows } = c.req.valid("json");
	if (!rows?.length) throw badRequest("Select at least one row to import", { rows: ["Required"] });
	let prepared;
	try {
		prepared = await prepareImport(c.var.db, csv, userId);
	} catch (err) {
		if (err instanceof CsvParseError) throw badRequest(err.message, { csv: [err.message] });
		throw err;
	}
	const selected = [...new Set(rows)];
	const invalid = selected.filter((r) => !prepared.inputs.has(r));
	if (invalid.length) {
		throw badRequest(`Rows ${invalid.slice(0, 10).join(", ")} are invalid and cannot be imported`, { rows: invalid.map(String) });
	}
	const stmts: BatchItem<"sqlite">[] = [];
	const createdIds: string[] = [];
	for (const r of selected) {
		const { id, stmts: s } = createHackathonStatements(c.var.db, prepared.inputs.get(r)!, { ownerId: userId, visibility: "private" });
		createdIds.push(id);
		stmts.push(...s);
	}
	stmts.push(activityInsert(c.var.db, userId, "events_imported", null, { count: createdIds.length }));
	// One batch = one transaction: all selected rows are created, or none are.
	await runBatch(c.var.db, stmts);
	return created(c, { imported: createdIds.length, skipped: prepared.preview.totalRows - createdIds.length, createdIds });
});

const exportQuery = z.object({ scope: z.enum(["mine", "saved", "tracked"]).default("mine") });

myEventRoutes.get("/export.csv", validate("query", exportQuery), async (c) => {
	const userId = currentUserId(c);
	const { scope } = c.req.valid("query");
	const viewer = await viewerFor(c);
	const now = Date.now();
	const db = c.var.db;
	let ids: string[] = [];
	const extras = new Map<string, { status?: string; priority?: string; personalNotes?: string | null; teamName?: string | null }>();
	if (scope === "mine") {
		ids = (await db.select({ id: hackathons.id }).from(hackathons).where(eq(hackathons.createdByUserId, userId)).limit(2000)).map((r) => r.id);
	} else if (scope === "saved") {
		ids = (await db.select({ id: bookmarks.hackathonId }).from(bookmarks).where(eq(bookmarks.userId, userId)).limit(2000)).map((r) => r.id);
	} else {
		const rows = await db.select().from(userHackathonTracking).where(eq(userHackathonTracking.userId, userId)).limit(2000);
		ids = rows.map((r) => r.hackathonId);
		for (const r of rows) extras.set(r.hackathonId, { status: r.participationStatus, priority: r.priority, personalNotes: r.personalNotes, teamName: r.teamName });
	}
	const summaries = await getSummariesByIds(db, ids, viewer, now);
	const descriptions = new Map<string, string | null>();
	for (let i = 0; i < ids.length; i += 80) {
		const chunk = ids.slice(i, i + 80);
		if (!chunk.length) continue;
		for (const r of await db.select({ id: hackathons.id, d: hackathons.description }).from(hackathons).where(inArray(hackathons.id, chunk))) {
			descriptions.set(r.id, r.d);
		}
	}
	const items = ids
		.filter((id) => summaries.has(id))
		.map((id) => ({ summary: summaries.get(id)!, description: descriptions.get(id) ?? null, extra: extras.get(id) }));
	const csv = hackathonsToCsv(items, scope === "tracked");
	return c.body(csv, 200, {
		"Content-Type": "text/csv; charset=utf-8",
		"Content-Disposition": `attachment; filename="hackradar-${scope}-${new Date(now).toISOString().slice(0, 10)}.csv"`,
	});
});

