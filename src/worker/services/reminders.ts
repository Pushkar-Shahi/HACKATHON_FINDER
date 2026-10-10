// Deadline reminders and change notifications, driven by the hourly Cron Trigger.
//
// Pipeline (each step is idempotent, so overlapping or repeated cron runs are safe):
//   1. cancelStaleReminders  – scheduled reminders whose deadline changed, whose
//      event is no longer saved/tracked, or whose preference was turned off.
//   2. scheduleReminders     – (re)compute reminder times for saved/tracked events
//      with deadlines in the next 8 days and upsert them by idempotency key.
//   3. deliverDueNotifications – deliver in-app reminders, send email reminders
//      (only when an email provider is configured), expire missed ones.
//
// Idempotency key = type:user:hackathon:deadlineVersion:interval:channel, backed
// by a UNIQUE constraint. A changed deadline produces a new key, so reminders for
// the new deadline are scheduled while the old ones are cancelled.
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { Database } from "../db/client";
import { notifications, notificationPreferences, user } from "../db/schema";
import type { AppBindings } from "../env";
import { DAY_MS, HOUR_MS, INACTIVE_TRACKING_STATUSES, type NotificationChannel, type ReminderInterval } from "@shared/constants";
import { computeReminderTime } from "@shared/time";
import { num } from "../db/queries/status-sql";
import { runBatch } from "../db/queries/hackathons";
import { isEmailConfigured, sendEmail } from "./email";
import { log } from "../lib/logger";

/** Reminders whose delivery time passed more than this long ago are not sent late. */
export const CATCH_UP_MS = 6 * HOUR_MS;
/** How far ahead reminders are materialized. Must exceed the longest interval (7d). */
export const SCHEDULE_HORIZON_MS = 8 * DAY_MS;

const INACTIVE = sql.raw(INACTIVE_TRACKING_STATUSES.map((s) => `'${s}'`).join(","));

export function reminderKey(userId: string, hackathonId: string, deadlineMs: number, interval: ReminderInterval, channel: NotificationChannel) {
	return `deadline_reminder:${userId}:${hackathonId}:${deadlineMs}:${interval}:${channel}`;
}

export interface ReminderRelation {
	userId: string;
	hackathonId: string;
	title: string;
	deadline: number;
}

export interface ReminderPreference {
	userId: string;
	interval: ReminderInterval;
	channel: NotificationChannel;
	deliveryTime: string;
	timezone: string;
}

const INTERVAL_PHRASE: Record<ReminderInterval, string> = {
	"7d": "in 7 days",
	"3d": "in 3 days",
	"24h": "in 24 hours",
	day_of: "today",
};

export function formatDeadline(deadlineMs: number, timeZone: string): string {
	try {
		return new Intl.DateTimeFormat("en-US", {
			timeZone,
			dateStyle: "medium",
			timeStyle: "short",
			timeZoneName: "short",
		}).format(new Date(deadlineMs));
	} catch {
		return new Date(deadlineMs).toISOString();
	}
}

/** Pure planning step (unit-tested): which reminder rows should exist right now. */
export function planReminders(relations: ReminderRelation[], prefs: ReminderPreference[], now: number) {
	const byUser = new Map<string, ReminderPreference[]>();
	for (const p of prefs) {
		const list = byUser.get(p.userId) ?? [];
		list.push(p);
		byUser.set(p.userId, list);
	}
	const rows: (typeof notifications.$inferInsert)[] = [];
	for (const r of relations) {
		if (r.deadline <= now) continue;
		for (const p of byUser.get(r.userId) ?? []) {
			const at = computeReminderTime(new Date(r.deadline), p.interval, p.timezone, p.deliveryTime).getTime();
			if (at < now - CATCH_UP_MS || at >= r.deadline) continue;
			rows.push({
				userId: r.userId,
				hackathonId: r.hackathonId,
				type: "deadline_reminder",
				channel: p.channel,
				reminderInterval: p.interval,
				title: `Deadline ${INTERVAL_PHRASE[p.interval]}: ${r.title}`.slice(0, 200),
				message: `Registration for "${r.title}" closes ${INTERVAL_PHRASE[p.interval]} — ${formatDeadline(r.deadline, p.timezone)}. Register on the official event page; HackRadar does not register for you.`,
				scheduledAt: new Date(at),
				deadlineVersion: r.deadline,
				status: "scheduled",
				idempotencyKey: reminderKey(r.userId, r.hackathonId, r.deadline, p.interval, p.channel),
			});
		}
	}
	return rows;
}

export interface ReminderScope {
	userId?: string;
	hackathonId?: string;
}

function scopeSql(scope: ReminderScope, userCol: string, hackathonCol: string) {
	const parts = [sql``];
	if (scope.userId) parts.push(sql` AND ${sql.raw(userCol)} = ${scope.userId}`);
	if (scope.hackathonId) parts.push(sql` AND ${sql.raw(hackathonCol)} = ${scope.hackathonId}`);
	return sql.join(parts, sql``);
}

export async function cancelStaleReminders(db: Database, scope: ReminderScope = {}) {
	const s = scopeSql(scope, "notifications.user_id", "notifications.hackathon_id");
	// Run sequentially (not in a batch): each statement is independently idempotent.
	const statements = [
		sql`UPDATE notifications SET status = 'cancelled', failure_reason = 'deadline_changed'
			WHERE status = 'scheduled' AND type = 'deadline_reminder' ${s}
			AND NOT EXISTS (SELECT 1 FROM hackathons h WHERE h.id = notifications.hackathon_id
				AND h.registration_deadline_at = notifications.deadline_version
				AND (h.source_status IS NULL OR h.source_status != 'cancelled'))`,
		sql`UPDATE notifications SET status = 'cancelled', failure_reason = 'not_tracked'
			WHERE status = 'scheduled' AND type = 'deadline_reminder' ${s}
			AND NOT EXISTS (SELECT 1 FROM bookmarks b WHERE b.user_id = notifications.user_id AND b.hackathon_id = notifications.hackathon_id)
			AND NOT EXISTS (SELECT 1 FROM user_hackathon_tracking t WHERE t.user_id = notifications.user_id
				AND t.hackathon_id = notifications.hackathon_id AND t.participation_status NOT IN (${INACTIVE}))`,
		sql`UPDATE notifications SET status = 'cancelled', failure_reason = 'preference_disabled'
			WHERE status = 'scheduled' AND type = 'deadline_reminder' ${s}
			AND NOT EXISTS (SELECT 1 FROM notification_preferences p WHERE p.user_id = notifications.user_id
				AND p.notification_type = 'deadline_reminder' AND p.reminder_interval = notifications.reminder_interval
				AND p.channel = notifications.channel AND p.enabled = 1)`,
	];
	let changes = 0;
	for (const stmt of statements) changes += (await db.run(stmt)).meta?.changes ?? 0;
	return changes;
}

export async function scheduleReminders(db: Database, now: number, scope: ReminderScope = {}) {
	const cancelled = await cancelStaleReminders(db, scope);
	const relations = await db.all<ReminderRelation>(sql`
		SELECT rel.user_id AS userId, h.id AS hackathonId, h.title AS title, h.registration_deadline_at AS deadline
		FROM (
			SELECT user_id, hackathon_id FROM bookmarks
			UNION
			SELECT user_id, hackathon_id FROM user_hackathon_tracking WHERE participation_status NOT IN (${INACTIVE})
		) rel
		JOIN hackathons h ON h.id = rel.hackathon_id
		WHERE h.registration_deadline_at IS NOT NULL
			AND h.registration_deadline_at > ${num(now)}
			AND h.registration_deadline_at <= ${num(now + SCHEDULE_HORIZON_MS)}
			AND (h.visibility = 'public' OR h.created_by_user_id = rel.user_id)
			AND (h.source_status IS NULL OR h.source_status != 'cancelled')
			${scopeSql(scope, "rel.user_id", "h.id")}
		LIMIT 5000`);
	if (!relations.length) return { scheduled: 0, cancelled };

	const userIds = [...new Set(relations.map((r) => r.userId))];
	const prefs: ReminderPreference[] = [];
	for (let i = 0; i < userIds.length; i += 90) {
		const rows = await db
			.select({
				userId: notificationPreferences.userId,
				interval: notificationPreferences.reminderInterval,
				channel: notificationPreferences.channel,
				deliveryTime: notificationPreferences.deliveryTime,
				timezone: notificationPreferences.timezone,
			})
			.from(notificationPreferences)
			.where(
				and(
					inArray(notificationPreferences.userId, userIds.slice(i, i + 90)),
					eq(notificationPreferences.notificationType, "deadline_reminder"),
					eq(notificationPreferences.enabled, true),
				),
			);
		prefs.push(...(rows as ReminderPreference[]));
	}

	const planned = planReminders(relations, prefs, now);
	for (let i = 0; i < planned.length; i += 100) {
		const stmts: BatchItem<"sqlite">[] = planned.slice(i, i + 100).map((row) =>
			db
				.insert(notifications)
				.values(row)
				.onConflictDoUpdate({
					target: notifications.idempotencyKey,
					set: {
						scheduledAt: sql`excluded.scheduled_at`,
						title: sql`excluded.title`,
						message: sql`excluded.message`,
						status: "scheduled",
						failureReason: null,
					},
					// Never touch reminders that were already delivered, skipped or failed.
					setWhere: sql`${notifications.status} IN ('scheduled', 'cancelled')`,
				}),
		);
		await runBatch(db, stmts);
	}
	return { scheduled: planned.length, cancelled };
}

export async function deliverDueNotifications(db: Database, env: AppBindings, now: number, fetcher: typeof fetch = fetch) {
	const nowDate = new Date(now);
	// Missed reminders whose deadline already passed are skipped, never sent late.
	const expired = await db.run(sql`UPDATE notifications SET status = 'skipped', failure_reason = 'deadline_passed'
		WHERE status = 'scheduled' AND scheduled_at <= ${num(now)} AND deadline_version IS NOT NULL AND deadline_version <= ${num(now)}`);
	// A single conditional UPDATE: a row can only move scheduled → delivered once.
	const inApp = await db.run(sql`UPDATE notifications SET status = 'delivered', delivered_at = ${num(now)}
		WHERE status = 'scheduled' AND channel = 'in_app' AND scheduled_at <= ${num(now)}`);

	let emailed = 0;
	let emailSkipped = 0;
	let emailFailed = 0;
	const dueEmails = await db
		.select({ id: notifications.id, title: notifications.title, message: notifications.message, hackathonId: notifications.hackathonId, email: user.email })
		.from(notifications)
		.innerJoin(user, eq(user.id, notifications.userId))
		.where(and(eq(notifications.status, "scheduled"), eq(notifications.channel, "email"), lte(notifications.scheduledAt, nowDate)))
		.limit(50);
	const emailReady = isEmailConfigured(env);
	for (const n of dueEmails) {
		// Claim the row first so overlapping runs can never send the same email twice.
		const claimed = await db
			.update(notifications)
			.set({ status: "delivering" })
			.where(and(eq(notifications.id, n.id), eq(notifications.status, "scheduled")))
			.returning({ id: notifications.id });
		if (!claimed.length) continue;
		if (!emailReady) {
			await db.update(notifications).set({ status: "skipped", failureReason: "email_not_configured" }).where(eq(notifications.id, n.id));
			emailSkipped++;
			continue;
		}
		const link = n.hackathonId ? `${env.BETTER_AUTH_URL.replace(/\/$/, "")}/hackathons/${n.hackathonId}` : env.BETTER_AUTH_URL;
		const result = await sendEmail(env, { to: n.email, subject: n.title, text: `${n.message}\n\nOpen in HackRadar: ${link}` }, fetcher);
		if (result.ok) {
			await db.update(notifications).set({ status: "delivered", deliveredAt: nowDate }).where(eq(notifications.id, n.id));
			emailed++;
		} else {
			await db.update(notifications).set({ status: "failed", failureReason: result.error }).where(eq(notifications.id, n.id));
			emailFailed++;
		}
	}
	const summary = {
		expired: expired.meta?.changes ?? 0,
		deliveredInApp: inApp.meta?.changes ?? 0,
		emailed,
		emailSkipped,
		emailFailed,
	};
	log("info", "reminders.delivered", summary);
	return summary;
}

/**
 * Notify users who saved/track an event that its registration deadline changed
 * (verified changes only: provider sync or administrator edits). In-app
 * notifications are delivered immediately; email ones are queued for the cron.
 */
export async function notifyDeadlineChange(
	db: Database,
	hackathon: { id: string; title: string },
	oldDeadline: Date | null,
	newDeadline: Date | null,
	now: number,
) {
	const recipients = await db.all<{ userId: string; channel: NotificationChannel; timezone: string }>(sql`
		SELECT DISTINCT rel.user_id AS userId, p.channel AS channel, p.timezone AS timezone
		FROM (
			SELECT user_id, hackathon_id FROM bookmarks WHERE hackathon_id = ${hackathon.id}
			UNION
			SELECT user_id, hackathon_id FROM user_hackathon_tracking WHERE hackathon_id = ${hackathon.id}
				AND participation_status NOT IN (${INACTIVE})
		) rel
		JOIN notification_preferences p ON p.user_id = rel.user_id
			AND p.notification_type = 'deadline_changed' AND p.enabled = 1`);
	const version = newDeadline?.getTime() ?? null;
	const stmts: BatchItem<"sqlite">[] = recipients.map((r) => {
		const describe = (d: Date | null) => (d ? formatDeadline(d.getTime(), r.timezone) : "not specified");
		return db
			.insert(notifications)
			.values({
				userId: r.userId,
				hackathonId: hackathon.id,
				type: "deadline_changed",
				channel: r.channel,
				reminderInterval: null,
				title: `Deadline changed: ${hackathon.title}`.slice(0, 200),
				message: `The registration deadline for "${hackathon.title}" changed from ${describe(oldDeadline)} to ${describe(newDeadline)}.`,
				scheduledAt: new Date(now),
				deliveredAt: r.channel === "in_app" ? new Date(now) : null,
				deadlineVersion: version,
				status: r.channel === "in_app" ? "delivered" : "scheduled",
				idempotencyKey: `deadline_changed:${r.userId}:${hackathon.id}:${version ?? "none"}:none:${r.channel}`,
			})
			.onConflictDoNothing();
	});
	await runBatch(db, stmts);
	await scheduleReminders(db, now, { hackathonId: hackathon.id });
	return recipients.length;
}
