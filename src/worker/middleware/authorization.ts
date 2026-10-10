// Administrator authorization. Roles are stored server-side in user.role and
// can only be changed with direct database access (see README → "Bootstrapping
// the first administrator"); no API endpoint accepts a role from a client.
import { createMiddleware } from "hono/factory";
import { eq } from "drizzle-orm";
import type { AppEnv } from "../env";
import { user } from "../db/schema";
import { forbidden, unauthorized } from "../lib/http";

export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
	const u = c.var.user;
	if (!u) throw unauthorized();
	// Re-read the role from D1 so a revoked admin loses access immediately.
	const [row] = await c.var.db.select({ role: user.role }).from(user).where(eq(user.id, u.id));
	if (row?.role !== "admin") throw forbidden("Administrator access required");
	await next();
});
