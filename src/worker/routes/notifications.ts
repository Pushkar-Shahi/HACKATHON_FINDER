// In-app notifications and notification preferences.
import { Hono } from "hono";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { AppEnv } from "../env";
import { currentUserId, requireUser } from "../middleware/authentication";
import { validate } from "../middleware/validation";
import { notificationPreferencesUpdateSchema, notificationUpdateSchema } from "@shared/schemas";
import { NOTIFICATION_CHANNELS, REMINDER_INTERVALS, type NotificationChannel, type NotificationType, type ReminderInterval } from "@shared/constants";
import type { NotificationPreferences, NotificationRecord } from "@shared/types";
import { notificationPreferences, notifications } from "../db/schema";
import { notFound, ok, toIso } from "../lib/http";
import { isEmailConfigured } from "../services/email";
import { defaultNotificationPreferenceRows } from "../services/user-data";
import { scheduleReminders } from "../services/reminders";
import { runBatch } from "../db/queries/hackathons";
import type { Database } from "../db/client";

export const notificationRoutes = new Hono<AppEnv>();
notificationRoutes.use("*", requireUser);

const inAppDelivered = (userId: string) =>
	and(eq(notifications.userId, userId), eq(notifications.channel, "in_app"), eq(notifications.status, "delivered"));

const listQuery = z.object({
	unread: z.enum(["true", "false"]).optional(),
	page: z.coerce.number().int().min(1).max(500).default(1),
	pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

notificationRoutes.get("/", validate("query", listQuery), async (c) => {
	const userId = currentUserId(c);
	const { unread, page, pageSize } = c.req.valid("query");
	const where = and(inAppDelivered(userId), unread === "true" ? isNull(notifications.readAt) : undefined);
	const db = c.var.db;
	const [rows, total, unreadCount] = await db.batch([
		db.select().from(notifications).where(where).orderBy(desc(notifications.deliveredAt)).limit(pageSize).offset((page - 1) * pageSize),
		db.select({ n: sql<number>`count(*)` }).from(notifications).where(where),
		db.select({ n: sql<number>`count(*)` }).from(notifications).where(and(inAppDelivered(userId), isNull(notifications.readAt))),
	]);
	const data: NotificationRecord[] = rows.map((n) => ({
		id: n.id,
		type: n.type as NotificationType,
		title: n.title,
		message: n.message,
		channel: n.channel as NotificationChannel,
		hackathonId: n.hackathonId,
		deliveredAt: toIso(n.deliveredAt),
		readAt: toIso(n.readAt),
		createdAt: n.createdAt.toISOString(),
	}));
	const t = Number(total[0]?.n ?? 0);
	return ok(c, data, { page, pageSize, total: t, totalPages: Math.max(1, Math.ceil(t / pageSize)), unreadCount: Number(unreadCount[0]?.n ?? 0) });
});

notificationRoutes.get("/unread-count", async (c) => {
	const userId = currentUserId(c);
	const [row] = await c.var.db
		.select({ n: sql<number>`count(*)` })
		.from(notifications)
		.where(and(inAppDelivered(userId), isNull(notifications.readAt)));
	return ok(c, { unreadCount: Number(row?.n ?? 0) });
});

notificationRoutes.post("/read-all", async (c) => {
	const userId = currentUserId(c);
	const res = await c.var.db
		.update(notifications)
		.set({ readAt: new Date() })
		.where(and(inAppDelivered(userId), isNull(notifications.readAt)))
		.returning({ id: notifications.id });
	return ok(c, { updated: res.length });
});

notificationRoutes.patch("/:id", validate("json", notificationUpdateSchema), async (c) => {
	const userId = currentUserId(c);
	const [n] = await c.var.db
		.update(notifications)
		.set({ readAt: c.req.valid("json").read ? new Date() : null })
		.where(and(eq(notifications.id, c.req.param("id")), inAppDelivered(userId)))
		.returning({ id: notifications.id, readAt: notifications.readAt });
	if (!n) throw notFound("Notification");
	return ok(c, { id: n.id, readAt: toIso(n.readAt) });
});

// ---------------------------------------------------------------------------
// Preferences: /api/me/preferences
// ---------------------------------------------------------------------------

export const preferenceRoutes = new Hono<AppEnv>();
preferenceRoutes.use("*", requireUser);

async function loadPreferences(db: Database, userId: string, emailConfigured: boolean): Promise<NotificationPreferences> {
	let rows = await db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, userId));
	if (!rows.length) {
		await db.insert(notificationPreferences).values(defaultNotificationPreferenceRows(userId)).onConflictDoNothing();
		rows = await db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, userId));
	}
	const reminders = REMINDER_INTERVALS.flatMap((interval) =>
		NOTIFICATION_CHANNELS.map((channel) => ({
			interval,
			channel,
			enabled: rows.some((r) => r.notificationType === "deadline_reminder" && r.reminderInterval === interval && r.channel === channel && r.enabled),
		})),
	);
	const changed = (channel: NotificationChannel) =>
		rows.some((r) => r.notificationType === "deadline_changed" && r.channel === channel && r.enabled);
	return {
		deliveryTime: rows[0]?.deliveryTime ?? "09:00",
		timezone: rows[0]?.timezone ?? "UTC",
		reminders,
		deadlineChanged: { in_app: changed("in_app"), email: changed("email") },
		emailConfigured,
	};
}

preferenceRoutes.get("/", async (c) => {
	return ok(c, await loadPreferences(c.var.db, currentUserId(c), isEmailConfigured(c.env)));
});

preferenceRoutes.patch("/", validate("json", notificationPreferencesUpdateSchema), async (c) => {
	const userId = currentUserId(c);
	const body = c.req.valid("json");
	const db = c.var.db;
	const enabledFor = (interval: ReminderInterval, channel: NotificationChannel) =>
		body.reminders.find((r) => r.interval === interval && r.channel === channel)?.enabled ?? false;
	const rows = defaultNotificationPreferenceRows(userId, body.timezone).map((r) => ({
		...r,
		deliveryTime: body.deliveryTime,
		enabled:
			r.notificationType === "deadline_reminder"
				? enabledFor(r.reminderInterval as ReminderInterval, r.channel as NotificationChannel)
				: body.deadlineChanged[r.channel as NotificationChannel],
	}));
	await runBatch(
		db,
		rows.map((r) =>
			db
				.insert(notificationPreferences)
				.values(r)
				.onConflictDoUpdate({
					target: [notificationPreferences.userId, notificationPreferences.notificationType, notificationPreferences.reminderInterval, notificationPreferences.channel],
					set: { enabled: r.enabled, deliveryTime: r.deliveryTime, timezone: r.timezone, updatedAt: new Date() },
				}),
		),
	);
	// Re-plan this user's reminders immediately (cancels disabled ones, moves times).
	await scheduleReminders(db, Date.now(), { userId });
	return ok(c, await loadPreferences(db, userId, isEmailConfigured(c.env)));
});
