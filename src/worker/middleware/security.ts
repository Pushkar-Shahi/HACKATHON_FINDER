// Request-level protections: Origin checks for state-changing requests (CSRF),
// request size limits, and a small D1-backed fixed-window rate limiter.
import { createMiddleware } from "hono/factory";
import { sql } from "drizzle-orm";
import type { Context } from "hono";
import type { AppEnv } from "../env";
import { trustedOrigins } from "../auth/config";
import { HttpError } from "../lib/http";
import { appRateLimits } from "../db/schema";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Cookie-authenticated, state-changing requests must come from our own origin.
 * Browsers always send Origin on POST/PATCH/PUT/DELETE fetches; a mismatching or
 * cross-site request is refused. (Better Auth applies its own check to /api/auth.)
 */
export const originCheck = createMiddleware<AppEnv>(async (c, next) => {
	if (SAFE_METHODS.has(c.req.method) || c.req.path.startsWith("/api/auth/")) return next();
	const origin = c.req.header("origin");
	const allowed = new Set([new URL(c.req.url).origin, ...trustedOrigins(c.env)]);
	if (origin) {
		if (!allowed.has(origin)) throw new HttpError(403, "invalid_origin", "Cross-origin request refused");
	} else {
		const site = c.req.header("sec-fetch-site");
		if (site && site !== "same-origin" && site !== "none") throw new HttpError(403, "invalid_origin", "Cross-site request refused");
	}
	return next();
});

export function clientKey(c: Context<AppEnv>): string {
	return c.var.user?.id ?? c.req.header("cf-connecting-ip") ?? "anonymous";
}

/** Fixed-window limiter backed by D1 (shared across all Worker isolates). */
export function rateLimit(name: string, limit: number, windowSeconds: number) {
	return createMiddleware<AppEnv>(async (c, next) => {
		const windowMs = windowSeconds * 1000;
		const windowStart = Math.floor(Date.now() / windowMs) * windowMs;
		const key = `${name}:${clientKey(c)}`;
		const [row] = await c.var.db
			.insert(appRateLimits)
			.values({ key, windowStart, count: 1 })
			.onConflictDoUpdate({
				target: appRateLimits.key,
				set: {
					count: sql`CASE WHEN ${appRateLimits.windowStart} = excluded.window_start THEN ${appRateLimits.count} + 1 ELSE 1 END`,
					windowStart: sql`excluded.window_start`,
				},
			})
			.returning({ count: appRateLimits.count });
		if ((row?.count ?? 0) > limit) {
			const retryAfter = Math.ceil((windowStart + windowMs - Date.now()) / 1000);
			c.header("Retry-After", String(Math.max(retryAfter, 1)));
			throw new HttpError(429, "rate_limited", "Too many requests. Please wait and try again.");
		}
		await next();
	});
}
