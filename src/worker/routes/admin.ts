// Administrator tools: provider sync, sync logs, verification queue, duplicate
// review, publication review, shared-event editing and demo data. Every route
// passes through requireAdmin, which re-checks the role in D1.
import { Hono } from "hono";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { AppEnv } from "../env";
import { requireAdmin } from "../middleware/authorization";
import { currentUserId } from "../middleware/authentication";
import { validate } from "../middleware/validation";
import { rateLimit } from "../middleware/security";
import {
	adminHackathonUpdateSchema,
	duplicateResolutionSchema,
	platformUpdateSchema,
	publicationDecisionSchema,
} from "@shared/schemas";
import { SOURCE_PLATFORM_IDS, VERIFICATION_STALE_MS } from "@shared/constants";
import {
	duplicateCandidates,
	hackathons as h,
	platforms,
	syncRecordErrors,
	syncRuns,
} from "../db/schema";
import { eventStatusSql, num, registrationStatusSql } from "../db/queries/status-sql";
import { getHackathonDetail, summarize, type Viewer } from "../db/queries/hackathons";
import { badRequest, notFound, ok, parseJsonArray, parseJsonObject, toIso } from "../lib/http";
import { getProvider, PROVIDERS } from "../services/integrations";
import { getSourceStatuses, syncProvider } from "../services/synchronization";
import { updateHackathon } from "../services/hackathon-writer";
import { notifyDeadlineChange } from "../services/reminders";
import { mergeHackathons } from "../services/deduplication";
import { demoCount, loadDemoData, removeDemoData } from "../services/demo-data";
import { findContradictions } from "@shared/status";
import { datedEvent } from "../db/queries/hackathons";
import type { Database } from "../db/client";

export const adminRoutes = new Hono<AppEnv>();
adminRoutes.use("*", requireAdmin);

/** Admins may review shared records and pending submissions — not other users' private events. */
const adminVisible = or(eq(h.visibility, "public"), eq(h.publicationStatus, "pending"))!;

async function adminRow(db: Database, id: string) {
	const [row] = await db
		.select()
		.from(h)
		.where(and(eq(h.id, id), adminVisible));
	if (!row) throw notFound("Hackathon");
	return row;
}

function adminViewer(userId: string): Viewer {
	return { userId, isAdmin: true, showDemo: true, interests: [] };
}

async function summariesWhere(db: Database, where: ReturnType<typeof and>, userId: string, limit: number, offset = 0) {
	const now = Date.now();
	const rows = await db
		.select({ row: h, registrationStatus: registrationStatusSql(now), eventStatus: eventStatusSql(now) })
		.from(h)
		.where(where)
		.orderBy(desc(h.updatedAt))
		.limit(limit)
		.offset(offset);
	return summarize(db, rows, adminViewer(userId));
}

adminRoutes.get("/overview", async (c) => {
	const now = Date.now();
	const [stats] = await c.var.db
		.select({
			publicEvents: sql<number>`coalesce(sum(CASE WHEN ${h.visibility} = 'public' AND ${h.isDemo} = 0 THEN 1 ELSE 0 END), 0)`,
			demoEvents: sql<number>`coalesce(sum(CASE WHEN ${h.isDemo} = 1 THEN 1 ELSE 0 END), 0)`,
			needsReview: sql<number>`coalesce(sum(CASE WHEN ${h.visibility} = 'public' AND ${h.internalStatus} = 'needs_review' THEN 1 ELSE 0 END), 0)`,
			unverified: sql<number>`coalesce(sum(CASE WHEN ${h.visibility} = 'public' AND ${h.isDemo} = 0 AND ${h.lastVerifiedAt} IS NULL THEN 1 ELSE 0 END), 0)`,
			stale: sql<number>`coalesce(sum(CASE WHEN ${h.visibility} = 'public' AND ${h.lastVerifiedAt} IS NOT NULL AND ${h.lastVerifiedAt} < ${num(now - VERIFICATION_STALE_MS)} THEN 1 ELSE 0 END), 0)`,
			missingDeadline: sql<number>`coalesce(sum(CASE WHEN ${h.visibility} = 'public' AND ${h.registrationDeadlineAt} IS NULL THEN 1 ELSE 0 END), 0)`,
			pendingPublication: sql<number>`coalesce(sum(CASE WHEN ${h.publicationStatus} = 'pending' THEN 1 ELSE 0 END), 0)`,
			privateEvents: sql<number>`coalesce(sum(CASE WHEN ${h.visibility} = 'private' THEN 1 ELSE 0 END), 0)`,
		})
		.from(h);
	const [dups] = await c.var.db.select({ n: sql<number>`count(*)` }).from(duplicateCandidates).where(eq(duplicateCandidates.status, "open"));
	const [failedRuns] = await c.var.db
		.select({ n: sql<number>`count(*)` })
		.from(syncRuns)
		.where(and(inArray(syncRuns.status, ["failed", "unavailable", "partial"]), sql`${syncRuns.startedAt} > ${num(now - 7 * 86_400_000)}`));
	const out = Object.fromEntries(Object.entries(stats ?? {}).map(([k, v]) => [k, Number(v)]));
	return ok(c, { ...out, openDuplicates: Number(dups?.n ?? 0), problemSyncRuns7d: Number(failedRuns?.n ?? 0) });
});

// ---- Sources & synchronization -------------------------------------------

adminRoutes.get("/sources", async (c) => {
	const reports = await getSourceStatuses(c.var.db, c.env);
	const withConfig = reports.map((r) => {
		const cfg = PROVIDERS[r.platform].getConfig(c.env);
		let feedHost: string | null = null;
		try {
			feedHost = cfg.feedUrl ? new URL(cfg.feedUrl).host : null;
		} catch {
			feedHost = null;
		}
		// Never expose the token or full feed URL — only non-sensitive facts.
		return { ...r, config: { feedHost, hasToken: Boolean(cfg.token), authorizationRef: cfg.authorizationRef, problem: cfg.problem } };
	});
	return ok(c, withConfig);
});

adminRoutes.post("/sources/:id/sync", rateLimit("admin_sync", 20, 3600), async (c) => {
	const adapter = getProvider(c.req.param("id"));
	if (!adapter) throw notFound("Provider");
	const summary = await syncProvider(c.var.db, c.env, adapter, { trigger: "admin", userId: currentUserId(c) });
	return ok(c, summary);
});

adminRoutes.patch("/sources/:id", validate("json", platformUpdateSchema), async (c) => {
	const id = c.req.param("id");
	if (!(SOURCE_PLATFORM_IDS as readonly string[]).includes(id)) throw notFound("Provider");
	await c.var.db.update(platforms).set({ autoSyncEnabled: c.req.valid("json").autoSyncEnabled }).where(eq(platforms.id, id));
	return ok(c, { id, autoSyncEnabled: c.req.valid("json").autoSyncEnabled });
});

const pageQuery = z.object({
	page: z.coerce.number().int().min(1).max(500).default(1),
	pageSize: z.coerce.number().int().min(1).max(100).default(25),
	platform: z.string().max(32).optional(),
});

adminRoutes.get("/sync-logs", validate("query", pageQuery), async (c) => {
	const { page, pageSize, platform } = c.req.valid("query");
	const rows = await c.var.db
		.select()
		.from(syncRuns)
		.where(platform ? eq(syncRuns.platformId, platform) : undefined)
		.orderBy(desc(syncRuns.startedAt))
		.limit(pageSize)
		.offset((page - 1) * pageSize);
	return ok(
		c,
		rows.map((r) => ({
			id: r.id,
			platform: r.platformId,
			trigger: r.trigger,
			status: r.status,
			startedAt: r.startedAt.toISOString(),
			finishedAt: toIso(r.finishedAt),
			fetched: r.recordsFetched,
			added: r.recordsAdded,
			updated: r.recordsUpdated,
			skipped: r.recordsSkipped,
			error: r.errorMessage,
			diagnostics: parseJsonObject(r.diagnostics),
		})),
		{ page, pageSize },
	);
});

adminRoutes.get("/import-failures", validate("query", pageQuery), async (c) => {
	const { page, pageSize } = c.req.valid("query");
	const rows = await c.var.db
		.select({ e: syncRecordErrors, startedAt: syncRuns.startedAt })
		.from(syncRecordErrors)
		.innerJoin(syncRuns, eq(syncRuns.id, syncRecordErrors.syncRunId))
		.orderBy(desc(syncRecordErrors.createdAt))
		.limit(pageSize)
		.offset((page - 1) * pageSize);
	return ok(
		c,
		rows.map((r) => ({
			id: r.e.id,
			platform: r.e.platformId,
			externalEventId: r.e.externalEventId,
			reason: r.e.reason,
			syncRunId: r.e.syncRunId,
			runStartedAt: r.startedAt.toISOString(),
			createdAt: r.e.createdAt.toISOString(),
		})),
		{ page, pageSize },
	);
});

// ---- Verification queue & shared-event editing ----------------------------

adminRoutes.get("/verification-queue", validate("query", pageQuery), async (c) => {
	const { page, pageSize } = c.req.valid("query");
	const now = Date.now();
	const where = and(
		eq(h.visibility, "public"),
		or(eq(h.internalStatus, "needs_review"), eq(h.internalStatus, "unverified"), sql`${h.lastVerifiedAt} < ${num(now - VERIFICATION_STALE_MS)}`),
	);
	const items = await summariesWhere(c.var.db, where, currentUserId(c), pageSize, (page - 1) * pageSize);
	const contradictions = new Map<string, string[]>();
	if (items.length) {
		const rows = await c.var.db.select().from(h).where(inArray(h.id, items.map((i) => i.id)));
		for (const r of rows) contradictions.set(r.id, [...new Set([...parseJsonArray<string>(r.contradictions), ...findContradictions(datedEvent(r), now)])]);
	}
	return ok(c, items.map((i) => ({ hackathon: i, contradictions: contradictions.get(i.id) ?? [] })), { page, pageSize });
});

adminRoutes.get("/hackathons/:id", async (c) => {
	const row = await adminRow(c.var.db, c.req.param("id"));
	const detail = await getHackathonDetail(c.var.db, row.id, adminViewer(currentUserId(c)), Date.now(), adminVisible);
	if (!detail) throw notFound("Hackathon");
	return ok(c, { ...detail, reviewNote: row.reviewNote });
});

adminRoutes.put("/hackathons/:id", validate("json", adminHackathonUpdateSchema), async (c) => {
	const row = await adminRow(c.var.db, c.req.param("id"));
	const body = c.req.valid("json");
	const changes = await updateHackathon(c.var.db, row, body.event, {
		changedBy: "admin",
		changedByUserId: currentUserId(c),
		markVerified: body.markVerified,
		internalStatus: body.internalStatus,
	});
	const deadline = changes.find((ch) => ch.field === "registrationDeadlineAt");
	if (deadline && row.visibility === "public") {
		await notifyDeadlineChange(c.var.db, { id: row.id, title: body.event.title }, deadline.oldValue, deadline.newValue, Date.now());
	}
	return ok(c, { updated: true, dateChanges: changes.map((ch) => ch.field) });
});

adminRoutes.post("/hackathons/:id/verify", async (c) => {
	const row = await adminRow(c.var.db, c.req.param("id"));
	const now = Date.now();
	const contradictions = findContradictions({ ...datedEvent(row), lastVerifiedAt: now }, now);
	await c.var.db
		.update(h)
		.set({
			lastVerifiedAt: new Date(now),
			lastCheckedAt: new Date(now),
			internalStatus: contradictions.length ? "needs_review" : "verified",
			contradictions: JSON.stringify(contradictions),
		})
		.where(eq(h.id, row.id));
	return ok(c, { verified: contradictions.length === 0, contradictions });
});

adminRoutes.delete("/hackathons/:id", async (c) => {
	const row = await adminRow(c.var.db, c.req.param("id"));
	await c.var.db.delete(h).where(eq(h.id, row.id));
	return ok(c, { deleted: true });
});

// ---- Publication review ----------------------------------------------------

adminRoutes.get("/submissions", async (c) => {
	const items = await summariesWhere(c.var.db, and(eq(h.publicationStatus, "pending"), eq(h.visibility, "private")), currentUserId(c), 100);
	return ok(c, items);
});

adminRoutes.post("/submissions/:id", validate("json", publicationDecisionSchema), async (c) => {
	const [row] = await c.var.db
		.select()
		.from(h)
		.where(and(eq(h.id, c.req.param("id")), eq(h.publicationStatus, "pending")));
	if (!row) throw notFound("Pending submission");
	const { approve, note } = c.req.valid("json");
	await c.var.db
		.update(h)
		.set(
			approve
				? { visibility: "public", publicationStatus: "approved", reviewNote: note, updatedAt: new Date() }
				: { publicationStatus: "rejected", reviewNote: note, updatedAt: new Date() },
		)
		.where(eq(h.id, row.id));
	return ok(c, { id: row.id, publicationStatus: approve ? "approved" : "rejected" });
});

// ---- Duplicate review --------------------------------------------------------

adminRoutes.get("/duplicates", async (c) => {
	const rows = await c.var.db
		.select()
		.from(duplicateCandidates)
		.where(eq(duplicateCandidates.status, "open"))
		.orderBy(desc(duplicateCandidates.createdAt))
		.limit(50);
	const ids = [...new Set(rows.flatMap((r) => [r.hackathonId, r.candidateId]))];
	const summaries = ids.length ? await summariesWhere(c.var.db, and(adminVisible, inArray(h.id, ids)), currentUserId(c), 100) : [];
	const byId = new Map(summaries.map((s) => [s.id, s]));
	return ok(
		c,
		rows
			.filter((r) => byId.has(r.hackathonId) && byId.has(r.candidateId))
			.map((r) => ({
				id: r.id,
				confidence: r.confidence,
				reasons: parseJsonArray<string>(r.reasons),
				a: byId.get(r.hackathonId)!,
				b: byId.get(r.candidateId)!,
				createdAt: r.createdAt.toISOString(),
			})),
	);
});

adminRoutes.post("/duplicates/:id", validate("json", duplicateResolutionSchema), async (c) => {
	const [cand] = await c.var.db.select().from(duplicateCandidates).where(eq(duplicateCandidates.id, c.req.param("id")));
	if (!cand || cand.status !== "open") throw notFound("Open duplicate candidate");
	const body = c.req.valid("json");
	if (body.action === "dismiss") {
		await c.var.db
			.update(duplicateCandidates)
			.set({ status: "dismissed", resolvedAt: new Date(), resolvedByUserId: currentUserId(c) })
			.where(eq(duplicateCandidates.id, cand.id));
		return ok(c, { status: "dismissed" });
	}
	const keepId = body.keepId ?? cand.hackathonId;
	if (keepId !== cand.hackathonId && keepId !== cand.candidateId) throw badRequest("keepId must be one of the two records");
	const removeId = keepId === cand.hackathonId ? cand.candidateId : cand.hackathonId;
	// Both records must be shared records; private user events are never merged by admins.
	await adminRow(c.var.db, keepId);
	const removeRow = await adminRow(c.var.db, removeId);
	if (removeRow.visibility !== "public") throw badRequest("Only shared (public) records can be merged");
	await mergeHackathons(c.var.db, keepId, removeId, currentUserId(c));
	return ok(c, { status: "merged", keptId: keepId, removedId: removeId });
});

// ---- Demo data ---------------------------------------------------------------

adminRoutes.get("/demo", async (c) => ok(c, { count: await demoCount(c.var.db) }));
adminRoutes.post("/demo", async (c) => ok(c, { created: await loadDemoData(c.var.db) }));
adminRoutes.delete("/demo", async (c) => ok(c, { removed: await removeDemoData(c.var.db) }));
