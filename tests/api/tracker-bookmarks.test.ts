import { describe, expect, it } from "vitest";
import { api, eventInput, signIn, signUp } from "../helpers";

async function ownEvent(cookie: string, overrides = {}) {
	const res = await api("/api/me/events", { method: "POST", cookie, json: eventInput(overrides) });
	return res.body.data;
}

describe("tracker", () => {
	it("enforces one record per user per event and persists across sessions", async () => {
		const a = await signUp();
		const ev = await ownEvent(a.cookie);
		const created = await api("/api/me/tracking", { method: "POST", cookie: a.cookie, json: { hackathonId: ev.id, status: "shortlisted" } });
		expect(created.status).toBe(201);
		const dup = await api("/api/me/tracking", { method: "POST", cookie: a.cookie, json: { hackathonId: ev.id } });
		expect(dup.status).toBe(409);
		const upd = await api(`/api/me/tracking/${created.body.data.id}`, {
			method: "PATCH",
			cookie: a.cookie,
			json: { status: "registered", priority: "high", personalNotes: "Team of 3", teamName: "Byte Club" },
		});
		expect(upd.status).toBe(200);

		// Sign in again (new session) — data persists server-side.
		await api("/api/auth/sign-out", { method: "POST", cookie: a.cookie, json: {} });
		const again = await signIn(a.email, "correct-horse-battery");
		const list = await api("/api/me/tracking", { cookie: again.cookie });
		expect(list.body.data).toHaveLength(1);
		expect(list.body.data[0]).toMatchObject({ status: "registered", priority: "high", personalNotes: "Team of 3", teamName: "Byte Club" });
		const detail = await api(`/api/hackathons/${ev.id}`, { cookie: again.cookie });
		expect(detail.body.data.viewer.tracking.status).toBe("registered");
		expect(detail.body.data.viewerDetail.personalNotes).toBe("Team of 3");

		const filtered = await api("/api/me/tracking?status=planning", { cookie: again.cookie });
		expect(filtered.body.data).toHaveLength(0);
		const stats = await api("/api/dashboard/stats", { cookie: again.cookie });
		expect(stats.body.data.registered).toBe(1);
	});

	it("users cannot read or modify each other's tracker records", async () => {
		const a = await signUp();
		const b = await signUp();
		const ev = await ownEvent(a.cookie);
		const rec = (await api("/api/me/tracking", { method: "POST", cookie: a.cookie, json: { hackathonId: ev.id, personalNotes: "secret" } })).body.data;
		expect((await api(`/api/me/tracking/${rec.id}`, { method: "PATCH", cookie: b.cookie, json: { status: "won" } })).status).toBe(404);
		expect((await api(`/api/me/tracking/${rec.id}`, { method: "DELETE", cookie: b.cookie })).status).toBe(404);
		expect((await api("/api/me/tracking", { cookie: b.cookie })).body.data).toHaveLength(0);
		// B cannot track A's private event either (it is invisible to B).
		expect((await api("/api/me/tracking", { method: "POST", cookie: b.cookie, json: { hackathonId: ev.id } })).status).toBe(404);
	});

	it("rejects invalid statuses", async () => {
		const a = await signUp();
		const ev = await ownEvent(a.cookie);
		const res = await api("/api/me/tracking", { method: "POST", cookie: a.cookie, json: { hackathonId: ev.id, status: "champion" } });
		expect(res.status).toBe(400);
		expect(res.body.error.fields.status).toBeDefined();
	});
});

describe("bookmarks and collections", () => {
	it("bookmarks persist, toggle and show in saved filter", async () => {
		const a = await signUp();
		const ev = await ownEvent(a.cookie);
		const bm = await api("/api/me/bookmarks", { method: "POST", cookie: a.cookie, json: { hackathonId: ev.id, note: "apply early" } });
		expect(bm.status).toBe(201);
		const again = await api("/api/me/bookmarks", { method: "POST", cookie: a.cookie, json: { hackathonId: ev.id } });
		expect(again.status).toBe(200);
		expect(again.body.data.id).toBe(bm.body.data.id);
		const saved = await api("/api/hackathons?saved=true", { cookie: a.cookie });
		expect(saved.body.data.map((h: any) => h.id)).toEqual([ev.id]);
		expect(saved.body.data[0].viewer.bookmarked).toBe(true);
		const list = await api("/api/me/bookmarks", { cookie: a.cookie });
		expect(list.body.data[0].note).toBe("apply early");
		expect((await api(`/api/me/bookmarks/${bm.body.data.id}`, { method: "DELETE", cookie: a.cookie })).status).toBe(200);
		expect((await api("/api/me/bookmarks", { cookie: a.cookie })).body.data).toHaveLength(0);
		const activity = await api("/api/me/activity", { cookie: a.cookie });
		expect(activity.body.data.map((x: any) => x.action)).toEqual(expect.arrayContaining(["bookmark_added", "bookmark_removed", "event_created"]));
	});

	it("collections: unique names, membership, moving and ownership", async () => {
		const a = await signUp();
		const b = await signUp();
		const ev = await ownEvent(a.cookie);
		const ai = (await api("/api/me/collections", { method: "POST", cookie: a.cookie, json: { name: "AI and ML" } })).body.data;
		const hp = (await api("/api/me/collections", { method: "POST", cookie: a.cookie, json: { name: "High Priority" } })).body.data;
		expect((await api("/api/me/collections", { method: "POST", cookie: a.cookie, json: { name: "AI and ML" } })).status).toBe(409);

		// Adding to a collection saves the event.
		expect((await api(`/api/me/collections/${ai.id}/items`, { method: "POST", cookie: a.cookie, json: { hackathonId: ev.id } })).status).toBe(201);
		let bms = (await api("/api/me/bookmarks", { cookie: a.cookie })).body.data;
		expect(bms[0].collectionIds).toEqual([ai.id]);

		const moved = await api("/api/me/collections/move", { method: "POST", cookie: a.cookie, json: { hackathonId: ev.id, fromCollectionId: ai.id, toCollectionId: hp.id } });
		expect(moved.status).toBe(200);
		bms = (await api(`/api/me/bookmarks?collectionId=${hp.id}`, { cookie: a.cookie })).body.data;
		expect(bms.map((x: any) => x.hackathonId)).toEqual([ev.id]);
		expect((await api(`/api/me/bookmarks?collectionId=${ai.id}`, { cookie: a.cookie })).body.data).toHaveLength(0);

		const cols = (await api("/api/me/collections", { cookie: a.cookie })).body.data;
		expect(cols.find((c: any) => c.id === hp.id).itemCount).toBe(1);

		// Another user cannot see or use A's collections.
		expect((await api(`/api/me/bookmarks?collectionId=${hp.id}`, { cookie: b.cookie })).status).toBe(404);
		expect((await api(`/api/me/collections/${hp.id}`, { method: "DELETE", cookie: b.cookie })).status).toBe(404);
		expect((await api("/api/me/collections", { cookie: b.cookie })).body.data).toHaveLength(0);

		// Removing the bookmark removes collection membership.
		await api(`/api/me/bookmarks/${bms[0].id}`, { method: "DELETE", cookie: a.cookie });
		const after = (await api("/api/me/collections", { cookie: a.cookie })).body.data;
		expect(after.find((c: any) => c.id === hp.id).itemCount).toBe(0);
	});
});

describe("recommendations", () => {
	it("explains matches and asks for preferences when none are set", async () => {
		const a = await signUp();
		const empty = await api("/api/me/recommendations", { cookie: a.cookie });
		expect(empty.body.meta.needsPreferences).toBe(true);
		const ev = await ownEvent(a.cookie, { topics: ["genai"], participationMode: "online" });
		await api("/api/me/profile", { method: "PATCH", cookie: a.cookie, json: { interests: ["genai"], preferredMode: "online", isStudent: true } });
		const recs = await api("/api/me/recommendations", { cookie: a.cookie });
		const rec = recs.body.data.find((r: any) => r.hackathon.id === ev.id);
		expect(rec.reasons.join(" ")).toMatch(/Matches your interests: Generative AI/);
		expect(rec.reasons.join(" ")).toMatch(/online participation preference/);
		// Eligibility is not verified → it is a caution, not a claim.
		expect(rec.cautions.join(" ")).toMatch(/Student eligibility not stated/);
	});
});
