import { describe, expect, it } from "vitest";
import { env, SELF } from "cloudflare:test";
import { api, eventInput, signIn, signUp, ORIGIN } from "../helpers";

const DB = (env as unknown as { DB: D1Database }).DB;
const makeAdmin = (id: string) => DB.prepare("UPDATE user SET role = 'admin' WHERE id = ?").bind(id).run();

describe("authentication", () => {
	it("rejects wrong passwords and expired/absent sessions", async () => {
		const u = await signUp();
		const bad = await signIn(u.email, "wrong-password-123");
		expect(bad.status).toBe(401);
		const good = await signIn(u.email, "correct-horse-battery");
		expect(good.status).toBe(200);
		// Sign out invalidates the session server-side.
		await api("/api/auth/sign-out", { method: "POST", cookie: good.cookie, json: {} });
		expect((await api("/api/me/tracking", { cookie: good.cookie })).status).toBe(401);
		expect((await api("/api/me", { cookie: good.cookie })).body.data).toBeNull();
		// A forged cookie is not a session.
		expect((await api("/api/me/tracking", { cookie: "better-auth.session_token=forged.value" })).status).toBe(401);
	});

	it("enforces minimum password length", async () => {
		const res = await api("/api/auth/sign-up/email", { method: "POST", json: { email: `short${Date.now()}@example.com`, password: "short", name: "S" } });
		expect(res.status).toBe(400);
	});

	it("stores PBKDF2 hashes, never plaintext", async () => {
		const u = await signUp();
		const row = await DB.prepare("SELECT password FROM account WHERE user_id = ?").bind(u.id).first<{ password: string }>();
		expect(row!.password).toMatch(/^pbkdf2_sha256\$100000\$/);
		expect(row!.password).not.toContain("correct-horse-battery");
	});
});

describe("request protections", () => {
	it("refuses cross-origin state-changing requests", async () => {
		const u = await signUp();
		const res = await SELF.fetch(`${ORIGIN}/api/me/collections`, {
			method: "POST",
			headers: { Origin: "https://evil.example", Cookie: u.cookie, "Content-Type": "application/json" },
			body: JSON.stringify({ name: "Hacked" }),
		});
		expect(res.status).toBe(403);
	});

	it("returns JSON errors without stack traces and sets security headers", async () => {
		const res = await api("/api/does-not-exist");
		expect(res.status).toBe(404);
		expect(res.body.error.code).toBe("not_found");
		const malformed = await SELF.fetch(`${ORIGIN}/api/me/collections`, {
			method: "POST",
			headers: { Origin: ORIGIN, Cookie: (await signUp()).cookie, "Content-Type": "application/json" },
			body: "{not json",
		});
		expect(malformed.status).toBe(400);
		const health = await api("/api/health");
		expect(health.headers.get("x-content-type-options")).toBe("nosniff");
		expect(health.headers.get("cache-control")).toBe("no-store");
	});

	it("limits request size", async () => {
		const u = await signUp();
		const res = await api("/api/me/events", { method: "POST", cookie: u.cookie, json: eventInput({ description: "x".repeat(70_000) }) });
		expect(res.status).toBe(413);
	});
});

describe("privilege escalation", () => {
	it("role cannot be set via sign-up, profile, or update-user", async () => {
		const email = `esc${Date.now()}@example.com`;
		const su = await api("/api/auth/sign-up/email", { method: "POST", json: { email, password: "correct-horse-battery", name: "E", role: "admin" } });
		const id = su.body?.user?.id;
		if (id) {
			const row = await DB.prepare("SELECT role FROM user WHERE id = ?").bind(id).first<{ role: string }>();
			expect(row!.role).toBe("user");
		} else {
			expect(su.status).toBeGreaterThanOrEqual(400);
		}
		const u = await signUp();
		await api("/api/me/profile", { method: "PATCH", cookie: u.cookie, json: { role: "admin", displayName: "Me" } });
		await api("/api/auth/update-user", { method: "POST", cookie: u.cookie, json: { role: "admin", name: "Me" } });
		const row = await DB.prepare("SELECT role FROM user WHERE id = ?").bind(u.id).first<{ role: string }>();
		expect(row!.role).toBe("user");
		expect((await api("/api/admin/overview", { cookie: u.cookie })).status).toBe(403);
	});

	it("ordinary users cannot alter shared events or trigger syncs", async () => {
		const admin = await signUp();
		await makeAdmin(admin.id);
		await api("/api/admin/demo", { method: "POST", cookie: admin.cookie });
		const u = await signUp();
		const shared = (await api("/api/hackathons?includeDemo=true&pageSize=1")).body.data[0];
		expect(shared.isDemo).toBe(true);
		expect((await api(`/api/me/events/${shared.id}`, { method: "PUT", cookie: u.cookie, json: eventInput() })).status).toBe(404);
		expect((await api(`/api/admin/hackathons/${shared.id}`, { method: "DELETE", cookie: u.cookie })).status).toBe(403);
		expect((await api("/api/admin/sources/devpost/sync", { method: "POST" })).status).toBe(401);
		expect((await api("/api/admin/sources/devpost/sync", { method: "POST", cookie: u.cookie })).status).toBe(403);
	});
});

describe("admin tools", () => {
	it("admin can manage demo data, review submissions and see honest source status", async () => {
		const admin = await signUp();
		await makeAdmin(admin.id);
		expect((await api("/api/me", { cookie: admin.cookie })).body.data.role).toBe("admin");

		await api("/api/admin/demo", { method: "DELETE", cookie: admin.cookie });
		const load = await api("/api/admin/demo", { method: "POST", cookie: admin.cookie });
		expect(load.body.data.created).toBeGreaterThan(0);
		const list = await api("/api/hackathons?includeDemo=true&q=%5Bdemo%5D&pageSize=50");
		expect(list.body.data.length).toBe(load.body.data.created);
		for (const h of list.body.data) {
			expect(h.isDemo).toBe(true);
			expect(h.title.startsWith("[Demo]")).toBe(true);
			expect(h.canonicalUrl).toMatch(/^https:\/\/example\.com\/hackradar-demo\//);
			expect(h.platform).toBe("other");
		}
		const stats = await api("/api/dashboard/stats");
		expect(stats.body.data.demoEventCount).toBe(load.body.data.created);
		// Hiding demo data removes it from counts.
		const u = await signUp();
		await api("/api/me/profile", { method: "PATCH", cookie: u.cookie, json: { showDemoEvents: false } });
		expect((await api("/api/dashboard/stats", { cookie: u.cookie })).body.data.demoEventCount).toBe(0);

		// Manual sync of a manual-mode provider records a skipped run (no fabricated success).
		const sync = await api("/api/admin/sources/devpost/sync", { method: "POST", cookie: admin.cookie });
		expect(sync.body.data.status).toBe("skipped");
		const logs = await api("/api/admin/sync-logs?platform=devpost", { cookie: admin.cookie });
		expect(logs.body.data[0]).toMatchObject({ status: "skipped", added: 0 });
		const sources = await api("/api/admin/sources", { cookie: admin.cookie });
		expect(sources.body.data.find((s: any) => s.platform === "devpost")).toMatchObject({ status: "manual_mode", config: { hasToken: false } });

		// Publication workflow: private → pending → approved (public), then owner can no longer edit.
		const owner = await signUp();
		const ev = (await api("/api/me/events", { method: "POST", cookie: owner.cookie, json: eventInput() })).body.data;
		await api(`/api/me/events/${ev.id}/publication`, { method: "POST", cookie: owner.cookie, json: {} });
		const subs = await api("/api/admin/submissions", { cookie: admin.cookie });
		expect(subs.body.data.map((s: any) => s.id)).toContain(ev.id);
		await api(`/api/admin/submissions/${ev.id}`, { method: "POST", cookie: admin.cookie, json: { approve: true } });
		expect((await api(`/api/hackathons/${ev.id}`)).status).toBe(200);
		expect((await api(`/api/me/events/${ev.id}`, { method: "PUT", cookie: owner.cookie, json: eventInput() })).status).toBe(403);

		// Admin cannot read private events that were not submitted.
		const secret = (await api("/api/me/events", { method: "POST", cookie: owner.cookie, json: eventInput() })).body.data;
		expect((await api(`/api/admin/hackathons/${secret.id}`, { cookie: admin.cookie })).status).toBe(404);

		// Verify a shared record.
		const verify = await api(`/api/admin/hackathons/${ev.id}/verify`, { method: "POST", cookie: admin.cookie });
		expect(verify.body.data.verified).toBe(true);
		expect((await api(`/api/hackathons/${ev.id}`)).body.data.dataQuality).toBe("verified");

		const removed = await api("/api/admin/demo", { method: "DELETE", cookie: admin.cookie });
		expect(removed.body.data.removed).toBe(load.body.data.created);
	});

	it("merges duplicates without losing user data", async () => {
		const admin = await signUp();
		await makeAdmin(admin.id);
		const owner = await signUp();
		const mk = async (url: string) => {
			const ev = (await api("/api/me/events", { method: "POST", cookie: owner.cookie, json: eventInput({ title: "Merge Me Hackathon 2031", canonicalUrl: url, organizer: "Org" }) })).body.data;
			await api(`/api/me/events/${ev.id}/publication`, { method: "POST", cookie: owner.cookie, json: {} });
			await api(`/api/admin/submissions/${ev.id}`, { method: "POST", cookie: admin.cookie, json: { approve: true } });
			return ev;
		};
		const a = await mk(`https://example.com/merge-a-${Date.now()}`);
		const b = await mk(`https://example.com/merge-b-${Date.now()}`);
		await DB.prepare("INSERT INTO duplicate_candidates (id, hackathon_id, candidate_id, confidence, reasons, status, created_at) VALUES (?, ?, ?, 'high', '[]', 'open', ?)")
			.bind(crypto.randomUUID(), b.id, a.id, Date.now())
			.run();
		const fan = await signUp();
		await api("/api/me/tracking", { method: "POST", cookie: fan.cookie, json: { hackathonId: b.id, personalNotes: "notes on B" } });
		await api("/api/me/bookmarks", { method: "POST", cookie: fan.cookie, json: { hackathonId: a.id } });
		await api("/api/me/bookmarks", { method: "POST", cookie: fan.cookie, json: { hackathonId: b.id } });

		const dups = await api("/api/admin/duplicates", { cookie: admin.cookie });
		const cand = dups.body.data.find((d: any) => d.a.id === b.id);
		const merged = await api(`/api/admin/duplicates/${cand.id}`, { method: "POST", cookie: admin.cookie, json: { action: "merge", keepId: a.id } });
		expect(merged.body.data.status).toBe("merged");
		expect((await api(`/api/hackathons/${b.id}`)).status).toBe(404);
		const tracking = (await api("/api/me/tracking", { cookie: fan.cookie })).body.data;
		expect(tracking).toHaveLength(1);
		expect(tracking[0].hackathonId).toBe(a.id);
		expect(tracking[0].personalNotes).toBe("notes on B");
		expect((await api("/api/me/bookmarks", { cookie: fan.cookie })).body.data).toHaveLength(1);
		const detail = (await api(`/api/hackathons/${a.id}`)).body.data;
		expect(detail.sources.length).toBe(2);
	});
});

describe("data deletion", () => {
	it("deletes private tracking data on request and the whole account via Better Auth", async () => {
		const u = await signUp();
		const ev = (await api("/api/me/events", { method: "POST", cookie: u.cookie, json: eventInput() })).body.data;
		await api("/api/me/bookmarks", { method: "POST", cookie: u.cookie, json: { hackathonId: ev.id } });
		expect((await api("/api/me/data", { method: "DELETE", cookie: u.cookie, json: { confirm: "nope" } })).status).toBe(400);
		expect((await api("/api/me/data", { method: "DELETE", cookie: u.cookie, json: { confirm: "DELETE" } })).status).toBe(200);
		expect((await api("/api/me/bookmarks", { cookie: u.cookie })).body.data).toHaveLength(0);
		expect((await api(`/api/hackathons/${ev.id}`, { cookie: u.cookie })).status).toBe(404);

		const del = await api("/api/auth/delete-user", { method: "POST", cookie: u.cookie, json: { password: "correct-horse-battery" } });
		expect(del.status).toBe(200);
		const row = await DB.prepare("SELECT id FROM user WHERE id = ?").bind(u.id).first();
		expect(row).toBeNull();
	});
});
