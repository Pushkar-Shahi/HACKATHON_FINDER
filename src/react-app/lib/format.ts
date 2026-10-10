// Display formatting. Dates are always shown in the viewer's local timezone,
// with the timezone named, and with the event's own timezone when it differs.
import { formatDistanceStrict } from "date-fns";
import { formatMoney } from "@shared/status";
import { detectTimeZone, timeZoneAbbreviation } from "@shared/time";

export const localTimeZone = detectTimeZone();

export function formatDateTime(iso: string | null, opts: { timeZone?: string; withZone?: boolean } = {}): string {
	if (!iso) return "Not announced";
	const tz = opts.timeZone ?? localTimeZone;
	try {
		const s = new Intl.DateTimeFormat(undefined, { timeZone: tz, dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
		return opts.withZone === false ? s : `${s} ${timeZoneAbbreviation(new Date(iso), tz)}`;
	} catch {
		return new Date(iso).toISOString();
	}
}

export function formatDate(iso: string | null, timeZone = localTimeZone): string {
	if (!iso) return "Not announced";
	return new Intl.DateTimeFormat(undefined, { timeZone, dateStyle: "medium" }).format(new Date(iso));
}

export function formatShortDate(iso: string, timeZone = localTimeZone): string {
	return new Intl.DateTimeFormat(undefined, { timeZone, month: "short", day: "numeric" }).format(new Date(iso));
}

export function formatTime(iso: string, timeZone = localTimeZone): string {
	return new Intl.DateTimeFormat(undefined, { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

/** "in 3 days" / "2 hours ago". */
export function formatRelative(iso: string | null, now = Date.now()): string {
	if (!iso) return "";
	return formatDistanceStrict(new Date(iso), new Date(now), { addSuffix: true });
}

export function formatDateRange(start: string | null, end: string | null): string {
	if (!start && !end) return "Dates not announced";
	if (start && end) {
		const sameDay = formatDate(start) === formatDate(end);
		return sameDay ? formatDate(start) : `${formatShortDate(start)} – ${formatDate(end)}`;
	}
	return start ? `Starts ${formatDate(start)}` : `Ends ${formatDate(end)}`;
}

export function formatPrize(amount: number | null, currency: string | null): string | null {
	if (amount === null || !currency) return null;
	return formatMoney(amount, currency);
}

export function formatTeamSize(min: number | null, max: number | null): string | null {
	if (min === null && max === null) return null;
	if (min !== null && max !== null) return min === max ? `${min} per team` : `${min}–${max} per team`;
	return min !== null ? `${min}+ per team` : `Up to ${max} per team`;
}

export function formatFee(amount: number | null, currency: string | null): string | null {
	if (amount === null) return null;
	if (amount === 0) return "Free";
	return currency ? formatMoney(amount, currency) : `${amount}`;
}

export function pluralize(n: number, word: string, plural = `${word}s`) {
	return `${n.toLocaleString()} ${n === 1 ? word : plural}`;
}
