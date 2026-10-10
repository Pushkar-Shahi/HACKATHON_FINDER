// SQL mirrors of deriveRegistrationStatus / deriveEventStatus in
// src/shared/status.ts, so status filters can run inside D1. Keep in sync;
// tests/api/status-consistency.test.ts compares both implementations.
import { sql, type SQL } from "drizzle-orm";
import { CLOSING_SOON_MS, SOURCE_STATUS_FRESH_MS, type EventStatus, type RegistrationStatus } from "@shared/constants";
import { hackathons as h } from "../schema";

/**
 * Inline a server-generated integer into SQL. Only ever used for values the
 * Worker computes itself (timestamps, constants) — never for user input, which
 * always goes through bound parameters. Inlining keeps queries well under
 * D1's 100-bound-parameter limit.
 */
export function num(n: number): SQL {
	if (!Number.isFinite(n)) throw new Error("num() requires a finite number");
	return sql.raw(String(Math.trunc(n)));
}

export function registrationStatusSql(now: number): SQL<RegistrationStatus> {
	const NOW = num(now);
	const fresh = sql`(${h.lastVerifiedAt} IS NOT NULL AND ${NOW} - ${h.lastVerifiedAt} <= ${num(SOURCE_STATUS_FRESH_MS)})`;
	return sql<RegistrationStatus>`(CASE
		WHEN ${h.sourceStatus} = 'cancelled' THEN 'closed'
		WHEN ${h.sourceStatus} = 'closed' AND ${fresh} THEN 'closed'
		WHEN ${h.registrationOpenAt} IS NOT NULL AND ${h.registrationOpenAt} > ${NOW} THEN 'opening_soon'
		WHEN ${h.registrationDeadlineAt} IS NOT NULL AND ${h.registrationDeadlineAt} <= ${NOW}
			THEN (CASE WHEN ${h.sourceStatus} = 'open' AND ${fresh} THEN 'open' ELSE 'closed' END)
		WHEN ${h.registrationDeadlineAt} IS NOT NULL AND ${h.registrationDeadlineAt} - ${NOW} <= ${num(CLOSING_SOON_MS)} THEN 'closing_soon'
		WHEN ${h.registrationDeadlineAt} IS NOT NULL THEN 'open'
		WHEN ${h.sourceStatus} = 'closed' THEN 'closed'
		WHEN ${h.eventEndAt} IS NOT NULL AND ${h.eventEndAt} <= ${NOW} THEN 'closed'
		WHEN ${h.sourceStatus} = 'open' AND ${fresh} THEN 'open'
		ELSE 'unknown'
	END)`;
}

export function eventStatusSql(now: number): SQL<EventStatus> {
	const NOW = num(now);
	return sql<EventStatus>`(CASE
		WHEN ${h.sourceStatus} = 'cancelled' THEN 'cancelled'
		WHEN ${h.eventStartAt} IS NOT NULL AND ${NOW} < ${h.eventStartAt} THEN 'upcoming'
		WHEN ${h.eventEndAt} IS NOT NULL AND ${NOW} >= ${h.eventEndAt} THEN 'completed'
		WHEN ${h.eventStartAt} IS NOT NULL AND ${h.eventEndAt} IS NOT NULL THEN 'ongoing'
		ELSE 'needs_verification'
	END)`;
}
