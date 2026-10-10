import { describe, expect, it } from "vitest";
import { computeReminderTime, isWallTime, utcToWallTime, wallTimeToUtc } from "../../src/shared/time";

describe("timezone conversion", () => {
	it("converts wall-clock times in a named zone to UTC", () => {
		expect(wallTimeToUtc("2026-11-01T23:59", "Asia/Kolkata")!.toISOString()).toBe("2026-11-01T18:29:00.000Z");
		expect(wallTimeToUtc("2026-07-01 09:00", "America/New_York")!.toISOString()).toBe("2026-07-01T13:00:00.000Z"); // EDT
		expect(wallTimeToUtc("2026-12-01 09:00", "America/New_York")!.toISOString()).toBe("2026-12-01T14:00:00.000Z"); // EST
		expect(wallTimeToUtc("2026-03-10T10:00:30", "UTC")!.toISOString()).toBe("2026-03-10T10:00:30.000Z");
	});
	it("rejects malformed or impossible dates", () => {
		expect(wallTimeToUtc("2026-02-30T10:00", "UTC")).toBeNull();
		expect(wallTimeToUtc("not a date", "UTC")).toBeNull();
		expect(wallTimeToUtc("2026-13-01T10:00", "UTC")).toBeNull();
		expect(isWallTime("2026-11-01T10:00Z")).toBe(false);
	});
	it("round-trips UTC instants back to wall time", () => {
		expect(utcToWallTime("2026-11-01T18:29:00.000Z", "Asia/Kolkata")).toBe("2026-11-01T23:59");
		expect(utcToWallTime("2026-07-01T13:00:00.000Z", "America/New_York")).toBe("2026-07-01T09:00");
	});
});

describe("reminder scheduling times", () => {
	const deadline = new Date("2026-11-20T18:29:00.000Z"); // 23:59 IST on Nov 20
	it("24h is exact", () => {
		expect(computeReminderTime(deadline, "24h", "Asia/Kolkata", "09:00").toISOString()).toBe("2026-11-19T18:29:00.000Z");
	});
	it("day-based reminders use the user's local delivery time", () => {
		// 09:00 IST = 03:30 UTC
		expect(computeReminderTime(deadline, "7d", "Asia/Kolkata", "09:00").toISOString()).toBe("2026-11-13T03:30:00.000Z");
		expect(computeReminderTime(deadline, "3d", "Asia/Kolkata", "09:00").toISOString()).toBe("2026-11-17T03:30:00.000Z");
		expect(computeReminderTime(deadline, "day_of", "Asia/Kolkata", "09:00").toISOString()).toBe("2026-11-20T03:30:00.000Z");
	});
	it("uses the user's zone, not the event's, and honours DST", () => {
		// Deadline at 2026-11-03 12:00 UTC; New York switched back to EST on Nov 1.
		const d = new Date("2026-11-03T12:00:00.000Z");
		expect(computeReminderTime(d, "7d", "America/New_York", "09:00").toISOString()).toBe("2026-10-27T13:00:00.000Z"); // EDT
		expect(computeReminderTime(d, "day_of", "America/New_York", "06:00").toISOString()).toBe("2026-11-03T11:00:00.000Z"); // EST
	});
	it("falls back to 3h before when the delivery time is after the deadline", () => {
		const early = new Date("2026-11-20T01:00:00.000Z"); // 06:30 IST
		expect(computeReminderTime(early, "day_of", "Asia/Kolkata", "09:00").toISOString()).toBe("2026-11-19T22:00:00.000Z");
	});
});
