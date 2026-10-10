import { describe, expect, it } from "vitest";
import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from "cloudflare:test";
import worker from "../../src/worker/index";
import { REMINDER_CRON, SYNC_CRON } from "../../src/worker/scheduled";
import { api, DAY, eventInput, signUp } from "../helpers";
import type { AppBindings } from "../../src/worker/env";

const testEnv = env as unknown as AppBindings;

describe("D1 migrations", () => {
	it("created every table and seeded platforms in Manual Mode", async () => {
		const tables = await testEnv.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all<{ name: string }>();
		const names = tables.results.map((t) => t.name);
		for (const t of ["user", "session", "account", "verification", "rate_limit", "profiles", "platforms", "hackathons", "hackathon_sources", "tags", "hackathon_tags", "user_hackathon_tracking", "bookmarks", "collections", "collection_items", "milestones", "notification_preferences", "notifications", "activity_log", "sync_runs", "sync_record_errors", "duplicate_candidates"]) {
			expect(names).toContain(t);
		}
		const platforms = await testEnv.DB.prepare("SELECT id, integration_status FROM platforms ORDER BY id").all<{ id: string; integration_status: string }>();
		expect(platforms.results.map((p) => p.id)).toEqual(["devpost", "machinehack", "mlh", "other", "unstop"]);
		const indexes = await testEnv.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all<{ name: string }>();
		const idx = indexes.results.map((i) => i.name);
		for (const i of ["hackathons_deadline_idx", "hackathons_start_idx", "tracking_user_hackathon_uq", "bookmarks_user_hackathon_uq", "notifications_due_idx", "hackathon_sources_external_uq"]) {
			expect(idx).toContain(i);
		}
	});
});

describe("scheduled handler", () => {
	it("reminder cron schedules reminders for saved events", async () => {
		const u = await signUp();
		const ev = (await api("/api/me/events", { method: "POST", cookie: u.cookie, json: eventInput({ registrationDeadlineAt: new Date(Date.now() + 2 * DAY).toISOString() }) })).body.data;
		// Insert the bookmark directly so only the cron can schedule reminders.
		await testEnv.DB.prepare("INSERT INTO bookmarks (id, user_id, hackathon_id, created_at) VALUES (?, ?, ?, ?)").bind(crypto.randomUUID(), u.id, ev.id, Date.now()).run();
		const ctx = createExecutionContext();
		await worker.scheduled(createScheduledController({ cron: REMINDER_CRON, scheduledTime: Date.now() }), testEnv, ctx);
		await waitOnExecutionContext(ctx);
		const n = await testEnv.DB.prepare("SELECT count(*) AS n FROM notifications WHERE user_id = ? AND status = 'scheduled'").bind(u.id).first<{ n: number }>();
		expect(n!.n).toBe(2);
	});

	it("sync cron runs without contacting manual-mode providers", async () => {
		const ctx = createExecutionContext();
		await expect(worker.scheduled(createScheduledController({ cron: SYNC_CRON, scheduledTime: Date.now() }), testEnv, ctx)).resolves.toBeUndefined();
		await waitOnExecutionContext(ctx);
	});
});
