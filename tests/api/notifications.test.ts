import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { api, DAY, eventInput, MINUTE, signUp } from "../helpers";
import { createDb } from "../../src/worker/db/client";
import { deliverDueNotifications, scheduleReminders } from "../../src/worker/services/reminders";
import type { AppBindings } from "../../src/worker/env";

const testEnv = env as unknown as AppBindings;

async function rows(userId: string) {
	const res = await testEnv.DB.prepare("SELECT * FROM notifications WHERE user_id = ? ORDER BY scheduled_at").bind(userId).all<any>();
	return res.results;
}

describe("deadline reminders", () => {
	it("schedules idempotently, delivers once, and handles deadline changes and preference changes", async () => {
		const db = createDb(testEnv.DB);
		const a = await signUp();
		const deadline = Date.now() + 2 * DAY;
		const ev = (await api("/api/me/events", { method: "POST", cookie: a.cookie, json: eventInput({ registrationDeadlineAt: new Date(deadline).toISOString() }) })).body.data;
		await api("/api/me/bookmarks", { method: "POST", cookie: a.cookie, json: { hackathonId: ev.id } });

		// Defaults: in-app 3d / 24h / day-of. The 3-day point is already >6h in the past → not sent late.
		let r = await rows(a.id);
		expect(r.filter((n) => n.status === "scheduled").map((n) => n.reminder_interval).sort()).toEqual(["24h", "day_of"]);

		// Re-running the scheduler never creates duplicates.
		await scheduleReminders(db, Date.now());
		await scheduleReminders(db, Date.now());
		expect((await rows(a.id)).length).toBe(2);

		// Deliver at 24h-before (+1 minute): exactly one in-app reminder, even if run twice.
		const at = deadline - DAY + MINUTE;
		await deliverDueNotifications(db, testEnv, at);
		await deliverDueNotifications(db, testEnv, at);
		r = await rows(a.id);
		expect(r.filter((n) => n.status === "delivered").map((n) => n.reminder_interval)).toEqual(["24h"]);

		const inbox = await api("/api/me/notifications", { cookie: a.cookie });
		expect(inbox.body.data).toHaveLength(1);
		expect(inbox.body.meta.unreadCount).toBe(1);
		expect(inbox.body.data[0].message).toContain(ev.title);
		await api(`/api/me/notifications/${inbox.body.data[0].id}`, { method: "PATCH", cookie: a.cookie, json: { read: true } });
		expect((await api("/api/me/notifications/unread-count", { cookie: a.cookie })).body.data.unreadCount).toBe(0);

		// Deadline moves: pending reminders for the old deadline are cancelled, new ones scheduled.
		const newDeadline = Date.now() + 5 * DAY;
		await api(`/api/me/events/${ev.id}`, {
			method: "PUT",
			cookie: a.cookie,
			json: eventInput({ title: ev.title, canonicalUrl: ev.canonicalUrl, registrationDeadlineAt: new Date(newDeadline).toISOString() }),
		});
		r = await rows(a.id);
		const old = r.filter((n) => Number(n.deadline_version) === deadline);
		expect(old.find((n) => n.reminder_interval === "day_of").status).toBe("cancelled");
		expect(old.find((n) => n.reminder_interval === "day_of").failure_reason).toBe("deadline_changed");
		expect(old.find((n) => n.reminder_interval === "24h").status).toBe("delivered");
		const fresh = r.filter((n) => Number(n.deadline_version) === new Date(newDeadline).getTime());
		expect(fresh.map((n) => n.reminder_interval).sort()).toEqual(["24h", "3d", "day_of"]);

		// Turning off the 24h reminder cancels it.
		const prefs = (await api("/api/me/preferences", { cookie: a.cookie })).body.data;
		const reminders = prefs.reminders.map((x: any) => (x.interval === "24h" && x.channel === "in_app" ? { ...x, enabled: false } : x));
		const patched = await api("/api/me/preferences", { method: "PATCH", cookie: a.cookie, json: { deliveryTime: "08:30", timezone: "Asia/Kolkata", reminders, deadlineChanged: prefs.deadlineChanged } });
		expect(patched.status).toBe(200);
		expect(patched.body.data.timezone).toBe("Asia/Kolkata");
		r = await rows(a.id);
		const cancelled24 = r.find((n) => Number(n.deadline_version) === new Date(newDeadline).getTime() && n.reminder_interval === "24h");
		expect(cancelled24.status).toBe("cancelled");
		expect(cancelled24.failure_reason).toBe("preference_disabled");

		// Un-saving the event cancels the remaining reminders.
		const bms = (await api("/api/me/bookmarks", { cookie: a.cookie })).body.data;
		await api(`/api/me/bookmarks/${bms[0].id}`, { method: "DELETE", cookie: a.cookie });
		r = await rows(a.id);
		expect(r.filter((n) => n.status === "scheduled")).toHaveLength(0);
	});

	it("email reminders are skipped (not faked) when email is not configured", async () => {
		const db = createDb(testEnv.DB);
		const a = await signUp();
		const prefs = (await api("/api/me/preferences", { cookie: a.cookie })).body.data;
		expect(prefs.emailConfigured).toBe(false);
		const reminders = prefs.reminders.map((x: any) => ({ ...x, enabled: x.interval === "24h" }));
		await api("/api/me/preferences", { method: "PATCH", cookie: a.cookie, json: { deliveryTime: "09:00", timezone: "UTC", reminders, deadlineChanged: prefs.deadlineChanged } });
		const deadline = Date.now() + 2 * DAY;
		const ev = (await api("/api/me/events", { method: "POST", cookie: a.cookie, json: eventInput({ registrationDeadlineAt: new Date(deadline).toISOString() }) })).body.data;
		await api("/api/me/tracking", { method: "POST", cookie: a.cookie, json: { hackathonId: ev.id, status: "planning" } });
		await deliverDueNotifications(db, testEnv, deadline - DAY + MINUTE);
		const email = (await rows(a.id)).find((n) => n.channel === "email");
		expect(email.status).toBe("skipped");
		expect(email.failure_reason).toBe("email_not_configured");
	});

	it("missed reminders after the deadline are skipped, not delivered late", async () => {
		const db = createDb(testEnv.DB);
		const a = await signUp();
		const deadline = Date.now() + 2 * DAY;
		const ev = (await api("/api/me/events", { method: "POST", cookie: a.cookie, json: eventInput({ registrationDeadlineAt: new Date(deadline).toISOString() }) })).body.data;
		await api("/api/me/bookmarks", { method: "POST", cookie: a.cookie, json: { hackathonId: ev.id } });
		await deliverDueNotifications(db, testEnv, deadline + MINUTE);
		const r = await rows(a.id);
		expect(r.every((n) => n.status === "skipped" && n.failure_reason === "deadline_passed")).toBe(true);
	});
});
