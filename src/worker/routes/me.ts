// Signed-in user's profile, dashboard data, recommendations and data deletion.
import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";
import type { AppEnv } from "../env";
import { currentUserId, isAdminUser, requireUser, viewerFor } from "../middleware/authentication";
import { validate } from "../middleware/validation";
import { accountDeleteSchema, hackathonListQuerySchema, profileUpdateSchema } from "@shared/schemas";
import type { ActivityItem, Profile } from "@shared/types";
import type { ExperienceLevel, PreferredMode, TopicId } from "@shared/constants";
import { activityLog, hackathons, profiles } from "../db/schema";
import { dashboardCounts, listHackathons } from "../db/queries/hackathons";
import { ok, parseJsonArray, parseJsonObject } from "../lib/http";
import { purgeUserData, createDefaultUserData } from "../services/user-data";
import { rankRecommendations } from "../services/recommendations";
import type { Database } from "../db/client";

export const meRoutes = new Hono<AppEnv>();

async function loadProfile(db: Database, u: { id: string; email: string; name: string; createdAt: Date }, role: "user" | "admin"): Promise<Profile> {
	let [p] = await db.select().from(profiles).where(eq(profiles.userId, u.id));
	if (!p) {
		await createDefaultUserData(db, u.id, u.name);
		[p] = await db.select().from(profiles).where(eq(profiles.userId, u.id));
	}
	return {
		userId: u.id,
		email: u.email,
		name: u.name,
		role,
		displayName: p.displayName,
		country: p.country,
		timezone: p.timezone,
		experienceLevel: (p.experienceLevel as ExperienceLevel | null) ?? null,
		preferredMode: p.preferredMode as PreferredMode,
		isStudent: p.isStudent,
		interests: parseJsonArray<TopicId>(p.interests),
		showDemoEvents: p.showDemoEvents,
		createdAt: u.createdAt.toISOString(),
	};
}

/** Returns the session's user profile, or { data: null } for anonymous visitors. */
meRoutes.get("/", async (c) => {
	const u = c.var.user;
	if (!u) return ok(c, null);
	return ok(c, await loadProfile(c.var.db, u, isAdminUser(c) ? "admin" : "user"));
});

meRoutes.patch("/profile", requireUser, validate("json", profileUpdateSchema), async (c) => {
	const u = c.var.user!;
	const body = c.req.valid("json");
	await loadProfile(c.var.db, u, "user"); // ensures the row exists
	const set: Partial<typeof profiles.$inferInsert> = { updatedAt: new Date() };
	if (body.displayName !== undefined) set.displayName = body.displayName;
	if (body.country !== undefined) set.country = body.country;
	if (body.timezone !== undefined) set.timezone = body.timezone ?? null;
	if (body.experienceLevel !== undefined) set.experienceLevel = body.experienceLevel ?? null;
	if (body.preferredMode !== undefined) set.preferredMode = body.preferredMode;
	if (body.isStudent !== undefined) set.isStudent = body.isStudent ?? null;
	if (body.interests !== undefined) set.interests = JSON.stringify([...new Set(body.interests)]);
	if (body.showDemoEvents !== undefined) set.showDemoEvents = body.showDemoEvents;
	// Note: there is deliberately no way to change `role` here.
	await c.var.db.update(profiles).set(set).where(eq(profiles.userId, u.id));
	return ok(c, await loadProfile(c.var.db, u, isAdminUser(c) ? "admin" : "user"));
});

meRoutes.get("/recommendations", requireUser, async (c) => {
	const userId = currentUserId(c);
	const viewer = await viewerFor(c);
	const [p] = await c.var.db.select().from(profiles).where(eq(profiles.userId, userId));
	const interests = parseJsonArray<TopicId>(p?.interests);
	const profile = {
		interests,
		preferredMode: (p?.preferredMode as PreferredMode) ?? "any",
		experienceLevel: (p?.experienceLevel as ExperienceLevel | null) ?? null,
		isStudent: p?.isStudent ?? null,
		country: p?.country ?? null,
	};
	if (!interests.length && profile.preferredMode === "any") {
		return ok(c, [], { needsPreferences: true });
	}
	const now = Date.now();
	const q = hackathonListQuerySchema.parse({ registration: "open,opening_soon", sort: "deadline", pageSize: "50" });
	const { items } = await listHackathons(c.var.db, q, viewer, now);
	return ok(c, rankRecommendations(items, profile, now), { needsPreferences: false, candidates: items.length });
});

meRoutes.get("/activity", requireUser, async (c) => {
	const userId = currentUserId(c);
	const rows = await c.var.db
		.select({ a: activityLog, title: hackathons.title })
		.from(activityLog)
		.leftJoin(hackathons, eq(hackathons.id, activityLog.hackathonId))
		.where(eq(activityLog.userId, userId))
		.orderBy(desc(activityLog.createdAt))
		.limit(15);
	const items: ActivityItem[] = rows.map((r) => ({
		id: r.a.id,
		action: r.a.action,
		hackathonId: r.a.hackathonId,
		// Titles of events the user can no longer see are not revealed.
		hackathonTitle: r.title ?? null,
		details: parseJsonObject(r.a.details),
		createdAt: r.a.createdAt.toISOString(),
	}));
	return ok(c, items);
});

/** Delete all private tracking data but keep the account. */
meRoutes.delete("/data", requireUser, validate("json", accountDeleteSchema), async (c) => {
	await purgeUserData(c.var.db, currentUserId(c));
	return ok(c, { deleted: true });
});

// ---------------------------------------------------------------------------
// Dashboard statistics (anonymous visitors get public counts only)
// ---------------------------------------------------------------------------

export const dashboardRoutes = new Hono<AppEnv>();

dashboardRoutes.get("/stats", async (c) => {
	const viewer = await viewerFor(c);
	return ok(c, await dashboardCounts(c.var.db, viewer, Date.now()));
});
