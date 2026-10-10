// Cron Trigger handler. Cron expressions run in UTC and must match
// wrangler.jsonc → triggers.crons exactly.
import type { AppBindings } from "./env";
import { createDb } from "./db/client";
import { runScheduledSync } from "./services/synchronization";
import { deliverDueNotifications, scheduleReminders } from "./services/reminders";
import { log, safeErrorMessage } from "./lib/logger";

export const SYNC_CRON = "15 */6 * * *";
export const REMINDER_CRON = "5 * * * *";

export async function runCron(cron: string, env: AppBindings, now: number) {
	const db = createDb(env.DB);
	if (cron === SYNC_CRON) {
		const results = await runScheduledSync(db, env, now);
		return { job: "sync", results };
	}
	if (cron === REMINDER_CRON) {
		const scheduled = await scheduleReminders(db, now);
		const delivered = await deliverDueNotifications(db, env, now);
		return { job: "reminders", scheduled, delivered };
	}
	log("warn", "cron.unknown", { cron });
	return { job: "unknown" };
}

export async function handleScheduled(controller: ScheduledController, env: AppBindings, _ctx: ExecutionContext) {
	try {
		const result = await runCron(controller.cron, env, controller.scheduledTime);
		log("info", "cron.finished", { cron: controller.cron, job: result.job });
	} catch (err) {
		log("error", "cron.failed", { cron: controller.cron, error: safeErrorMessage(err) });
		throw err;
	}
}
