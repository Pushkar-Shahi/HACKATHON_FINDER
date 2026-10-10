import { describe, expect, it } from "vitest";
import { planReminders, CATCH_UP_MS } from "../../src/worker/services/reminders";
import { scoreRecommendation } from "../../src/worker/services/recommendations";
import { normalizeFeedEvent, readFeedConfig, validateFeedUrl } from "../../src/worker/services/integrations/feed-adapter";
import { computeProviderStatus } from "../../src/worker/services/synchronization";
import type { HackathonSummary } from "../../src/shared/types";
import type { AppBindings } from "../../src/worker/env";

const NOW = Date.UTC(2026, 9, 10, 12);
const D = 86_400_000;

describe("planReminders", () => {
	const prefs = (["7d", "3d", "24h", "day_of"] as const).map((interval) => ({ userId: "u1", interval, channel: "in_app" as const, deliveryTime: "09:00", timezone: "UTC" }));
	it("produces one row per (user, event, deadline, interval, channel) and skips stale ones", () => {
		const rows = planReminders([{ userId: "u1", hackathonId: "h1", title: "T", deadline: NOW + 2 * D }], prefs, NOW);
		expect(rows.map((r) => r.reminderInterval).sort()).toEqual(["24h", "day_of"]);
		expect(new Set(rows.map((r) => r.idempotencyKey)).size).toBe(rows.length);
		expect(rows[0].idempotencyKey).toMatch(new RegExp(`^deadline_reminder:u1:h1:${NOW + 2 * D}:`));
		for (const r of rows) expect(r.scheduledAt!.getTime()).toBeGreaterThanOrEqual(NOW - CATCH_UP_MS);
	});
	it("ignores passed deadlines and users without preferences", () => {
		expect(planReminders([{ userId: "u1", hackathonId: "h", title: "T", deadline: NOW - 1 }], prefs, NOW)).toEqual([]);
		expect(planReminders([{ userId: "u2", hackathonId: "h", title: "T", deadline: NOW + 9 * D }], prefs, NOW)).toEqual([]);
	});
	it("a changed deadline yields different idempotency keys", () => {
		const a = planReminders([{ userId: "u1", hackathonId: "h1", title: "T", deadline: NOW + 9 * D }], prefs, NOW);
		const b = planReminders([{ userId: "u1", hackathonId: "h1", title: "T", deadline: NOW + 10 * D }], prefs, NOW);
		expect(a.map((r) => r.idempotencyKey).some((k) => b.map((x) => x.idempotencyKey).includes(k))).toBe(false);
	});
});

function summary(o: Partial<HackathonSummary>): HackathonSummary {
	return {
		id: "h",
		title: "T",
		organizer: null,
		platform: "other",
		shortDescription: null,
		canonicalUrl: "https://example.com",
		registrationUrl: null,
		coverImageUrl: null,
		registrationOpenAt: null,
		registrationDeadlineAt: new Date(NOW + 3 * D).toISOString(),
		eventStartAt: null,
		eventEndAt: null,
		eventTimezone: null,
		participationMode: "online",
		location: null,
		country: null,
		topics: ["ai"],
		technologies: [],
		prizeAmount: null,
		prizeCurrency: null,
		teamSizeMin: null,
		teamSizeMax: null,
		participationFeeAmount: null,
		participationFeeCurrency: null,
		eligibilitySummary: null,
		isStudentEligible: null,
		isBeginnerFriendly: null,
		isInternational: null,
		registrationStatus: "closing_soon",
		eventStatus: "upcoming",
		sourceStatus: null,
		dataQuality: "unverified",
		lastVerifiedAt: null,
		lastCheckedAt: null,
		createdAt: new Date(NOW).toISOString(),
		updatedAt: new Date(NOW).toISOString(),
		isDemo: false,
		visibility: "public",
		isOwner: false,
		publicationStatus: "none",
		viewer: null,
		...o,
	};
}

describe("recommendations", () => {
	const profile = { interests: ["ai" as const], preferredMode: "online" as const, experienceLevel: "beginner" as const, isStudent: true, country: null };
	it("explains why and flags unverified eligibility as a caution", () => {
		const r = scoreRecommendation(summary({}), profile, NOW)!;
		expect(r.reasons.join(" ")).toMatch(/Artificial intelligence/);
		expect(r.reasons.join(" ")).toMatch(/online participation preference/);
		expect(r.cautions.join(" ")).toMatch(/Student eligibility not stated/);
		expect(r.cautions.join(" ")).toMatch(/Beginner-friendliness not stated/);
	});
	it("excludes closed events, explicit ineligibility and irrelevant events", () => {
		expect(scoreRecommendation(summary({ registrationStatus: "closed" }), profile, NOW)).toBeNull();
		expect(scoreRecommendation(summary({ isStudentEligible: false }), profile, NOW)).toBeNull();
		expect(scoreRecommendation(summary({ topics: ["robotics"], participationMode: null }), profile, NOW)).toBeNull();
	});
});

describe("provider configuration", () => {
	const env = (o: Record<string, string>) => ({ ENVIRONMENT: "test", BETTER_AUTH_URL: "http://x.test", ...o }) as unknown as AppBindings;
	it("is manual with no configuration, setup-required when incomplete", () => {
		expect(readFeedConfig(env({}), "DEVPOST").mode).toBe("manual");
		const partial = readFeedConfig(env({ DEVPOST_FEED_URL: "https://feed.example.org/x" }), "DEVPOST");
		expect(partial).toMatchObject({ mode: "authorized_feed", valid: false });
		expect(computeProviderStatus(partial, undefined).status).toBe("setup_required");
		const ok = readFeedConfig(env({ DEVPOST_FEED_URL: "https://feed.example.org/x", DEVPOST_FEED_AUTHORIZATION_REF: "Agreement 1" }), "DEVPOST");
		expect(ok.valid).toBe(true);
		expect(computeProviderStatus(ok, undefined).status).toBe("setup_required"); // configured but never synced
	});
	it("refuses unsafe feed URLs", () => {
		expect(validateFeedUrl("http://feed.example.org")).toMatch(/https/);
		expect(validateFeedUrl("https://localhost/x")).toMatch(/public/);
		expect(validateFeedUrl("https://10.0.0.1/x")).toMatch(/IP/);
		expect(validateFeedUrl("https://user:pw@feed.example.org")).toMatch(/credentials/);
		expect(validateFeedUrl("https://feed.example.org/v1")).toBeNull();
	});
	it("normalizes and validates feed records", () => {
		const good = normalizeFeedEvent("mlh", { id: 42, title: "Hack", url: "https://e.example/h", topics: ["ai", "space"], prize: { amount: 100, currency: "usd" } });
		expect(good.ok && good.event.externalId).toBe("42");
		expect(good.ok && good.event.input.topics).toEqual(["ai"]);
		expect(good.ok && good.event.input.prizeCurrency).toBe("USD");
		const bad = normalizeFeedEvent("mlh", { id: "x", title: "Hack", url: "javascript:alert(1)" });
		expect(bad.ok).toBe(false);
	});
});
