// RFC 5545 iCalendar generation. All instants are written in UTC ("Z") so any
// calendar app converts them to the viewer's local timezone correctly.

export interface IcsEvent {
	uid: string;
	start: Date;
	/** Omit for point-in-time entries such as deadlines (zero-duration events). */
	end?: Date | null;
	summary: string;
	description?: string | null;
	url?: string | null;
	/** Adds a display alarm this many minutes before start. */
	alarmMinutesBefore?: number | null;
}

export function icsDate(d: Date): string {
	return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function escapeIcsText(s: string): string {
	return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

const encoder = new TextEncoder();

/** Fold content lines longer than 75 octets (UTF-8 safe), per RFC 5545 §3.1. */
export function foldLine(line: string): string {
	if (encoder.encode(line).length <= 75) return line;
	const parts: string[] = [];
	let current = "";
	let currentBytes = 0;
	for (const ch of line) {
		const bytes = encoder.encode(ch).length;
		const limit = parts.length === 0 ? 75 : 74; // continuation lines start with a space
		if (currentBytes + bytes > limit) {
			parts.push(current);
			current = "";
			currentBytes = 0;
		}
		current += ch;
		currentBytes += bytes;
	}
	parts.push(current);
	return parts.join("\r\n ");
}

export function buildIcs(events: IcsEvent[], calendarName = "HackRadar", now = new Date()): string {
	const lines = [
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//HackRadar//Hackathon Tracker//EN",
		"CALSCALE:GREGORIAN",
		"METHOD:PUBLISH",
		`X-WR-CALNAME:${escapeIcsText(calendarName)}`,
	];
	for (const e of events) {
		lines.push("BEGIN:VEVENT");
		lines.push(`UID:${e.uid}@hackradar`);
		lines.push(`DTSTAMP:${icsDate(now)}`);
		lines.push(`DTSTART:${icsDate(e.start)}`);
		if (e.end && e.end.getTime() > e.start.getTime()) lines.push(`DTEND:${icsDate(e.end)}`);
		lines.push(`SUMMARY:${escapeIcsText(e.summary)}`);
		if (e.description) lines.push(`DESCRIPTION:${escapeIcsText(e.description)}`);
		if (e.url && /^https?:\/\//.test(e.url)) lines.push(`URL:${e.url}`);
		if (e.alarmMinutesBefore) {
			lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escapeIcsText(e.summary)}`, `TRIGGER:-PT${Math.round(e.alarmMinutesBefore)}M`, "END:VALARM");
		}
		lines.push("END:VEVENT");
	}
	lines.push("END:VCALENDAR");
	return lines.map(foldLine).join("\r\n") + "\r\n";
}

export interface IcsSource {
	id: string;
	title: string;
	canonicalUrl: string;
	registrationOpenAt: Date | null;
	registrationDeadlineAt: Date | null;
	eventStartAt: Date | null;
	eventEndAt: Date | null;
	isDemo: boolean;
}

export type IcsKind = "registration_open" | "registration_deadline" | "event";

/** Turn a hackathon into calendar entries. Unknown dates produce no entry. */
export function hackathonToIcsEvents(h: IcsSource, kinds: IcsKind[] = ["registration_open", "registration_deadline", "event"]): IcsEvent[] {
	const demo = h.isDemo ? " [DEMO — fictional sample event]" : "";
	const desc = `Official event page: ${h.canonicalUrl}${demo}\nDates as stored in HackRadar; confirm on the official page.`;
	const out: IcsEvent[] = [];
	if (kinds.includes("registration_open") && h.registrationOpenAt) {
		out.push({ uid: `${h.id}-open`, start: h.registrationOpenAt, summary: `Registration opens: ${h.title}${demo}`, description: desc, url: h.canonicalUrl });
	}
	if (kinds.includes("registration_deadline") && h.registrationDeadlineAt) {
		out.push({
			uid: `${h.id}-deadline`,
			start: h.registrationDeadlineAt,
			summary: `Registration deadline: ${h.title}${demo}`,
			description: desc,
			url: h.canonicalUrl,
			alarmMinutesBefore: 24 * 60,
		});
	}
	if (kinds.includes("event") && h.eventStartAt) {
		out.push({ uid: `${h.id}-event`, start: h.eventStartAt, end: h.eventEndAt, summary: `${h.title}${demo}`, description: desc, url: h.canonicalUrl });
	}
	return out;
}
