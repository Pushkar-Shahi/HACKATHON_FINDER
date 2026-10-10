import { describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:test";
import { api, DAY, signUp } from "../helpers";
import { createDb } from "../../src/worker/db/client";
import { syncProvider, getSourceStatuses, runScheduledSync } from "../../src/worker/services/synchronization";
import { PROVIDERS } from "../../src/worker/services/integrations";
import type { AppBindings } from "../../src/worker/env";

const baseEnv = env as unknown as AppBindings;

function feedEnv(prefix: string): AppBindings {
	return {
		...baseEnv,
		[`${prefix}_FEED_URL`]: "https://feed.partner.example/hackathons",
		[`${prefix}_FEED_TOKEN`]: "secret-token-value",
		[`${prefix}_FEED_AUTHORIZATION_REF`]: "Test partner agreement #42",
	} as AppBindings;
}

function feedEvent(id: string, overrides: Record<string, unknown> = {}) {
	return {
		id,
		title: `Feed Event ${id}`,
		url: `https://partner.example/e/${id}`,
		registrationDeadlineAt: new Date(Date.now() + 10 * DAY).toISOString(),
		startsAt: new Date(Date.now() + 12 * DAY).toISOString(),
		endsAt: new Date(Date.now() + 13 * DAY).toISOString(),
		timezone: "UTC",
		mode: "online",
		topics: ["ai", "quantum-stuff"],
		updatedAt: new Date().toISOString(),
		...overrides,
	};
}

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("provider synchronization", () => {
	it("manual-mode providers are never contacted and report Manual Mode", async () => {
		const db = createDb(baseEnv.DB);
		const fetcher = vi.fn();
		const summary = await syncProvider(db, baseEnv, PROVIDERS.devpost, { trigger: "admin", fetcher: fetcher as unknown as typeof fetch });
		expect(summary.status).toBe("skipped");
		expect(fetcher).not.toHaveBeenCalled();
		const statuses = await getSourceStatuses(db, baseEnv);
		expect(statuses.map((s) => s.status)).toEqual(["manual_mode", "manual_mode", "manual_mode", "manual_mode"]);
		expect(statuses.every((s) => s.lastSuccessfulSyncAt === null)).toBe(true);
	});

	it("a feed URL without an authorization reference is Setup Required and not fetched", async () => {
		const db = createDb(baseEnv.DB);
		const e = { ...baseEnv, MLH_FEED_URL: "https://feed.partner.example/mlh" } as AppBindings;
		const fetcher = vi.fn();
		await syncProvider(db, e, PROVIDERS.mlh, { trigger: "admin", fetcher: fetcher as unknown as typeof fetch });
		expect(fetcher).not.toHaveBeenCalled();
		const mlh = (await getSourceStatuses(db, e)).find((s) => s.platform === "mlh")!;
		expect(mlh.status).toBe("setup_required");
		expect(mlh.statusDetail).toMatch(/AUTHORIZATION_REF/);
	});

	it("imports, updates incrementally, notifies on deadline change, and never deletes on failure", async () => {
		const db = createDb(baseEnv.DB);
		const e = feedEnv("UNSTOP");
		const ids = [`u-${crypto.randomUUID()}`, `u-${crypto.randomUUID()}`];
		const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
			expect(new Headers(init?.headers).get("authorization")).toBe("Bearer secret-token-value");
			return jsonResponse({ version: 1, events: ids.map((id) => feedEvent(id)), nextCursor: null });
		});
		const first = await syncProvider(db, e, PROVIDERS.unstop, { trigger: "admin", fetcher: fetcher as unknown as typeof fetch });
		expect(first).toMatchObject({ status: "success", added: 2, updated: 0, skipped: 0 });
		let status = (await getSourceStatuses(db, e)).find((s) => s.platform === "unstop")!;
		expect(status.status).toBe("connected");
		expect(status.lastRun).toMatchObject({ added: 2, status: "success" });

		// Imported events are public, verified, attributed to Unstop, with unknown topics kept as technologies.
		const list = await api(`/api/hackathons?platforms=unstop&q=${encodeURIComponent(ids[0])}`);
		expect(list.body.data).toHaveLength(1);
		const imported = list.body.data[0];
		expect(imported).toMatchObject({ platform: "unstop", dataQuality: "verified", visibility: "public", isDemo: false });
		expect(imported.topics).toEqual(["ai"]);
		expect(imported.technologies).toEqual(["quantum-stuff"]);

		// A user saves the first event, then the source moves its deadline.
		const u = await signUp();
		await api("/api/me/bookmarks", { method: "POST", cookie: u.cookie, json: { hackathonId: imported.id } });
		const newDeadline = new Date(Date.now() + 20 * DAY).toISOString();
		const fetcher2 = vi.fn(async (url: string) => {
			expect(new URL(url).searchParams.get("updated_since")).toBeTruthy(); // incremental
			return jsonResponse({
				version: 1,
				events: [feedEvent(ids[0], { registrationDeadlineAt: newDeadline, updatedAt: new Date(Date.now() + 1000).toISOString() }), feedEvent(ids[1], { updatedAt: "2000-01-01T00:00:00Z" })],
			});
		});
		const second = await syncProvider(db, e, PROVIDERS.unstop, { trigger: "admin", fetcher: fetcher2 as unknown as typeof fetch });
		expect(second).toMatchObject({ status: "success", added: 0, updated: 1, unchanged: 1 });
		const detail = await api(`/api/hackathons/${imported.id}`);
		expect(detail.body.data.registrationDeadlineAt).toBe(newDeadline);
		const inbox = await api("/api/me/notifications", { cookie: u.cookie });
		expect(inbox.body.data.some((n: any) => n.type === "deadline_changed")).toBe(true);

		// Provider outage: status degrades, nothing is deleted.
		const down = vi.fn(async () => new Response("unavailable", { status: 503 }));
		const third = await syncProvider(db, e, PROVIDERS.unstop, { trigger: "cron", fetcher: down as unknown as typeof fetch });
		expect(third.status).toBe("unavailable");
		expect(down).toHaveBeenCalledTimes(3); // initial + 2 bounded retries
		status = (await getSourceStatuses(db, e)).find((s) => s.platform === "unstop")!;
		expect(status.status).toBe("temporarily_unavailable");
		expect((await api(`/api/hackathons/${imported.id}`)).status).toBe(200);

		// Bad credentials (4xx) → Sync Failed, error recorded without the token.
		const denied = vi.fn(async () => new Response("no", { status: 401 }));
		const fourth = await syncProvider(db, e, PROVIDERS.unstop, { trigger: "cron", fetcher: denied as unknown as typeof fetch });
		expect(fourth.status).toBe("failed");
		status = (await getSourceStatuses(db, e)).find((s) => s.platform === "unstop")!;
		expect(status.status).toBe("sync_failed");
		expect(status.lastError).toMatch(/HTTP 401/);
		expect(status.lastError).not.toMatch(/secret-token-value/);
	});

	it("skips invalid records, logs them, and reports a partial sync", async () => {
		const db = createDb(baseEnv.DB);
		const e = feedEnv("MACHINEHACK");
		const good = `m-${crypto.randomUUID()}`;
		const fetcher = async () =>
			jsonResponse({ version: 1, events: [feedEvent(good), { id: "bad-1", title: "x", url: "ftp://nope" }, { nonsense: true }] });
		const summary = await syncProvider(db, e, PROVIDERS.machinehack, { trigger: "admin", fetcher: fetcher as unknown as typeof fetch });
		expect(summary).toMatchObject({ status: "partial", added: 1, skipped: 2 });
		const errors = await baseEnv.DB.prepare("SELECT * FROM sync_record_errors WHERE sync_run_id = ?").bind(summary.runId).all<any>();
		expect(errors.results).toHaveLength(2);
		expect(errors.results.map((r) => r.external_event_id)).toContain("bad-1");
	});

	it("rejects malformed feed payloads and unsafe feed URLs", async () => {
		const db = createDb(baseEnv.DB);
		const e = feedEnv("DEVPOST");
		const res = await syncProvider(db, e, PROVIDERS.devpost, { trigger: "admin", fetcher: (async () => jsonResponse({ hello: "world" })) as unknown as typeof fetch });
		expect(res.status).toBe("failed");
		expect(res.error).toMatch(/Feed v1/);
		const unsafe = { ...e, DEVPOST_FEED_URL: "http://localhost/feed" } as AppBindings;
		const cfg = PROVIDERS.devpost.getConfig(unsafe);
		expect(cfg.valid).toBe(false);
	});

	it("cron sync only contacts providers with a valid feed AND auto-sync enabled", async () => {
		const db = createDb(baseEnv.DB);
		const e = feedEnv("MLH");
		const fetcher = vi.fn(async () => jsonResponse({ version: 1, events: [] }));
		await baseEnv.DB.prepare("UPDATE platforms SET auto_sync_enabled = 0").run();
		expect(await runScheduledSync(db, e, Date.now(), fetcher as unknown as typeof fetch)).toEqual([]);
		expect(fetcher).not.toHaveBeenCalled();
		await baseEnv.DB.prepare("UPDATE platforms SET auto_sync_enabled = 1 WHERE id = 'mlh'").run();
		const results = await runScheduledSync(db, e, Date.now(), fetcher as unknown as typeof fetch);
		expect(results.map((r) => r.platformId)).toEqual(["mlh"]);
		expect(fetcher).toHaveBeenCalledTimes(1);
	});
});
