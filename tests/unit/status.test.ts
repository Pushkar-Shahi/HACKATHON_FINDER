import { describe, expect, it } from "vitest";
import {
	deadlineUrgency,
	deriveEventStatus,
	deriveRegistrationStatus,
	findContradictions,
	formatTimeRemaining,
	fromMinorUnits,
	toMinorUnits,
	verificationState,
	type DatedEvent,
} from "../../src/shared/status";

const NOW = Date.UTC(2026, 9, 10, 12, 0, 0);
const H = 3_600_000;
const D = 24 * H;
const ev = (o: Partial<DatedEvent> = {}): DatedEvent => ({
	registrationOpenAt: null,
	registrationDeadlineAt: null,
	eventStartAt: null,
	eventEndAt: null,
	sourceStatus: null,
	lastVerifiedAt: null,
	...o,
});

describe("registration status", () => {
	it("derives from dates", () => {
		expect(deriveRegistrationStatus(ev({ registrationDeadlineAt: NOW + 10 * D }), NOW)).toBe("open");
		expect(deriveRegistrationStatus(ev({ registrationDeadlineAt: NOW + 3 * D }), NOW)).toBe("closing_soon");
		expect(deriveRegistrationStatus(ev({ registrationDeadlineAt: NOW - H }), NOW)).toBe("closed");
		expect(deriveRegistrationStatus(ev({ registrationOpenAt: NOW + D, registrationDeadlineAt: NOW + 9 * D }), NOW)).toBe("opening_soon");
	});
	it("never invents a status for missing dates", () => {
		expect(deriveRegistrationStatus(ev(), NOW)).toBe("unknown");
		// A stale "open" from the source is not trusted.
		expect(deriveRegistrationStatus(ev({ sourceStatus: "open", lastVerifiedAt: NOW - 10 * D }), NOW)).toBe("unknown");
		expect(deriveRegistrationStatus(ev({ sourceStatus: "open", lastVerifiedAt: NOW - H }), NOW)).toBe("open");
	});
	it("prefers recent explicit source status, records contradictions", () => {
		const e = ev({ sourceStatus: "closed", lastVerifiedAt: NOW - H, registrationDeadlineAt: NOW + 10 * D });
		expect(deriveRegistrationStatus(e, NOW)).toBe("closed");
		expect(findContradictions(e, NOW)).toHaveLength(1);
		expect(deriveRegistrationStatus(ev({ sourceStatus: "cancelled", registrationDeadlineAt: NOW + 10 * D }), NOW)).toBe("closed");
		expect(deriveRegistrationStatus(ev({ eventEndAt: NOW - D }), NOW)).toBe("closed");
	});
});

describe("event status", () => {
	it("classifies by start/end", () => {
		expect(deriveEventStatus(ev({ eventStartAt: NOW + D, eventEndAt: NOW + 2 * D }), NOW)).toBe("upcoming");
		expect(deriveEventStatus(ev({ eventStartAt: NOW - D, eventEndAt: NOW + D }), NOW)).toBe("ongoing");
		expect(deriveEventStatus(ev({ eventStartAt: NOW - 2 * D, eventEndAt: NOW - D }), NOW)).toBe("completed");
		expect(deriveEventStatus(ev({ sourceStatus: "cancelled", eventStartAt: NOW + D }), NOW)).toBe("cancelled");
	});
	it("needs verification when it cannot be known", () => {
		expect(deriveEventStatus(ev(), NOW)).toBe("needs_verification");
		expect(deriveEventStatus(ev({ eventStartAt: NOW - D }), NOW)).toBe("needs_verification");
	});
});

describe("countdowns and urgency", () => {
	it("labels deadlines", () => {
		expect(deadlineUrgency(null, NOW)).toEqual({ kind: "unknown", label: "Deadline not verified" });
		expect(deadlineUrgency(NOW + 30 * H, NOW).label).toBe("Closing within 48 hours");
		expect(deadlineUrgency(NOW + 5 * D, NOW).label).toBe("Closing within 7 days");
		expect(deadlineUrgency(NOW + 20 * D, NOW).label).toBe("Deadline approaching");
		expect(deadlineUrgency(NOW - 1, NOW).label).toBe("Deadline passed");
		expect(deadlineUrgency(NOW + 60 * D, NOW).kind).toBe("later");
	});
	it("formats remaining time", () => {
		expect(formatTimeRemaining(3 * D + 4 * H + 5 * 60_000)).toBe("3d 4h");
		expect(formatTimeRemaining(5 * H + 12 * 60_000)).toBe("5h 12m");
		expect(formatTimeRemaining(12 * 60_000)).toBe("12m");
		expect(formatTimeRemaining(20_000)).toBe("1m");
		expect(formatTimeRemaining(-5)).toBe("0m");
	});
	it("tracks verification freshness", () => {
		expect(verificationState(null, NOW)).toBe("unverified");
		expect(verificationState(NOW - D, NOW)).toBe("verified");
		expect(verificationState(NOW - 8 * D, NOW)).toBe("stale");
	});
});

describe("money", () => {
	it("uses each currency's minor unit", () => {
		expect(toMinorUnits(1234.56, "USD")).toBe(123456);
		expect(toMinorUnits(0.1 + 0.2, "USD")).toBe(30);
		expect(toMinorUnits(5000, "JPY")).toBe(5000);
		expect(fromMinorUnits(123456, "USD")).toBe(1234.56);
		expect(fromMinorUnits(5000, "JPY")).toBe(5000);
	});
});
