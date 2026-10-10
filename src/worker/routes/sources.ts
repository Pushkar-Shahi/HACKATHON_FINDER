// Public source status, tag list, runtime config and health check.
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import type { AppEnv } from "../env";
import { getSourceStatuses } from "../services/synchronization";
import { hackathonTags, hackathons, tags } from "../db/schema";
import { ok } from "../lib/http";
import { TOPICS } from "@shared/constants";
import type { AppConfig } from "@shared/types";
import { isEmailConfigured } from "../services/email";
import { isGoogleConfigured } from "../auth/config";
import { isDevelopment } from "../env";

export const sourceRoutes = new Hono<AppEnv>();

sourceRoutes.get("/", async (c) => ok(c, await getSourceStatuses(c.var.db, c.env)));

export const tagRoutes = new Hono<AppEnv>();

tagRoutes.get("/", async (c) => {
	const technologies = await c.var.db
		.select({ slug: tags.slug, label: tags.label, count: sql<number>`count(DISTINCT ${hackathons.id})` })
		.from(tags)
		.innerJoin(hackathonTags, eq(hackathonTags.tagId, tags.id))
		.innerJoin(hackathons, eq(hackathons.id, hackathonTags.hackathonId))
		.where(sql`${tags.kind} = 'technology' AND ${hackathons.visibility} = 'public'`)
		.groupBy(tags.id)
		.orderBy(sql`count(DISTINCT ${hackathons.id}) DESC`)
		.limit(100);
	return ok(c, { topics: TOPICS, technologies: technologies.map((t) => ({ ...t, count: Number(t.count) })) });
});

export const configRoutes = new Hono<AppEnv>();

configRoutes.get("/", (c) => {
	const emailConfigured = isEmailConfigured(c.env);
	const config: AppConfig = {
		environment: c.env.ENVIRONMENT,
		emailConfigured,
		googleAuthConfigured: isGoogleConfigured(c.env),
		// In development the reset link is printed to the console instead of emailed.
		passwordResetAvailable: emailConfigured || isDevelopment(c.env),
	};
	return ok(c, config);
});

export const healthRoutes = new Hono<AppEnv>();

healthRoutes.get("/", async (c) => {
	let database: "ok" | "error" = "ok";
	let migrated = false;
	try {
		const rows = await c.var.db.all<{ n: number }>(sql`SELECT count(*) AS n FROM platforms`);
		migrated = Number(rows[0]?.n ?? 0) > 0;
	} catch {
		database = "error";
	}
	let baseUrlValid = true;
	try {
		new URL(c.env.BETTER_AUTH_URL);
	} catch {
		baseUrlValid = false;
	}
	const authConfigured = Boolean(c.env.BETTER_AUTH_SECRET) && baseUrlValid;
	const healthy = database === "ok" && migrated && authConfigured;
	return c.json(
		{
			data: {
				status: healthy ? "ok" : "degraded",
				environment: c.env.ENVIRONMENT,
				database,
				migrationsApplied: migrated,
				authConfigured,
				emailConfigured: isEmailConfigured(c.env),
				time: new Date().toISOString(),
			},
		},
		healthy ? 200 : 503,
	);
});
