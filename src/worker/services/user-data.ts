// Per-user data lifecycle: defaults on sign-up, and purging on request.
import { and, eq } from "drizzle-orm";
import type { Database } from "../db/client";
import {
	activityLog,
	bookmarks,
	collections,
	hackathons,
	milestones,
	notificationPreferences,
	notifications,
	profiles,
	userHackathonTracking,
} from "../db/schema";
import { NOTIFICATION_CHANNELS, REMINDER_INTERVALS } from "@shared/constants";

/** Default reminders: in-app at 3 days, 24 hours and on the deadline day; email off. */
const DEFAULT_IN_APP_INTERVALS = new Set(["3d", "24h", "day_of"]);

export function defaultNotificationPreferenceRows(userId: string, timezone = "UTC") {
	const rows: (typeof notificationPreferences.$inferInsert)[] = [];
	for (const interval of REMINDER_INTERVALS) {
		for (const channel of NOTIFICATION_CHANNELS) {
			rows.push({
				userId,
				notificationType: "deadline_reminder",
				reminderInterval: interval,
				channel,
				enabled: channel === "in_app" && DEFAULT_IN_APP_INTERVALS.has(interval),
				deliveryTime: "09:00",
				timezone,
			});
		}
	}
	for (const channel of NOTIFICATION_CHANNELS) {
		rows.push({
			userId,
			notificationType: "deadline_changed",
			reminderInterval: "none",
			channel,
			enabled: channel === "in_app",
			deliveryTime: "09:00",
			timezone,
		});
	}
	return rows;
}

export async function createDefaultUserData(db: Database, userId: string, name: string | null) {
	await db.batch([
		db.insert(profiles).values({ userId, displayName: name || null }).onConflictDoNothing(),
		db.insert(notificationPreferences).values(defaultNotificationPreferenceRows(userId)).onConflictDoNothing(),
	]);
}

/**
 * Delete the user's private tracking data (tracker, bookmarks, collections,
 * milestones, notifications, activity) and their private events. Shared public
 * events they once submitted stay (ownership is cleared by ON DELETE SET NULL
 * when the account itself is deleted).
 */
export async function purgeUserData(db: Database, userId: string) {
	await db.batch([
		db.delete(userHackathonTracking).where(eq(userHackathonTracking.userId, userId)),
		db.delete(bookmarks).where(eq(bookmarks.userId, userId)),
		db.delete(collections).where(eq(collections.userId, userId)),
		db.delete(milestones).where(eq(milestones.userId, userId)),
		db.delete(notifications).where(eq(notifications.userId, userId)),
		db.delete(activityLog).where(eq(activityLog.userId, userId)),
		db.delete(hackathons).where(and(eq(hackathons.createdByUserId, userId), eq(hackathons.visibility, "private"))),
	]);
}
