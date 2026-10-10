// Pure date/status logic shared by the Worker and the React app.
//
// IMPORTANT: deriveRegistrationStatus / deriveEventStatus have SQL mirrors in
// src/worker/db/queries/status-sql.ts (used for filtering in D1). The
// integration test tests/api/status-consistency.test.ts asserts that both
// implementations agree, so change them together.
import {
	CLOSING_SOON_MS,
	DAY_MS,
	HOUR_MS,
	SOURCE_STATUS_FRESH_MS,
	URGENT_MS,
	VERIFICATION_STALE_MS,
	type EventStatus,
	type RegistrationStatus,
	type SourceStatus,
} from "./constants";

/** Timestamps are epoch milliseconds in UTC; null means "not known". */
export interface DatedEvent {
	registrationOpenAt: number | null;
	registrationDeadlineAt: number | null;
	eventStartAt: number | null;
	eventEndAt: number | null;
	sourceStatus: SourceStatus | null;
	lastVerifiedAt: number | null;
}

function sourceStatusIsFresh(e: DatedEvent, now: number): boolean {
	return e.lastVerifiedAt !== null && now - e.lastVerifiedAt <= SOURCE_STATUS_FRESH_MS;
}

/**
 * HackRadar's classification of registration state. Dates win over stale
 * source statuses; a recently verified explicit source status wins over dates.
 * Missing dates never get invented values — they produce "unknown".
 */
export function deriveRegistrationStatus(e: DatedEvent, now: number): RegistrationStatus {
	const fresh = sourceStatusIsFresh(e, now);
	if (e.sourceStatus === "cancelled") return "closed";
	if (e.sourceStatus === "closed" && fresh) return "closed";
	if (e.registrationOpenAt !== null && e.registrationOpenAt > now) return "opening_soon";
	if (e.registrationDeadlineAt !== null) {
		if (e.registrationDeadlineAt <= now) return e.sourceStatus === "open" && fresh ? "open" : "closed";
		return e.registrationDeadlineAt - now <= CLOSING_SOON_MS ? "closing_soon" : "open";
	}
	if (e.sourceStatus === "closed") return "closed";
	if (e.eventEndAt !== null && e.eventEndAt <= now) return "closed";
	if (e.sourceStatus === "open" && fresh) return "open";
	return "unknown";
}

export function deriveEventStatus(e: DatedEvent, now: number): EventStatus {
	if (e.sourceStatus === "cancelled") return "cancelled";
	if (e.eventStartAt !== null && now < e.eventStartAt) return "upcoming";
	if (e.eventEndAt !== null && now >= e.eventEndAt) return "completed";
	if (e.eventStartAt !== null && e.eventEndAt !== null) return "ongoing";
	// Started (or start unknown) but no end date: we cannot honestly say whether it is running.
	return "needs_verification";
}

/** Inconsistencies between stored dates and explicit source status, for review queues. */
export function findContradictions(e: DatedEvent, now: number): string[] {
	const issues: string[] = [];
	if (e.sourceStatus === "closed" && e.registrationDeadlineAt !== null && e.registrationDeadlineAt > now) {
		issues.push("Source reports registration closed, but the stored deadline is in the future.");
	}
	if (e.sourceStatus === "open" && e.registrationDeadlineAt !== null && e.registrationDeadlineAt <= now) {
		issues.push("Source reports registration open, but the stored deadline has passed.");
	}
	if (e.registrationOpenAt !== null && e.eventEndAt !== null && e.registrationOpenAt > e.eventEndAt) {
		issues.push("Registration opens after the event ends.");
	}
	if (e.eventStartAt !== null && e.eventEndAt !== null && e.eventStartAt > e.eventEndAt) {
		issues.push("Event end is before the event start.");
	}
	return issues;
}

export type UrgencyKind = "unknown" | "passed" | "within_48h" | "within_7d" | "approaching" | "later";

/** Urgency label for a registration deadline. Never fabricates a countdown for unknown dates. */
export function deadlineUrgency(deadline: number | null, now: number): { kind: UrgencyKind; label: string } {
	if (deadline === null) return { kind: "unknown", label: "Deadline not verified" };
	const remaining = deadline - now;
	if (remaining <= 0) return { kind: "passed", label: "Deadline passed" };
	if (remaining <= URGENT_MS) return { kind: "within_48h", label: "Closing within 48 hours" };
	if (remaining <= CLOSING_SOON_MS) return { kind: "within_7d", label: "Closing within 7 days" };
	if (remaining <= 30 * DAY_MS) return { kind: "approaching", label: "Deadline approaching" };
	return { kind: "later", label: "" };
}

/** Compact remaining-time text, e.g. "3d 4h", "5h 12m", "12m". */
export function formatTimeRemaining(ms: number): string {
	if (ms <= 0) return "0m";
	const days = Math.floor(ms / DAY_MS);
	const hours = Math.floor((ms % DAY_MS) / HOUR_MS);
	const minutes = Math.floor((ms % HOUR_MS) / 60_000);
	if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
	if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
	return `${Math.max(minutes, 1)}m`;
}

export type VerificationState = "verified" | "stale" | "unverified";

export function verificationState(lastVerifiedAt: number | null, now: number): VerificationState {
	if (lastVerifiedAt === null) return "unverified";
	return now - lastVerifiedAt <= VERIFICATION_STALE_MS ? "verified" : "stale";
}

// ---------------------------------------------------------------------------
// Money. Amounts are stored as integers in the currency's minor unit (cents,
// paise, ...) so they never suffer floating-point drift.
// ---------------------------------------------------------------------------

export function currencyFractionDigits(currency: string): number {
	try {
		return new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
	} catch {
		return 2;
	}
}

export function toMinorUnits(amount: number, currency: string): number {
	return Math.round(amount * 10 ** currencyFractionDigits(currency));
}

export function fromMinorUnits(minor: number, currency: string): number {
	return minor / 10 ** currencyFractionDigits(currency);
}

export function formatMoney(amount: number, currency: string, locale = "en-US"): string {
	try {
		return new Intl.NumberFormat(locale, {
			style: "currency",
			currency,
			maximumFractionDigits: amount % 1 === 0 ? 0 : currencyFractionDigits(currency),
		}).format(amount);
	} catch {
		return `${amount} ${currency}`;
	}
}
