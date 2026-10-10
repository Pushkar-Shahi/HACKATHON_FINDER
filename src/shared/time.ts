// Timezone-aware conversions shared by the client and the Worker.
//
// Storage rule: every instant is stored in UTC. A wall-clock time ("Nov 1,
// 23:59") only becomes an instant once we know which IANA timezone it belongs
// to. These helpers never assume a timezone — callers must pass one.
import { TZDate } from "@date-fns/tz";
import { HOUR_MS, type ReminderInterval } from "./constants";

const WALL_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;

/** True for "YYYY-MM-DDTHH:mm[:ss]" (no offset) — a wall-clock time needing a timezone. */
export function isWallTime(value: string): boolean {
	return WALL_TIME.test(value.trim());
}

/**
 * Convert a wall-clock time in `timeZone` to a UTC Date.
 * Returns null for malformed input or impossible calendar dates.
 * During a DST gap the instant is shifted forward, matching how clocks behave.
 */
export function wallTimeToUtc(value: string, timeZone: string): Date | null {
	const m = WALL_TIME.exec(value.trim());
	if (!m) return null;
	const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? "0"].map(Number);
	if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
	const date = TZDate.tz(timeZone, y, mo - 1, d, h, mi, s);
	if (Number.isNaN(date.getTime())) return null;
	// Reject rollovers such as Feb 30 → Mar 2.
	if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
	return new Date(date.getTime());
}

/** Format a UTC instant as "YYYY-MM-DDTHH:mm" in `timeZone` (for datetime-local inputs). */
export function utcToWallTime(iso: string | Date, timeZone: string): string {
	const date = new TZDate(typeof iso === "string" ? Date.parse(iso) : iso.getTime(), timeZone);
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Short timezone label such as "IST", "GMT+5:30" or "PDT" for a given instant. */
export function timeZoneAbbreviation(at: Date, timeZone: string, locale = "en-US"): string {
	try {
		const parts = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: "short" }).formatToParts(at);
		return parts.find((p) => p.type === "timeZoneName")?.value ?? timeZone;
	} catch {
		return timeZone;
	}
}

/**
 * When a deadline reminder should be delivered.
 *  - "24h": exactly 24 hours before the deadline.
 *  - "7d" / "3d": that many calendar days before the deadline's local date,
 *    at the user's preferred local delivery time.
 *  - "day_of": on the deadline's local date at the delivery time; if that is
 *    at/after the deadline itself (e.g. a 06:00 deadline with 09:00 delivery),
 *    fall back to 3 hours before the deadline.
 * All calculations happen in the user's timezone, so DST shifts are honoured.
 */
export function computeReminderTime(deadline: Date, interval: ReminderInterval, timeZone: string, deliveryTime: string): Date {
	if (interval === "24h") return new Date(deadline.getTime() - 24 * HOUR_MS);
	const [hh, mm] = deliveryTime.split(":").map(Number);
	const local = new TZDate(deadline.getTime(), timeZone);
	const daysBefore = interval === "7d" ? 7 : interval === "3d" ? 3 : 0;
	const target = TZDate.tz(timeZone, local.getFullYear(), local.getMonth(), local.getDate() - daysBefore, hh, mm, 0);
	if (target.getTime() >= deadline.getTime()) return new Date(deadline.getTime() - 3 * HOUR_MS);
	return new Date(target.getTime());
}

/** The browser/runtime timezone, used only as a visible default the user can change. */
export function detectTimeZone(): string {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
	} catch {
		return "UTC";
	}
}

/** All IANA zones the runtime knows (falls back to a short list on old runtimes). */
export function listTimeZones(): string[] {
	const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
	const zones = intl.supportedValuesOf?.("timeZone") ?? [];
	const base = zones.length > 0 ? zones : ["UTC", "America/New_York", "America/Los_Angeles", "Europe/London", "Europe/Berlin", "Asia/Kolkata", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney"];
	return base.includes("UTC") ? base : ["UTC", ...base];
}
