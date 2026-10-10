// HackRadar Worker entry point.
//
//   Browser ──► Workers Static Assets (React SPA, served from dist/client)
//          └──► /api/*  ──► this Worker (Hono) ──► D1 (via Drizzle)
//   Cron Triggers ──► scheduled() ──► provider sync + reminder processing
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { HTTPException } from "hono/http-exception";
import type { AppBindings, AppEnv } from "./env";
import { authContext } from "./middleware/authentication";
import { originCheck } from "./middleware/security";
import { HttpError } from "./lib/http";
import { log, safeErrorMessage } from "./lib/logger";
import { authRoutes } from "./routes/auth";
import { hackathonRoutes, myEventRoutes } from "./routes/hackathons";
import { trackerRoutes } from "./routes/tracker";
import { bookmarkRoutes, collectionRoutes } from "./routes/bookmarks";
import { calendarRoutes, milestoneRoutes } from "./routes/calendar";
import { notificationRoutes, preferenceRoutes } from "./routes/notifications";
import { dashboardRoutes, meRoutes } from "./routes/me";
import { configRoutes, healthRoutes, sourceRoutes, tagRoutes } from "./routes/sources";
import { adminRoutes } from "./routes/admin";
import { handleScheduled } from "./scheduled";

export const app = new Hono<AppEnv>();

app.use("/api/*", async (c, next) => {
	c.set("requestId", c.req.header("cf-ray") ?? crypto.randomUUID());
	await next();
	c.header("Cache-Control", "no-store");
});
app.use("/api/*", secureHeaders({ crossOriginResourcePolicy: "same-origin", referrerPolicy: "strict-origin-when-cross-origin" }));
app.use("/api/*", authContext);
app.use("/api/*", originCheck);

app.route("/api/auth", authRoutes);
app.route("/api/health", healthRoutes);
app.route("/api/config", configRoutes);
app.route("/api/hackathons", hackathonRoutes);
app.route("/api/sources", sourceRoutes);
app.route("/api/tags", tagRoutes);
app.route("/api/dashboard", dashboardRoutes);
app.route("/api/calendar", calendarRoutes);
app.route("/api/me/events", myEventRoutes);
app.route("/api/me/tracking", trackerRoutes);
app.route("/api/me/bookmarks", bookmarkRoutes);
app.route("/api/me/collections", collectionRoutes);
app.route("/api/me/milestones", milestoneRoutes);
app.route("/api/me/notifications", notificationRoutes);
app.route("/api/me/preferences", preferenceRoutes);
app.route("/api/me", meRoutes);
app.route("/api/admin", adminRoutes);

app.notFound((c) => c.json({ error: { code: "not_found", message: "No such API route" } }, 404));

app.onError((err, c) => {
	if (err instanceof HttpError) {
		return c.json({ error: { code: err.code, message: err.message, ...(err.fields ? { fields: err.fields } : {}) } }, err.status);
	}
	if (err instanceof HTTPException) {
		// e.g. malformed JSON bodies rejected by Hono's validator.
		return c.json({ error: { code: "bad_request", message: err.message || "Bad request" } }, err.status);
	}
	// Unexpected: log a redacted message server-side, return a generic error (no stack traces).
	log("error", "request.unhandled", { requestId: c.var.requestId, path: c.req.path, error: safeErrorMessage(err) });
	return c.json({ error: { code: "internal_error", message: "Something went wrong. Please try again." } }, 500);
});

export default {
	fetch: app.fetch,
	scheduled: handleScheduled,
} satisfies ExportedHandler<AppBindings>;
