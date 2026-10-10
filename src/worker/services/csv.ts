// CSV import/export for hackathons.
//
// Import is two-phase and never partially corrupts data:
//   1. preview → every row is parsed, validated with the same Zod schema as the
//      Add Hackathon form, and checked for likely duplicates. Nothing is written.
//   2. commit  → the server re-runs the whole preview (the client is never
//      trusted), then inserts only the selected valid rows in ONE D1 batch,
//      which is atomic: either every selected row is created or none is.
// Imports only ever create new private records; they never modify existing ones.
import { and, eq, inArray, or } from "drizzle-orm";
import type { Database } from "../db/client";
import { hackathons } from "../db/schema";
import { hackathonInputSchema, type HackathonInput } from "@shared/schemas";
import { MAX_CSV_ROWS, PARTICIPATION_MODES, PLATFORM_IDS, PLATFORM_LABELS, TOPICS, type PlatformId } from "@shared/constants";
import type { CsvPreview, CsvPreviewRow, HackathonSummary } from "@shared/types";
import { isWallTime, wallTimeToUtc } from "@shared/time";
import { isValidTimeZone } from "@shared/schemas";
import { canonicalUrlKey, normalizeTitle } from "./event-normalizer";

// ---------------------------------------------------------------------------
// RFC 4180 parsing / serialization
// ---------------------------------------------------------------------------

export class CsvParseError extends Error {}

/** Parse CSV text into rows of cells. Handles quotes, escaped quotes, CRLF/LF and a UTF-8 BOM. */
export function parseCsv(text: string): string[][] {
	const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = "";
	let inQuotes = false;
	let i = 0;
	while (i < input.length) {
		const ch = input[i];
		if (inQuotes) {
			if (ch === '"') {
				if (input[i + 1] === '"') {
					cell += '"';
					i += 2;
					continue;
				}
				inQuotes = false;
				i++;
				continue;
			}
			cell += ch;
			i++;
			continue;
		}
		if (ch === '"') {
			if (cell.length > 0) throw new CsvParseError(`Unexpected quote in an unquoted field on line ${rows.length + 1}`);
			inQuotes = true;
			i++;
		} else if (ch === ",") {
			row.push(cell);
			cell = "";
			i++;
		} else if (ch === "\r" || ch === "\n") {
			row.push(cell);
			rows.push(row);
			row = [];
			cell = "";
			i += ch === "\r" && input[i + 1] === "\n" ? 2 : 1;
		} else {
			cell += ch;
			i++;
		}
	}
	if (inQuotes) throw new CsvParseError("Unterminated quoted field at end of file");
	if (cell.length > 0 || row.length > 0) {
		row.push(cell);
		rows.push(row);
	}
	return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

/**
 * Neutralize spreadsheet formula injection: a cell beginning with = + - @ tab
 * or CR is prefixed with an apostrophe so Excel/Sheets treat it as text.
 */
export function sanitizeCell(value: string): string {
	return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export function serializeCsv(rows: (string | number | boolean | null | undefined)[][]): string {
	return (
		rows
			.map((r) =>
				r
					.map((v) => {
						if (v === null || v === undefined) return "";
						const s = typeof v === "string" ? sanitizeCell(v) : String(v);
						return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
					})
					.join(","),
			)
			.join("\r\n") + "\r\n"
	);
}

// ---------------------------------------------------------------------------
// Column mapping
// ---------------------------------------------------------------------------

export const CSV_COLUMNS = [
	"title",
	"official_url",
	"organizer",
	"platform",
	"registration_url",
	"description",
	"registration_opens",
	"registration_deadline",
	"event_start",
	"event_end",
	"timezone",
	"mode",
	"location",
	"country",
	"topics",
	"technologies",
	"prize_amount",
	"prize_currency",
	"prize_details",
	"team_size_min",
	"team_size_max",
	"participation_fee",
	"fee_currency",
	"eligibility",
	"eligibility_details",
	"student_eligible",
	"beginner_friendly",
	"international",
	"notes",
] as const;
type CsvColumn = (typeof CSV_COLUMNS)[number];

const ALIASES: Record<string, CsvColumn> = {
	url: "official_url",
	event_url: "official_url",
	canonical_url: "official_url",
	official_event_url: "official_url",
	deadline: "registration_deadline",
	registration_deadline_at: "registration_deadline",
	registration_opens_at: "registration_opens",
	registration_open: "registration_opens",
	start: "event_start",
	starts_at: "event_start",
	end: "event_end",
	ends_at: "event_end",
	participation_mode: "mode",
	tz: "timezone",
	prize: "prize_amount",
	currency: "prize_currency",
	fee: "participation_fee",
	eligibility_summary: "eligibility",
	students: "student_eligible",
	beginners: "beginner_friendly",
	open_internationally: "international",
	additional_notes: "notes",
};

export const REQUIRED_COLUMNS: CsvColumn[] = ["title", "official_url"];

function headerKey(h: string): string {
	return h
		.trim()
		.toLowerCase()
		.replace(/[\s-]+/g, "_");
}

export function resolveHeaders(headers: string[]) {
	const mapping = new Map<number, CsvColumn>();
	const unknown: string[] = [];
	headers.forEach((h, idx) => {
		const key = headerKey(h);
		const col = (CSV_COLUMNS as readonly string[]).includes(key) ? (key as CsvColumn) : ALIASES[key];
		if (col && ![...mapping.values()].includes(col)) mapping.set(idx, col);
		else if (h.trim()) unknown.push(h.trim());
	});
	const present = new Set(mapping.values());
	const missing = REQUIRED_COLUMNS.filter((c) => !present.has(c));
	return { mapping, unknown, missing };
}

const topicLookup = new Map<string, string>();
for (const t of TOPICS) {
	topicLookup.set(t.id, t.id);
	topicLookup.set(t.label.toLowerCase(), t.id);
}
const platformLookup = new Map<string, PlatformId>();
for (const p of PLATFORM_IDS) {
	platformLookup.set(p, p);
	platformLookup.set(PLATFORM_LABELS[p].toLowerCase(), p);
}
platformLookup.set("major league hacking", "mlh");
platformLookup.set("", "other");

function list(value: string): string[] {
	return value
		.split(/[;|]/)
		.map((v) => v.trim())
		.filter(Boolean);
}

function parseBool(value: string, column: string, errors: string[]): boolean | null {
	const v = value.trim().toLowerCase();
	if (!v || v === "unknown") return null;
	if (["yes", "y", "true", "1"].includes(v)) return true;
	if (["no", "n", "false", "0"].includes(v)) return false;
	errors.push(`${column}: use yes, no, or leave blank`);
	return null;
}

function parseNumber(value: string, column: string, errors: string[], integer = false): number | null {
	const v = value.trim().replace(/[,\s_]/g, "");
	if (!v) return null;
	const n = Number(v);
	if (!Number.isFinite(n) || (integer && !Number.isInteger(n))) {
		errors.push(`${column}: "${value.trim().slice(0, 30)}" is not a ${integer ? "whole " : ""}number`);
		return null;
	}
	return n;
}

function parseDate(value: string, column: string, timezone: string | null, errors: string[]): string | null {
	const v = value.trim();
	if (!v) return null;
	if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
		errors.push(`${column}: include a time (e.g. ${v} 23:59) — date-only values are ambiguous`);
		return null;
	}
	if (isWallTime(v)) {
		if (!timezone) {
			errors.push(`${column}: has no UTC offset, so the timezone column is required`);
			return null;
		}
		const d = wallTimeToUtc(v, timezone);
		if (!d) {
			errors.push(`${column}: "${v}" is not a valid date-time`);
			return null;
		}
		return d.toISOString();
	}
	const ms = Date.parse(v);
	if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(v) && Number.isFinite(ms)) return new Date(ms).toISOString();
	errors.push(`${column}: use ISO 8601 (2026-11-01T23:59:00+05:30) or "YYYY-MM-DD HH:MM" with a timezone column`);
	return null;
}

const stripFormulaGuard = (v: string) => (/^'[=+\-@]/.test(v) ? v.slice(1) : v);

/** Map one CSV row to validated hackathon input, collecting human-readable errors. */
export function mapCsvRow(cells: string[], mapping: Map<number, CsvColumn>): { input: HackathonInput | null; errors: string[]; title: string | null; url: string | null } {
	const get = (col: CsvColumn) => {
		for (const [idx, c] of mapping) if (c === col) return stripFormulaGuard((cells[idx] ?? "").trim());
		return "";
	};
	const errors: string[] = [];
	const tzRaw = get("timezone");
	const timezone = tzRaw ? (isValidTimeZone(tzRaw) ? tzRaw : null) : null;
	if (tzRaw && !timezone) errors.push(`timezone: "${tzRaw.slice(0, 40)}" is not an IANA timezone (e.g. Asia/Kolkata)`);

	const platformRaw = get("platform").toLowerCase();
	const platform = platformLookup.get(platformRaw);
	if (platform === undefined) errors.push(`platform: "${platformRaw.slice(0, 30)}" is not one of ${PLATFORM_IDS.join(", ")}`);

	const modeRaw = get("mode").toLowerCase().replace(/[\s-]+/g, "_");
	const mode = modeRaw ? ((PARTICIPATION_MODES as readonly string[]).includes(modeRaw) ? modeRaw : null) : null;
	if (modeRaw && !mode) errors.push(`mode: use online, in_person or hybrid`);

	const topics: string[] = [];
	for (const t of list(get("topics"))) {
		const id = topicLookup.get(t.toLowerCase());
		if (id) topics.push(id);
		else errors.push(`topics: unknown topic "${t.slice(0, 30)}"`);
	}

	const candidate = {
		title: get("title"),
		organizer: get("organizer") || null,
		platform: platform ?? "other",
		canonicalUrl: get("official_url"),
		registrationUrl: get("registration_url") || null,
		description: get("description") || null,
		registrationOpenAt: parseDate(get("registration_opens"), "registration_opens", timezone, errors),
		registrationDeadlineAt: parseDate(get("registration_deadline"), "registration_deadline", timezone, errors),
		eventStartAt: parseDate(get("event_start"), "event_start", timezone, errors),
		eventEndAt: parseDate(get("event_end"), "event_end", timezone, errors),
		eventTimezone: timezone,
		participationMode: mode,
		location: get("location") || null,
		country: get("country") || null,
		topics: [...new Set(topics)],
		technologies: list(get("technologies")),
		prizeAmount: parseNumber(get("prize_amount"), "prize_amount", errors),
		prizeCurrency: get("prize_currency") || null,
		prizeDetails: get("prize_details") || null,
		teamSizeMin: parseNumber(get("team_size_min"), "team_size_min", errors, true),
		teamSizeMax: parseNumber(get("team_size_max"), "team_size_max", errors, true),
		participationFeeAmount: parseNumber(get("participation_fee"), "participation_fee", errors),
		participationFeeCurrency: get("fee_currency") || null,
		eligibilitySummary: get("eligibility") || null,
		eligibilityDetails: get("eligibility_details") || null,
		isStudentEligible: parseBool(get("student_eligible"), "student_eligible", errors),
		isBeginnerFriendly: parseBool(get("beginner_friendly"), "beginner_friendly", errors),
		isInternational: parseBool(get("international"), "international", errors),
		sourceStatus: null,
		additionalNotes: get("notes") || null,
	};
	const title = candidate.title || null;
	const url = candidate.canonicalUrl || null;
	if (errors.length) return { input: null, errors, title, url };
	const parsed = hackathonInputSchema.safeParse(candidate);
	if (!parsed.success) {
		return {
			input: null,
			errors: parsed.error.issues.map((i) => `${i.path.join(".") || "row"}: ${i.message}`),
			title,
			url,
		};
	}
	return { input: parsed.data, errors: [], title, url };
}

export interface PreparedImport {
	preview: CsvPreview;
	inputs: Map<number, HackathonInput>;
}

/** Parse, validate and duplicate-check a CSV against records visible to `userId`. */
export async function prepareImport(db: Database, csv: string, userId: string): Promise<PreparedImport> {
	let rows: string[][];
	try {
		rows = parseCsv(csv);
	} catch (err) {
		throw new CsvParseError(err instanceof Error ? err.message : "Could not parse CSV");
	}
	if (rows.length === 0) throw new CsvParseError("The file is empty");
	const [headers, ...body] = rows;
	if (body.length > MAX_CSV_ROWS) throw new CsvParseError(`The file has ${body.length} rows; the limit is ${MAX_CSV_ROWS}`);
	const { mapping, unknown, missing } = resolveHeaders(headers);
	const preview: CsvPreview = {
		headers,
		unknownHeaders: unknown,
		missingRequiredHeaders: missing,
		totalRows: body.length,
		validCount: 0,
		invalidCount: 0,
		duplicateCount: 0,
		rows: [],
	};
	const inputs = new Map<number, HackathonInput>();
	if (missing.length) {
		preview.invalidCount = body.length;
		preview.rows = body.map((_, i) => ({ row: i + 1, status: "invalid", title: null, canonicalUrl: null, errors: [`Missing required column(s): ${missing.join(", ")}`], duplicateOf: null }));
		return { preview, inputs };
	}

	const mapped = body.map((cells, i) => ({ row: i + 1, cells, ...mapCsvRow(cells, mapping) }));
	for (const m of mapped) {
		if (m.cells.length > headers.length) m.errors.push(`Row has ${m.cells.length} cells but the header has ${headers.length}`);
	}

	// Look up possible duplicates among existing visible records (chunked for D1's parameter limit).
	const valid = mapped.filter((m) => m.input && m.errors.length === 0);
	const keys = [...new Set(valid.map((m) => canonicalUrlKey(m.input!.canonicalUrl)))];
	const titles = [...new Set(valid.map((m) => normalizeTitle(m.input!.title)))];
	const existing: { id: string; title: string; canonicalUrlKey: string; normalizedTitle: string }[] = [];
	const visible = or(eq(hackathons.visibility, "public"), eq(hackathons.createdByUserId, userId));
	for (let i = 0; i < Math.max(keys.length, titles.length); i += 40) {
		const k = keys.slice(i, i + 40);
		const t = titles.slice(i, i + 40);
		const found = await db
			.select({ id: hackathons.id, title: hackathons.title, canonicalUrlKey: hackathons.canonicalUrlKey, normalizedTitle: hackathons.normalizedTitle })
			.from(hackathons)
			.where(and(visible, or(k.length ? inArray(hackathons.canonicalUrlKey, k) : undefined, t.length ? inArray(hackathons.normalizedTitle, t) : undefined)));
		existing.push(...found);
	}

	const seenInFile = new Map<string, number>();
	for (const m of mapped) {
		const out: CsvPreviewRow = { row: m.row, status: "valid", title: m.title, canonicalUrl: m.url, errors: m.errors, duplicateOf: null };
		if (!m.input || m.errors.length) {
			out.status = "invalid";
			preview.invalidCount++;
		} else {
			const key = canonicalUrlKey(m.input.canonicalUrl);
			const title = normalizeTitle(m.input.title);
			const byUrl = existing.find((e) => e.canonicalUrlKey === key);
			const byTitle = existing.find((e) => e.normalizedTitle === title);
			if (byUrl) out.duplicateOf = { id: byUrl.id, title: byUrl.title, reason: "Same official URL as an existing event" };
			else if (seenInFile.has(key)) out.duplicateOf = { id: "", title: `Row ${seenInFile.get(key)}`, reason: "Same official URL as an earlier row in this file" };
			else if (byTitle) out.duplicateOf = { id: byTitle.id, title: byTitle.title, reason: "Same title as an existing event (different URL)" };
			if (!seenInFile.has(key)) seenInFile.set(key, m.row);
			if (out.duplicateOf) {
				out.status = "duplicate";
				preview.duplicateCount++;
			} else {
				preview.validCount++;
			}
			inputs.set(m.row, m.input);
		}
		preview.rows.push(out);
	}
	return { preview, inputs };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export interface ExportExtra {
	status?: string;
	priority?: string;
	personalNotes?: string | null;
	teamName?: string | null;
}

export function hackathonsToCsv(items: { summary: HackathonSummary; description?: string | null; extra?: ExportExtra }[], includeTracking: boolean): string {
	const header: string[] = [
		"title",
		"official_url",
		"organizer",
		"platform",
		"registration_url",
		"description",
		"registration_opens",
		"registration_deadline",
		"event_start",
		"event_end",
		"timezone",
		"mode",
		"location",
		"country",
		"topics",
		"technologies",
		"prize_amount",
		"prize_currency",
		"team_size_min",
		"team_size_max",
		"participation_fee",
		"fee_currency",
		"eligibility",
		"student_eligible",
		"beginner_friendly",
		"international",
		"registration_status",
		"last_verified_at",
		"is_demo",
	];
	if (includeTracking) header.push("tracker_status", "priority", "personal_notes", "team_name");
	const yn = (b: boolean | null) => (b === null ? "" : b ? "yes" : "no");
	const rows = items.map(({ summary: s, description, extra }) => {
		const r: (string | number | null)[] = [
			s.title,
			s.canonicalUrl,
			s.organizer,
			s.platform,
			s.registrationUrl,
			description ?? s.shortDescription,
			s.registrationOpenAt,
			s.registrationDeadlineAt,
			s.eventStartAt,
			s.eventEndAt,
			s.eventTimezone,
			s.participationMode,
			s.location,
			s.country,
			s.topics.join(";"),
			s.technologies.join(";"),
			s.prizeAmount,
			s.prizeCurrency,
			s.teamSizeMin,
			s.teamSizeMax,
			s.participationFeeAmount,
			s.participationFeeCurrency,
			s.eligibilitySummary,
			yn(s.isStudentEligible),
			yn(s.isBeginnerFriendly),
			yn(s.isInternational),
			s.registrationStatus,
			s.lastVerifiedAt,
			s.isDemo ? "yes" : "no",
		];
		if (includeTracking) r.push(extra?.status ?? "", extra?.priority ?? "", extra?.personalNotes ?? "", extra?.teamName ?? "");
		return r;
	});
	return serializeCsv([header, ...rows]);
}
