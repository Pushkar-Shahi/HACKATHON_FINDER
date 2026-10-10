import { describe, expect, it } from "vitest";
import { api, DAY, eventInput, HOUR, isoIn, signUp } from "../helpers";

const token = () => `tok${Math.random().toString(36).slice(2, 10)}`;

describe("manual event creation & validation", () => {
	it("creates a private event visible only to its creator", async () => {
		const a = await signUp("A");
		const b = await signUp("B");
		const res = await api("/api/me/events", { method: "POST", cookie: a.cookie, json: eventInput() });
		expect(res.status).toBe(201);
		const id = res.body.data.id;
		expect(res.body.data.visibility).toBe("private");
		expect(res.body.data.isOwner).toBe(true);
		expect(res.body.data.sources[0].platform).toBe("devpost");

		expect((await api(`/api/hackathons/${id}`, { cookie: a.cookie })).status).toBe(200);
		expect((await api(`/api/hackathons/${id}`, { cookie: b.cookie })).status).toBe(404);
		expect((await api(`/api/hackathons/${id}`)).status).toBe(404);
	});

	it("rejects invalid input with field errors and non-http URLs", async () => {
		const a = await signUp();
		const res = await api("/api/me/events", {
			method: "POST",
			cookie: a.cookie,
			json: eventInput({ title: "x", canonicalUrl: "javascript:alert(1)", prizeAmount: 100, prizeCurrency: null }),
		});
		expect(res.status).toBe(400);
		expect(res.body.error.code).toBe("validation_error");
		expect(Object.keys(res.body.error.fields)).toEqual(expect.arrayContaining(["title", "canonicalUrl"]));
	});

	it("rejects dates in the wrong order", async () => {
		const a = await signUp();
		const res = await api("/api/me/events", {
			method: "POST",
			cookie: a.cookie,
			json: eventInput({ eventStartAt: isoIn(10 * DAY), eventEndAt: isoIn(5 * DAY) }),
		});
		expect(res.status).toBe(400);
		expect(res.body.error.fields.eventEndAt).toBeDefined();
	});

	it("requires authentication to create events", async () => {
		const res = await api("/api/me/events", { method: "POST", json: eventInput() });
		expect(res.status).toBe(401);
	});

	it("unknown deadlines stay unknown (no fabricated status)", async () => {
		const a = await signUp();
		const res = await api("/api/me/events", {
			method: "POST",
			cookie: a.cookie,
			json: eventInput({ registrationDeadlineAt: null, eventStartAt: null, eventEndAt: null, eventTimezone: null }),
		});
		expect(res.body.data.registrationDeadlineAt).toBeNull();
		expect(res.body.data.registrationStatus).toBe("unknown");
		expect(res.body.data.eventStatus).toBe("needs_verification");
	});

	it("stores money in minor units and returns major amounts", async () => {
		const a = await signUp();
		const res = await api("/api/me/events", { method: "POST", cookie: a.cookie, json: eventInput({ prizeAmount: 1234.56, prizeCurrency: "usd" }) });
		expect(res.body.data.prizeAmount).toBe(1234.56);
		expect(res.body.data.prizeCurrency).toBe("USD");
	});
});

describe("discovery: search, filters, sorting", () => {
	async function seed() {
		const u = await signUp();
		const t = token();
		const make = (o: Record<string, unknown>) =>
			api("/api/me/events", { method: "POST", cookie: u.cookie, json: eventInput({ ...o, title: `${o.title} ${t}` }) }).then((r) => {
				if (r.status !== 201) throw new Error(JSON.stringify(r.body));
				return r.body.data;
			});
		const soonOnlineAi = await make({ title: "Alpha AI Jam", registrationDeadlineAt: isoIn(30 * HOUR), participationMode: "online", topics: ["ai", "ml"], isStudentEligible: true, prizeAmount: 500, prizeCurrency: "USD", teamSizeMin: 1, teamSizeMax: 4, participationFeeAmount: 0 });
		const laterInPerson = await make({ title: "Beta Web Fest", registrationDeadlineAt: isoIn(20 * DAY), eventStartAt: isoIn(25 * DAY), eventEndAt: isoIn(26 * DAY), participationMode: "in_person", topics: ["web"], prizeAmount: 9000, prizeCurrency: "INR", country: "India" });
		const hybridData = await make({ title: "Gamma Data Cup", registrationDeadlineAt: isoIn(6 * DAY), participationMode: "hybrid", topics: ["data_science"], isStudentEligible: null, prizeAmount: 2000, prizeCurrency: "USD", organizer: "Data Org" });
		const closed = await make({ title: "Delta Closed Hack", participationMode: "in_person", registrationDeadlineAt: isoIn(-2 * DAY), eventStartAt: isoIn(-1 * DAY), eventEndAt: isoIn(1 * DAY), topics: ["ai"] });
		const noDeadline = await make({ title: "Epsilon Mystery", registrationDeadlineAt: null, eventStartAt: null, eventEndAt: null, eventTimezone: null, topics: [] });
		return { u, t, soonOnlineAi, laterInPerson, hybridData, closed, noDeadline };
	}

	it("search is partial and case-insensitive across fields", async () => {
		const s = await seed();
		const byTitle = await api(`/api/hackathons?q=${encodeURIComponent(`ALPHA ${s.t.toUpperCase()}`)}`, { cookie: s.u.cookie });
		expect(byTitle.body.data.map((h: any) => h.id)).toEqual([s.soonOnlineAi.id]);
		const byOrganizer = await api(`/api/hackathons?q=${encodeURIComponent(`data org ${s.t}`)}`, { cookie: s.u.cookie });
		expect(byOrganizer.body.data.map((h: any) => h.id)).toEqual([s.hybridData.id]);
		const byTech = await api(`/api/hackathons?q=${encodeURIComponent(`pyth ${s.t}`)}`, { cookie: s.u.cookie });
		expect(byTech.body.meta.total).toBe(5);
		// LIKE wildcards in user input are escaped, not interpreted.
		const wildcard = await api(`/api/hackathons?q=${encodeURIComponent(`%_ ${s.t}`)}`, { cookie: s.u.cookie });
		expect(wildcard.body.meta.total).toBe(0);
	});

	it("combines filters with AND semantics", async () => {
		const s = await seed();
		const q = (qs: string) => api(`/api/hackathons?q=${s.t}&${qs}`, { cookie: s.u.cookie }).then((r) => r.body.data.map((h: any) => h.id).sort());
		expect(await q("modes=online&topics=ai")).toEqual([s.soonOnlineAi.id].sort());
		expect(await q("topics=ai")).toEqual([s.soonOnlineAi.id, s.closed.id].sort());
		expect(await q("registration=open")).toEqual([s.soonOnlineAi.id, s.laterInPerson.id, s.hybridData.id].sort());
		expect(await q("registration=closing_soon")).toEqual([s.soonOnlineAi.id, s.hybridData.id].sort());
		expect(await q("registration=closed")).toEqual([s.closed.id]);
		expect(await q("registration=unknown")).toEqual([s.noDeadline.id]);
		expect(await q("deadline=24h")).toEqual([]);
		expect(await q("deadline=3d")).toEqual([s.soonOnlineAi.id]);
		expect(await q("deadline=7d")).toEqual([s.soonOnlineAi.id, s.hybridData.id].sort());
		expect(await q("deadline=none")).toEqual([s.noDeadline.id]);
		expect(await q("status=ongoing")).toEqual([s.closed.id]);
		expect(await q("modes=online,hybrid&deadline=7d")).toEqual([s.soonOnlineAi.id, s.hybridData.id].sort());
		expect(await q("country=india")).toEqual([s.laterInPerson.id]);
	});

	it("eligibility filters never treat unknown as eligible", async () => {
		const s = await seed();
		const ids = (await api(`/api/hackathons?q=${s.t}&students=true`, { cookie: s.u.cookie })).body.data.map((h: any) => h.id);
		expect(ids).toEqual([s.soonOnlineAi.id]); // hybridData has null eligibility → excluded
		const free = (await api(`/api/hackathons?q=${s.t}&free=true`, { cookie: s.u.cookie })).body.data.map((h: any) => h.id);
		expect(free).toEqual([s.soonOnlineAi.id]);
		const team = (await api(`/api/hackathons?q=${s.t}&teamSize=3`, { cookie: s.u.cookie })).body.data.map((h: any) => h.id);
		expect(team).toEqual([s.soonOnlineAi.id]);
	});

	it("sorts by deadline with upcoming first and unknown last", async () => {
		const s = await seed();
		const ids = (await api(`/api/hackathons?q=${s.t}&sort=deadline`, { cookie: s.u.cookie })).body.data.map((h: any) => h.id);
		expect(ids).toEqual([s.soonOnlineAi.id, s.hybridData.id, s.laterInPerson.id, s.closed.id, s.noDeadline.id]);
	});

	it("prize sort compares only the chosen currency", async () => {
		const s = await seed();
		const usd = (await api(`/api/hackathons?q=${s.t}&sort=prize&prizeCurrency=USD`, { cookie: s.u.cookie })).body;
		expect(usd.data.slice(0, 2).map((h: any) => h.id)).toEqual([s.hybridData.id, s.soonOnlineAi.id]);
		expect(usd.meta.prizeSortCurrency).toBe("USD");
		// The INR 9000 prize is NOT ranked above USD 2000.
		expect(usd.data.findIndex((h: any) => h.id === s.laterInPerson.id)).toBeGreaterThan(1);
		const minPrize = (await api(`/api/hackathons?q=${s.t}&minPrize=1000&prizeCurrency=USD`, { cookie: s.u.cookie })).body.data.map((h: any) => h.id);
		expect(minPrize).toEqual([s.hybridData.id]);
		expect((await api(`/api/hackathons?q=${s.t}&minPrize=1000`, { cookie: s.u.cookie })).status).toBe(400);
	});

	it("paginates with metadata", async () => {
		const s = await seed();
		const p1 = await api(`/api/hackathons?q=${s.t}&pageSize=2&page=1`, { cookie: s.u.cookie });
		const p3 = await api(`/api/hackathons?q=${s.t}&pageSize=2&page=3`, { cookie: s.u.cookie });
		expect(p1.body.meta).toMatchObject({ page: 1, pageSize: 2, total: 5, totalPages: 3 });
		expect(p1.body.data).toHaveLength(2);
		expect(p3.body.data).toHaveLength(1);
	});

	it("rejects invalid query parameters", async () => {
		const res = await api(`/api/hackathons?modes=underwater&pageSize=500`);
		expect(res.status).toBe(400);
		expect(res.body.error.fields).toHaveProperty("modes.0");
		expect(res.body.error.fields).toHaveProperty("pageSize");
	});

	it("saved/tracked filters require sign-in", async () => {
		expect((await api(`/api/hackathons?saved=true`)).status).toBe(401);
	});
});

describe("owner edits and publication", () => {
	it("owner can edit and delete private events; others cannot", async () => {
		const a = await signUp();
		const b = await signUp();
		const created = (await api("/api/me/events", { method: "POST", cookie: a.cookie, json: eventInput() })).body.data;
		const upd = await api(`/api/me/events/${created.id}`, { method: "PUT", cookie: a.cookie, json: eventInput({ title: "Renamed event", canonicalUrl: created.canonicalUrl }) });
		expect(upd.status).toBe(200);
		expect(upd.body.data.title).toBe("Renamed event");
		expect((await api(`/api/me/events/${created.id}`, { method: "PUT", cookie: b.cookie, json: eventInput() })).status).toBe(404);
		expect((await api(`/api/me/events/${created.id}`, { method: "DELETE", cookie: b.cookie })).status).toBe(404);
		expect((await api(`/api/me/events/${created.id}`, { method: "DELETE", cookie: a.cookie })).status).toBe(200);
		expect((await api(`/api/hackathons/${created.id}`, { cookie: a.cookie })).status).toBe(404);
	});

	it("publication requests go to pending and can be withdrawn", async () => {
		const a = await signUp();
		const created = (await api("/api/me/events", { method: "POST", cookie: a.cookie, json: eventInput() })).body.data;
		const req = await api(`/api/me/events/${created.id}/publication`, { method: "POST", cookie: a.cookie, json: { note: "Real event" } });
		expect(req.body.data.publicationStatus).toBe("pending");
		expect((await api(`/api/me/events/${created.id}/publication`, { method: "POST", cookie: a.cookie, json: {} })).status).toBe(409);
		expect((await api(`/api/me/events/${created.id}/publication`, { method: "DELETE", cookie: a.cookie })).status).toBe(200);
	});

	it("duplicate check finds same-URL events", async () => {
		const a = await signUp();
		const created = (await api("/api/me/events", { method: "POST", cookie: a.cookie, json: eventInput() })).body.data;
		const res = await api("/api/hackathons/check-duplicates", {
			method: "POST",
			cookie: a.cookie,
			json: { title: "Different title", canonicalUrl: created.canonicalUrl.replace("https://", "https://www.") + "/?utm_source=x" },
		});
		expect(res.body.data[0]).toMatchObject({ hackathonId: created.id, confidence: "exact" });
	});
});
