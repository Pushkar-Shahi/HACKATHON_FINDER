// Per-request auth context. Creates the D1-backed Drizzle client and a Better
// Auth instance, then resolves the session cookie (if any) into c.var.user.
import { createMiddleware } from "hono/factory";
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import type { AppEnv } from "../env";
import { createDb } from "../db/client";
import { createAuth } from "../auth/config";
import { profiles } from "../db/schema";
import { unauthorized } from "../lib/http";
import { parseJsonArray } from "../lib/http";
import type { Viewer } from "../db/queries/hackathons";
import type { TopicId } from "@shared/constants";

export const authContext = createMiddleware<AppEnv>(async (c, next) => {
	const db = createDb(c.env.DB);
	c.set("db", db);
	c.set("auth", createAuth(c.env, db));
	c.set("user", null);
	c.set("session", null);
	// Better Auth's own routes resolve sessions themselves.
	if (!c.req.path.startsWith("/api/auth/") && c.env.BETTER_AUTH_SECRET) {
		const result = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
		if (result) {
			c.set("user", result.user);
			c.set("session", result.session);
		}
	}
	await next();
});

/** Reject unauthenticated requests with 401 (session missing or expired). */
export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
	if (!c.var.user) throw unauthorized();
	await next();
});

export function currentUserId(c: Context<AppEnv>): string {
	const u = c.var.user;
	if (!u) throw unauthorized();
	return u.id;
}

export function isAdminUser(c: Context<AppEnv>): boolean {
	return (c.var.user as { role?: string } | null)?.role === "admin";
}

/** Build the Viewer used by queries, including profile preferences. */
export async function viewerFor(c: Context<AppEnv>): Promise<Viewer> {
	const u = c.var.user;
	if (!u) return { userId: null, isAdmin: false, showDemo: true, interests: [] };
	const [p] = await c.var.db
		.select({ showDemo: profiles.showDemoEvents, interests: profiles.interests })
		.from(profiles)
		.where(eq(profiles.userId, u.id));
	return {
		userId: u.id,
		isAdmin: isAdminUser(c),
		showDemo: p?.showDemo ?? true,
		interests: parseJsonArray<TopicId>(p?.interests),
	};
}
