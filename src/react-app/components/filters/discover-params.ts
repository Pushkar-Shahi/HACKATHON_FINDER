// Discover-page filter state lives in the URL so views are shareable and the
// dashboard cards can deep-link to filtered views (e.g. /discover?deadline=7d).
import type { QueryValue } from "@/lib/api";
import {
	DEADLINE_WINDOW_LABELS,
	EVENT_STATUS_LABELS,
	PARTICIPATION_MODE_LABELS,
	PLATFORM_LABELS,
	REGISTRATION_STATUS_LABELS,
	SORT_OPTIONS,
	TOPIC_LABELS,
	type DeadlineWindow,
	type EventStatus,
	type ParticipationMode,
	type PlatformId,
	type RegistrationStatus,
	type SortOption,
	type TopicId,
} from "@shared/constants";
import { wallTimeToUtc } from "@shared/time";
import { localTimeZone } from "@/lib/format";

export interface DiscoverFilters {
	q: string;
	platforms: PlatformId[];
	registration: RegistrationStatus[];
	status: EventStatus[];
	modes: ParticipationMode[];
	topics: TopicId[];
	deadline: DeadlineWindow | "";
	deadlineFrom: string; // YYYY-MM-DD, viewer's local date
	deadlineTo: string;
	beginner: boolean;
	students: boolean;
	international: boolean;
	free: boolean;
	minPrize: string;
	prizeCurrency: string;
	teamSize: string;
	country: string;
	organizer: string;
	saved: boolean;
	tracked: boolean;
	mine: boolean;
	sort: SortOption;
	page: number;
}

const list = <T extends string>(p: URLSearchParams, key: string, allowed: Record<T, string>): T[] =>
	(p.get(key) ?? "")
		.split(",")
		.filter((v): v is T => v in allowed);

export function readFilters(p: URLSearchParams): DiscoverFilters {
	const sort = p.get("sort") as SortOption;
	const deadline = p.get("deadline") as DeadlineWindow;
	return {
		q: p.get("q") ?? "",
		platforms: list(p, "platforms", PLATFORM_LABELS),
		registration: list(p, "registration", REGISTRATION_STATUS_LABELS),
		status: list(p, "status", EVENT_STATUS_LABELS),
		modes: list(p, "modes", PARTICIPATION_MODE_LABELS),
		topics: list(p, "topics", TOPIC_LABELS),
		deadline: deadline && deadline in DEADLINE_WINDOW_LABELS ? deadline : "",
		deadlineFrom: p.get("from") ?? "",
		deadlineTo: p.get("to") ?? "",
		beginner: p.get("beginner") === "true",
		students: p.get("students") === "true",
		international: p.get("international") === "true",
		free: p.get("free") === "true",
		minPrize: p.get("minPrize") ?? "",
		prizeCurrency: p.get("prizeCurrency") ?? "",
		teamSize: p.get("teamSize") ?? "",
		country: p.get("country") ?? "",
		organizer: p.get("organizer") ?? "",
		saved: p.get("saved") === "true",
		tracked: p.get("tracked") === "true",
		mine: p.get("mine") === "true",
		sort: SORT_OPTIONS.includes(sort) ? sort : "deadline",
		page: Math.max(1, Number(p.get("page")) || 1),
	};
}

export function writeFilters(f: DiscoverFilters, base?: URLSearchParams): URLSearchParams {
	const p = new URLSearchParams();
	const view = base?.get("view");
	if (view) p.set("view", view);
	const set = (k: string, v: string | boolean | string[] | number) => {
		if (Array.isArray(v) ? v.length : v) p.set(k, Array.isArray(v) ? v.join(",") : String(v));
	};
	set("q", f.q);
	set("platforms", f.platforms);
	set("registration", f.registration);
	set("status", f.status);
	set("modes", f.modes);
	set("topics", f.topics);
	set("deadline", f.deadline);
	if (f.deadline === "custom") {
		set("from", f.deadlineFrom);
		set("to", f.deadlineTo);
	}
	(["beginner", "students", "international", "free", "saved", "tracked", "mine"] as const).forEach((k) => f[k] && p.set(k, "true"));
	set("minPrize", f.minPrize);
	if (f.minPrize || f.sort === "prize") set("prizeCurrency", f.prizeCurrency);
	set("teamSize", f.teamSize);
	set("country", f.country);
	set("organizer", f.organizer);
	if (f.sort !== "deadline") p.set("sort", f.sort);
	if (f.page > 1) p.set("page", String(f.page));
	return p;
}

/** Convert UI filters to the API's query contract (local calendar dates → UTC instants). */
export function toApiQuery(f: DiscoverFilters, pageSize: number): Record<string, QueryValue> {
	const startOf = (d: string) => (d ? wallTimeToUtc(`${d}T00:00`, localTimeZone)?.toISOString() : undefined);
	const endOf = (d: string) => (d ? new Date((wallTimeToUtc(`${d}T00:00`, localTimeZone)?.getTime() ?? 0) + 86_400_000 - 1).toISOString() : undefined);
	const currency = f.prizeCurrency || (f.sort === "prize" || f.minPrize ? "USD" : "");
	return {
		q: f.q.trim() || undefined,
		platforms: f.platforms,
		registration: f.registration,
		status: f.status,
		modes: f.modes,
		topics: f.topics,
		deadline: f.deadline || undefined,
		deadlineFrom: f.deadline === "custom" ? startOf(f.deadlineFrom) : undefined,
		deadlineTo: f.deadline === "custom" ? endOf(f.deadlineTo) : undefined,
		beginner: f.beginner || undefined,
		students: f.students || undefined,
		international: f.international || undefined,
		free: f.free || undefined,
		minPrize: f.minPrize || undefined,
		prizeCurrency: currency || undefined,
		teamSize: f.teamSize || undefined,
		country: f.country.trim() || undefined,
		organizer: f.organizer.trim() || undefined,
		saved: f.saved || undefined,
		tracked: f.tracked || undefined,
		mine: f.mine || undefined,
		sort: f.sort,
		page: f.page,
		pageSize,
	};
}

export const EMPTY_FILTERS: DiscoverFilters = readFilters(new URLSearchParams());

export interface Chip {
	key: string;
	label: string;
	clear: (f: DiscoverFilters) => DiscoverFilters;
}

export function activeChips(f: DiscoverFilters): Chip[] {
	const chips: Chip[] = [];
	const multi = <K extends "platforms" | "registration" | "status" | "modes" | "topics">(key: K, labels: Record<string, string>, prefix: string) => {
		for (const v of f[key] as string[]) {
			chips.push({ key: `${key}:${v}`, label: `${prefix}${labels[v]}`, clear: (x) => ({ ...x, [key]: (x[key] as string[]).filter((y) => y !== v) }) });
		}
	};
	if (f.q) chips.push({ key: "q", label: `“${f.q}”`, clear: (x) => ({ ...x, q: "" }) });
	multi("platforms", PLATFORM_LABELS, "");
	multi("registration", REGISTRATION_STATUS_LABELS, "Registration: ");
	multi("status", EVENT_STATUS_LABELS, "");
	multi("modes", PARTICIPATION_MODE_LABELS, "");
	multi("topics", TOPIC_LABELS, "");
	if (f.deadline) {
		const label = f.deadline === "custom" ? `Deadline ${f.deadlineFrom || "…"} → ${f.deadlineTo || "…"}` : DEADLINE_WINDOW_LABELS[f.deadline];
		chips.push({ key: "deadline", label, clear: (x) => ({ ...x, deadline: "", deadlineFrom: "", deadlineTo: "" }) });
	}
	const flags: [keyof DiscoverFilters, string][] = [
		["beginner", "Beginner-friendly"],
		["students", "Open to students"],
		["international", "Open internationally"],
		["free", "Free to enter"],
		["saved", "Saved only"],
		["tracked", "In my tracker"],
		["mine", "Added by me"],
	];
	for (const [k, label] of flags) if (f[k]) chips.push({ key: k, label, clear: (x) => ({ ...x, [k]: false }) });
	if (f.minPrize) chips.push({ key: "minPrize", label: `Prize ≥ ${f.minPrize} ${f.prizeCurrency || "USD"}`, clear: (x) => ({ ...x, minPrize: "" }) });
	if (f.teamSize) chips.push({ key: "teamSize", label: `Team of ${f.teamSize}`, clear: (x) => ({ ...x, teamSize: "" }) });
	if (f.country) chips.push({ key: "country", label: `Location: ${f.country}`, clear: (x) => ({ ...x, country: "" }) });
	if (f.organizer) chips.push({ key: "organizer", label: `Organizer: ${f.organizer}`, clear: (x) => ({ ...x, organizer: "" }) });
	return chips;
}
