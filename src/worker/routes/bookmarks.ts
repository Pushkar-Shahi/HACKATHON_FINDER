// Bookmarks and named collections: /api/me/bookmarks, /api/me/collections.
// Collections group saved events; adding an event to a collection saves it.
import { Hono } from "hono";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { AppEnv } from "../env";
import { currentUserId, requireUser, viewerFor } from "../middleware/authentication";
import { validate } from "../middleware/validation";
import {
	bookmarkCreateSchema,
	bookmarkUpdateSchema,
	collectionCreateSchema,
	collectionItemSchema,
	collectionMoveSchema,
	collectionUpdateSchema,
} from "@shared/schemas";
import type { BookmarkRecord, CollectionRecord } from "@shared/types";
import { bookmarks, collectionItems, collections } from "../db/schema";
import { getSummariesByIds, getVisibleRow } from "../db/queries/hackathons";
import { badRequest, conflict, created, notFound, ok } from "../lib/http";
import { activityInsert } from "../services/activity";
import { scheduleReminders } from "../services/reminders";
import type { Database } from "../db/client";

async function ownedCollection(db: Database, userId: string, id: string) {
	const [row] = await db
		.select()
		.from(collections)
		.where(and(eq(collections.id, id), eq(collections.userId, userId)));
	if (!row) throw notFound("Collection");
	return row;
}

/** Bookmark if not already saved. Returns the bookmark id. */
async function ensureBookmark(db: Database, userId: string, hackathonId: string, note: string | null = null) {
	const [inserted] = await db
		.insert(bookmarks)
		.values({ userId, hackathonId, note })
		.onConflictDoNothing()
		.returning({ id: bookmarks.id });
	if (inserted) {
		await activityInsert(db, userId, "bookmark_added", hackathonId, {});
		await scheduleReminders(db, Date.now(), { userId, hackathonId });
		return { id: inserted.id, created: true };
	}
	const [existing] = await db
		.select({ id: bookmarks.id })
		.from(bookmarks)
		.where(and(eq(bookmarks.userId, userId), eq(bookmarks.hackathonId, hackathonId)));
	return { id: existing.id, created: false };
}

// ---------------------------------------------------------------------------
// Bookmarks
// ---------------------------------------------------------------------------

export const bookmarkRoutes = new Hono<AppEnv>();
bookmarkRoutes.use("*", requireUser);

const listQuery = z.object({
	collectionId: z.string().max(64).optional(),
	sort: z.enum(["deadline", "start", "added"]).default("deadline"),
});

bookmarkRoutes.get("/", validate("query", listQuery), async (c) => {
	const userId = currentUserId(c);
	const { collectionId, sort } = c.req.valid("query");
	const db = c.var.db;
	if (collectionId) await ownedCollection(db, userId, collectionId);
	const rows = collectionId
		? await db
				.select({ b: bookmarks })
				.from(bookmarks)
				.innerJoin(collectionItems, and(eq(collectionItems.hackathonId, bookmarks.hackathonId), eq(collectionItems.collectionId, collectionId)))
				.where(eq(bookmarks.userId, userId))
				.limit(1000)
		: await db.select({ b: bookmarks }).from(bookmarks).where(eq(bookmarks.userId, userId)).limit(1000);
	const ids = rows.map((r) => r.b.hackathonId);
	const summaries = await getSummariesByIds(db, ids, await viewerFor(c), Date.now());
	const membership = new Map<string, string[]>();
	for (let i = 0; i < ids.length; i += 80) {
		const chunk = ids.slice(i, i + 80);
		if (!chunk.length) continue;
		const items = await db
			.select({ hackathonId: collectionItems.hackathonId, collectionId: collectionItems.collectionId })
			.from(collectionItems)
			.innerJoin(collections, eq(collections.id, collectionItems.collectionId))
			.where(and(eq(collections.userId, userId), inArray(collectionItems.hackathonId, chunk)));
		for (const it of items) membership.set(it.hackathonId, [...(membership.get(it.hackathonId) ?? []), it.collectionId]);
	}
	const now = Date.now();
	const key = (iso: string | null) => {
		if (!iso) return Number.MAX_SAFE_INTEGER;
		const t = Date.parse(iso);
		return t < now ? Number.MAX_SAFE_INTEGER / 2 + (now - t) : t;
	};
	const records: BookmarkRecord[] = rows
		.filter((r) => summaries.has(r.b.hackathonId))
		.map((r) => ({
			id: r.b.id,
			hackathonId: r.b.hackathonId,
			note: r.b.note,
			createdAt: r.b.createdAt.toISOString(),
			collectionIds: membership.get(r.b.hackathonId) ?? [],
			hackathon: summaries.get(r.b.hackathonId)!,
		}))
		.sort((a, b) =>
			sort === "added"
				? Date.parse(b.createdAt) - Date.parse(a.createdAt)
				: sort === "start"
					? key(a.hackathon.eventStartAt) - key(b.hackathon.eventStartAt)
					: key(a.hackathon.registrationDeadlineAt) - key(b.hackathon.registrationDeadlineAt),
		);
	return ok(c, records, { total: records.length });
});

bookmarkRoutes.post("/", validate("json", bookmarkCreateSchema), async (c) => {
	const userId = currentUserId(c);
	const body = c.req.valid("json");
	const db = c.var.db;
	const row = await getVisibleRow(db, body.hackathonId, await viewerFor(c));
	if (!row) throw notFound("Hackathon");
	if (body.collectionId) await ownedCollection(db, userId, body.collectionId);
	const bm = await ensureBookmark(db, userId, row.id, body.note);
	if (!bm.created && body.note !== null) await db.update(bookmarks).set({ note: body.note }).where(eq(bookmarks.id, bm.id));
	if (body.collectionId) {
		await db.insert(collectionItems).values({ collectionId: body.collectionId, hackathonId: row.id }).onConflictDoNothing();
	}
	return bm.created ? created(c, { id: bm.id, hackathonId: row.id }) : ok(c, { id: bm.id, hackathonId: row.id });
});

bookmarkRoutes.patch("/:id", validate("json", bookmarkUpdateSchema), async (c) => {
	const userId = currentUserId(c);
	const [updated] = await c.var.db
		.update(bookmarks)
		.set({ note: c.req.valid("json").note })
		.where(and(eq(bookmarks.id, c.req.param("id")), eq(bookmarks.userId, userId)))
		.returning();
	if (!updated) throw notFound("Bookmark");
	await activityInsert(c.var.db, userId, "bookmark_note_updated", updated.hackathonId, {});
	return ok(c, { id: updated.id, note: updated.note });
});

bookmarkRoutes.delete("/:id", async (c) => {
	const userId = currentUserId(c);
	const db = c.var.db;
	const [bm] = await db
		.select()
		.from(bookmarks)
		.where(and(eq(bookmarks.id, c.req.param("id")), eq(bookmarks.userId, userId)));
	if (!bm) throw notFound("Bookmark");
	await db.batch([
		// Removing a saved event also removes it from the user's collections.
		db
			.delete(collectionItems)
			.where(
				and(
					eq(collectionItems.hackathonId, bm.hackathonId),
					inArray(collectionItems.collectionId, db.select({ id: collections.id }).from(collections).where(eq(collections.userId, userId))),
				),
			),
		db.delete(bookmarks).where(and(eq(bookmarks.id, bm.id), eq(bookmarks.userId, userId))),
		activityInsert(db, userId, "bookmark_removed", bm.hackathonId, {}),
	]);
	await scheduleReminders(db, Date.now(), { userId, hackathonId: bm.hackathonId });
	return ok(c, { deleted: true });
});

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------

export const collectionRoutes = new Hono<AppEnv>();
collectionRoutes.use("*", requireUser);

collectionRoutes.get("/", async (c) => {
	const userId = currentUserId(c);
	const rows = await c.var.db
		.select({
			c: collections,
			itemCount: sql<number>`(SELECT count(*) FROM ${collectionItems} WHERE ${collectionItems.collectionId} = ${collections.id})`,
		})
		.from(collections)
		.where(eq(collections.userId, userId))
		.orderBy(collections.name);
	const out: CollectionRecord[] = rows.map((r) => ({
		id: r.c.id,
		name: r.c.name,
		description: r.c.description,
		itemCount: Number(r.itemCount),
		createdAt: r.c.createdAt.toISOString(),
		updatedAt: r.c.updatedAt.toISOString(),
	}));
	return ok(c, out);
});

collectionRoutes.post("/", validate("json", collectionCreateSchema), async (c) => {
	const userId = currentUserId(c);
	const body = c.req.valid("json");
	const [inserted] = await c.var.db
		.insert(collections)
		.values({ userId, name: body.name, description: body.description })
		.onConflictDoNothing()
		.returning();
	if (!inserted) throw conflict(`You already have a collection named "${body.name}"`);
	await activityInsert(c.var.db, userId, "collection_created", null, { name: body.name });
	return created(c, { id: inserted.id, name: inserted.name, description: inserted.description, itemCount: 0 });
});

collectionRoutes.patch("/:id", validate("json", collectionUpdateSchema), async (c) => {
	const userId = currentUserId(c);
	const existing = await ownedCollection(c.var.db, userId, c.req.param("id"));
	const body = c.req.valid("json");
	try {
		const [updated] = await c.var.db
			.update(collections)
			.set({ name: body.name ?? existing.name, description: body.description === undefined ? existing.description : body.description, updatedAt: new Date() })
			.where(and(eq(collections.id, existing.id), eq(collections.userId, userId)))
			.returning();
		return ok(c, { id: updated.id, name: updated.name, description: updated.description });
	} catch (err) {
		if (String(err).includes("UNIQUE")) throw conflict("You already have a collection with that name");
		throw err;
	}
});

collectionRoutes.delete("/:id", async (c) => {
	const userId = currentUserId(c);
	const existing = await ownedCollection(c.var.db, userId, c.req.param("id"));
	// Deleting a collection keeps the bookmarks themselves.
	await c.var.db.delete(collections).where(and(eq(collections.id, existing.id), eq(collections.userId, userId)));
	return ok(c, { deleted: true });
});

collectionRoutes.post("/move", validate("json", collectionMoveSchema), async (c) => {
	const userId = currentUserId(c);
	const body = c.req.valid("json");
	const db = c.var.db;
	if (body.fromCollectionId === body.toCollectionId) throw badRequest("Choose a different collection");
	await ownedCollection(db, userId, body.toCollectionId);
	if (body.fromCollectionId) await ownedCollection(db, userId, body.fromCollectionId);
	const row = await getVisibleRow(db, body.hackathonId, await viewerFor(c));
	if (!row) throw notFound("Hackathon");
	await ensureBookmark(db, userId, row.id);
	await db.batch([
		db.insert(collectionItems).values({ collectionId: body.toCollectionId, hackathonId: row.id }).onConflictDoNothing(),
		...(body.fromCollectionId
			? [db.delete(collectionItems).where(and(eq(collectionItems.collectionId, body.fromCollectionId), eq(collectionItems.hackathonId, row.id)))]
			: []),
	]);
	return ok(c, { moved: true });
});

collectionRoutes.post("/:id/items", validate("json", collectionItemSchema), async (c) => {
	const userId = currentUserId(c);
	const db = c.var.db;
	const col = await ownedCollection(db, userId, c.req.param("id"));
	const row = await getVisibleRow(db, c.req.valid("json").hackathonId, await viewerFor(c));
	if (!row) throw notFound("Hackathon");
	await ensureBookmark(db, userId, row.id);
	await db.insert(collectionItems).values({ collectionId: col.id, hackathonId: row.id }).onConflictDoNothing();
	return created(c, { collectionId: col.id, hackathonId: row.id });
});

collectionRoutes.delete("/:id/items/:hackathonId", async (c) => {
	const userId = currentUserId(c);
	const col = await ownedCollection(c.var.db, userId, c.req.param("id"));
	await c.var.db
		.delete(collectionItems)
		.where(and(eq(collectionItems.collectionId, col.id), eq(collectionItems.hackathonId, c.req.param("hackathonId"))));
	return ok(c, { removed: true });
});
