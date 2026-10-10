// Normalization shared by manual entry, CSV import, admin edits and provider sync.
import type { HackathonInput } from "@shared/schemas";
import { PLATFORM_LABELS, TOPIC_LABELS, type TopicId } from "@shared/constants";
import { toMinorUnits } from "@shared/status";

/** Lower-case, strip accents/punctuation, collapse whitespace. Used for duplicate detection and sorting. */
export function normalizeTitle(title: string): string {
	return title
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/&/g, " and ")
		.replace(/[^a-z0-9]+/g, " ")
		.trim()
		.replace(/\s+/g, " ");
}

const TRACKING_PARAMS = /^(utm_[a-z]+|ref|ref_src|source|fbclid|gclid|mc_cid|mc_eid|igshid|_ga)$/i;

/**
 * Canonical comparison key for an event URL: https, lower-case host without
 * "www.", no fragment, no tracking parameters, sorted query, no trailing slash.
 * Returns the trimmed input if it is not a parseable URL.
 */
export function canonicalUrlKey(raw: string): string {
	try {
		const url = new URL(raw.trim());
		const host = url.hostname.toLowerCase().replace(/^www\./, "");
		const params = [...url.searchParams.entries()].filter(([k]) => !TRACKING_PARAMS.test(k)).sort(([a], [b]) => a.localeCompare(b));
		const query = params.length ? "?" + new URLSearchParams(params).toString() : "";
		const port = url.port && url.port !== "443" && url.port !== "80" ? `:${url.port}` : "";
		const path = url.pathname.replace(/\/+$/, "") || "";
		return `https://${host}${port}${path}${query}`;
	} catch {
		return raw.trim().toLowerCase();
	}
}

export function normalizeTechnology(label: string): { slug: string; label: string } {
	const clean = label.trim().replace(/\s+/g, " ").slice(0, 40);
	const slug = clean
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/\+/g, "plus")
		.replace(/#/g, "sharp")
		.replace(/[^a-z0-9.]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return { slug: slug || "unknown", label: clean };
}

export function buildSearchText(input: HackathonInput): string {
	return [
		input.title,
		input.organizer,
		input.description,
		PLATFORM_LABELS[input.platform],
		input.platform,
		input.location,
		input.country,
		input.eligibilitySummary,
		input.eligibilityDetails,
		input.prizeDetails,
		...input.topics.map((t: TopicId) => TOPIC_LABELS[t]),
		...input.technologies,
	]
		.filter(Boolean)
		.join(" • ")
		.toLowerCase()
		.slice(0, 20_000);
}

const ms = (iso: string | null) => (iso ? new Date(iso) : null);

/** Map validated input to hackathons-table column values (excluding ownership/visibility). */
export function toHackathonColumns(input: HackathonInput) {
	return {
		title: input.title,
		normalizedTitle: normalizeTitle(input.title),
		description: input.description,
		organizer: input.organizer,
		primaryPlatformId: input.platform,
		canonicalUrl: input.canonicalUrl,
		canonicalUrlKey: canonicalUrlKey(input.canonicalUrl),
		registrationUrl: input.registrationUrl,
		coverImageUrl: input.coverImageUrl,
		registrationOpenAt: ms(input.registrationOpenAt),
		registrationDeadlineAt: ms(input.registrationDeadlineAt),
		eventStartAt: ms(input.eventStartAt),
		eventEndAt: ms(input.eventEndAt),
		eventTimezone: input.eventTimezone,
		participationMode: input.participationMode,
		location: input.location,
		country: input.country,
		prizeAmountMinor: input.prizeAmount !== null && input.prizeCurrency ? toMinorUnits(input.prizeAmount, input.prizeCurrency) : null,
		prizeCurrency: input.prizeAmount !== null ? input.prizeCurrency : null,
		prizeDetails: input.prizeDetails,
		teamSizeMin: input.teamSizeMin,
		teamSizeMax: input.teamSizeMax,
		participationFeeMinor:
			input.participationFeeAmount === null
				? null
				: input.participationFeeAmount === 0
					? 0
					: toMinorUnits(input.participationFeeAmount, input.participationFeeCurrency ?? "USD"),
		participationFeeCurrency: input.participationFeeAmount ? input.participationFeeCurrency : null,
		eligibilitySummary: input.eligibilitySummary,
		eligibilityDetails: input.eligibilityDetails,
		isStudentEligible: input.isStudentEligible,
		isBeginnerFriendly: input.isBeginnerFriendly,
		isInternational: input.isInternational,
		additionalNotes: input.additionalNotes,
		sourceStatus: input.sourceStatus,
		searchText: buildSearchText(input),
	};
}
export type HackathonColumns = ReturnType<typeof toHackathonColumns>;
