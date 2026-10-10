// Reusable "authorized feed" adapter.
//
// None of the four platforms publishes an open events API that HackRadar may
// use (see each provider file). The only automated path we support is a feed
// the operator is explicitly authorized to consume — e.g. API access granted
// under a partner agreement, or an organizer's own export — delivered in the
// documented HackRadar Feed v1 JSON format (docs/feed-format.md).
//
// A feed is used only when BOTH <PREFIX>_FEED_URL and
// <PREFIX>_FEED_AUTHORIZATION_REF are set. Without them the provider stays in
// Manual Mode, and nothing is ever fetched from the platform's website.
import { z } from "zod";
import { hackathonInputSchema } from "@shared/schemas";
import { PARTICIPATION_MODES, SOURCE_STATUSES, TOPIC_IDS, type SourcePlatformId } from "@shared/constants";
import type { AppBindings } from "../../env";
import {
	ProviderResponseError,
	ProviderUnavailableError,
	type FetchOptions,
	type FetchResult,
	type NormalizeResult,
	type ProviderAdapter,
	type ProviderConfig,
} from "./types";

const iso = z.iso.datetime({ offset: true }).nullish();

/** HackRadar Feed v1 — one event. Unknown keys are ignored; missing fields stay null. */
export const feedEventSchema = z.object({
	id: z.union([z.string(), z.number()]).transform(String).pipe(z.string().min(1).max(200)),
	title: z.string(),
	url: z.string(),
	registrationUrl: z.string().nullish(),
	description: z.string().nullish(),
	organizer: z.string().nullish(),
	coverImageUrl: z.string().nullish(),
	registrationOpensAt: iso,
	registrationDeadlineAt: iso,
	startsAt: iso,
	endsAt: iso,
	timezone: z.string().nullish(),
	mode: z.enum(PARTICIPATION_MODES).nullish(),
	location: z.string().nullish(),
	country: z.string().nullish(),
	topics: z.array(z.string()).nullish(),
	technologies: z.array(z.string()).nullish(),
	prize: z.object({ amount: z.number().nullish(), currency: z.string().nullish(), details: z.string().nullish() }).nullish(),
	teamSize: z.object({ min: z.number().int().nullish(), max: z.number().int().nullish() }).nullish(),
	fee: z.object({ amount: z.number().nullish(), currency: z.string().nullish() }).nullish(),
	eligibility: z
		.object({
			summary: z.string().nullish(),
			details: z.string().nullish(),
			students: z.boolean().nullish(),
			beginners: z.boolean().nullish(),
			international: z.boolean().nullish(),
		})
		.nullish(),
	status: z.enum(SOURCE_STATUSES).nullish(),
	updatedAt: iso,
});

export const feedPageSchema = z.object({
	version: z.literal(1),
	events: z.array(z.unknown()).max(1000),
	nextCursor: z.string().max(500).nullish(),
});

const topicSet = new Set<string>(TOPIC_IDS);

/** Reject non-https URLs and obvious internal targets. Feed URLs come from operator secrets, but we still validate. */
export function validateFeedUrl(raw: string): string | null {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return "Feed URL is not a valid URL";
	}
	if (url.protocol !== "https:") return "Feed URL must use https";
	const host = url.hostname.toLowerCase();
	if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
		return "Feed URL must be a public host";
	}
	if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.startsWith("[")) return "Feed URL must use a hostname, not an IP address";
	if (url.username || url.password) return "Put credentials in the FEED_TOKEN secret, not in the URL";
	return null;
}

export function readFeedConfig(env: AppBindings, prefix: string): ProviderConfig {
	const e = env as unknown as Record<string, string | undefined>;
	const feedUrl = e[`${prefix}_FEED_URL`]?.trim() || null;
	const token = e[`${prefix}_FEED_TOKEN`]?.trim() || null;
	const authorizationRef = e[`${prefix}_FEED_AUTHORIZATION_REF`]?.trim() || null;
	if (!feedUrl && !authorizationRef) {
		return { mode: "manual", valid: false, problem: null, feedUrl: null, token: null, authorizationRef: null };
	}
	if (!feedUrl) {
		return { mode: "authorized_feed", valid: false, problem: `${prefix}_FEED_URL is not set`, feedUrl, token, authorizationRef };
	}
	const urlProblem = validateFeedUrl(feedUrl);
	if (urlProblem) return { mode: "authorized_feed", valid: false, problem: urlProblem, feedUrl, token, authorizationRef };
	if (!authorizationRef) {
		return {
			mode: "authorized_feed",
			valid: false,
			problem: `${prefix}_FEED_AUTHORIZATION_REF is not set — record the agreement or permission that authorizes this feed`,
			feedUrl,
			token,
			authorizationRef,
		};
	}
	return { mode: "authorized_feed", valid: true, problem: null, feedUrl, token, authorizationRef };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET with bounded retries for transient failures and Retry-After awareness. */
export async function fetchWithRetry(url: string, init: RequestInit, fetcher: typeof fetch, retries = 2): Promise<Response> {
	let lastError: unknown = null;
	for (let attempt = 0; attempt <= retries; attempt++) {
		try {
			const res = await fetcher(url, { ...init, signal: AbortSignal.timeout(15_000) });
			if (res.status === 429) {
				const retryAfter = Number(res.headers.get("retry-after"));
				const wait = Number.isFinite(retryAfter) ? retryAfter : null;
				// Respect short Retry-After windows inline; otherwise stop and report rate limiting.
				if (wait !== null && wait <= 5 && attempt < retries) {
					await sleep(wait * 1000);
					continue;
				}
				throw new ProviderUnavailableError("Provider rate limit reached (HTTP 429)", wait);
			}
			if (res.status >= 500) {
				lastError = new ProviderUnavailableError(`Provider returned HTTP ${res.status}`);
				if (attempt < retries) {
					await sleep(500 * 2 ** attempt);
					continue;
				}
				throw lastError;
			}
			if (!res.ok) throw new ProviderResponseError(`Provider returned HTTP ${res.status}`);
			return res;
		} catch (err) {
			if (err instanceof ProviderUnavailableError || err instanceof ProviderResponseError) throw err;
			lastError = new ProviderUnavailableError(`Network error contacting provider: ${err instanceof Error ? err.name : "unknown"}`);
			if (attempt < retries) {
				await sleep(500 * 2 ** attempt);
				continue;
			}
		}
	}
	throw lastError ?? new ProviderUnavailableError("Provider unavailable");
}

export async function fetchFeed(config: ProviderConfig, opts: FetchOptions): Promise<FetchResult> {
	if (!config.valid || !config.feedUrl) throw new ProviderResponseError(config.problem ?? "Provider is not configured");
	const records: unknown[] = [];
	let cursor: string | null = null;
	let pages = 0;
	do {
		const url = new URL(config.feedUrl);
		if (opts.since) url.searchParams.set("updated_since", opts.since.toISOString());
		if (cursor) url.searchParams.set("cursor", cursor);
		const headers: Record<string, string> = { Accept: "application/json", "User-Agent": "HackRadar/1.0 (+authorized-feed)" };
		if (config.token) headers.Authorization = `Bearer ${config.token}`;
		const res = await fetchWithRetry(url.toString(), { headers }, opts.fetcher);
		let body: unknown;
		try {
			body = await res.json();
		} catch {
			throw new ProviderResponseError("Feed response was not valid JSON");
		}
		const page = feedPageSchema.safeParse(body);
		if (!page.success) throw new ProviderResponseError("Feed response does not match HackRadar Feed v1 (expected { version: 1, events: [...] })");
		records.push(...page.data.events);
		cursor = page.data.nextCursor ?? null;
		pages++;
	} while (cursor && pages < opts.maxPages);
	return { records, pagesFetched: pages, truncated: Boolean(cursor) };
}

/** Map a feed record into validated HackRadar input for the given platform. */
export function normalizeFeedEvent(platformId: SourcePlatformId, raw: unknown): NormalizeResult {
	const parsed = feedEventSchema.safeParse(raw);
	const rawId = raw && typeof raw === "object" && "id" in raw ? String((raw as { id: unknown }).id).slice(0, 200) : null;
	if (!parsed.success) {
		const first = parsed.error.issues[0];
		return { ok: false, externalId: rawId, reason: `Invalid feed record: ${first?.path.join(".") || "record"} — ${first?.message ?? "invalid"}` };
	}
	const e = parsed.data;
	const unknownTopics = (e.topics ?? []).filter((t) => !topicSet.has(t));
	const candidate = {
		title: e.title,
		organizer: e.organizer ?? null,
		platform: platformId,
		canonicalUrl: e.url,
		registrationUrl: e.registrationUrl ?? null,
		coverImageUrl: e.coverImageUrl?.startsWith("https://") ? e.coverImageUrl : null,
		description: e.description ?? null,
		registrationOpenAt: e.registrationOpensAt ?? null,
		registrationDeadlineAt: e.registrationDeadlineAt ?? null,
		eventStartAt: e.startsAt ?? null,
		eventEndAt: e.endsAt ?? null,
		eventTimezone: e.timezone ?? null,
		participationMode: e.mode ?? null,
		location: e.location ?? null,
		country: e.country ?? null,
		topics: (e.topics ?? []).filter((t) => topicSet.has(t)).slice(0, 10),
		technologies: [...unknownTopics, ...(e.technologies ?? [])].slice(0, 20),
		prizeAmount: e.prize?.amount ?? null,
		prizeCurrency: e.prize?.currency ?? null,
		prizeDetails: e.prize?.details ?? null,
		teamSizeMin: e.teamSize?.min ?? null,
		teamSizeMax: e.teamSize?.max ?? null,
		participationFeeAmount: e.fee?.amount ?? null,
		participationFeeCurrency: e.fee?.currency ?? null,
		eligibilitySummary: e.eligibility?.summary ?? null,
		eligibilityDetails: e.eligibility?.details ?? null,
		isStudentEligible: e.eligibility?.students ?? null,
		isBeginnerFriendly: e.eligibility?.beginners ?? null,
		isInternational: e.eligibility?.international ?? null,
		sourceStatus: e.status ?? null,
		additionalNotes: null,
	};
	const valid = hackathonInputSchema.safeParse(candidate);
	if (!valid.success) {
		const first = valid.error.issues[0];
		return { ok: false, externalId: e.id, reason: `Failed validation: ${first?.path.join(".") || "record"} — ${first?.message ?? "invalid"}` };
	}
	return {
		ok: true,
		event: {
			externalId: e.id,
			input: valid.data,
			sourceUpdatedAt: e.updatedAt ? new Date(e.updatedAt) : null,
			metadata: { feedVersion: 1 },
		},
	};
}

export interface FeedAdapterSpec {
	platformId: SourcePlatformId;
	displayName: string;
	homepageUrl: string;
	envPrefix: string;
	policySummary: string;
	manualWorkflow: string;
}

export function createFeedAdapter(spec: FeedAdapterSpec): ProviderAdapter {
	return {
		platformId: spec.platformId,
		displayName: spec.displayName,
		homepageUrl: spec.homepageUrl,
		policySummary: spec.policySummary,
		manualWorkflow: spec.manualWorkflow,
		getConfig: (env) => readFeedConfig(env, spec.envPrefix),
		fetchEvents: (config, opts) => fetchFeed(config, opts),
		normalizeEvent: (raw) => normalizeFeedEvent(spec.platformId, raw),
	};
}
