import { describe, expect, it } from "vitest";
import { api, DAY, eventInput, signUp } from "../helpers";

describe("calendar & ICS", () => {
	it("lists deadline/event entries and milestones in range, and exports ICS", async () => {
		const u = await signUp();
		const deadline = new Date(Date.now() + 3 * DAY);
		const ev = (await api("/api/me/events", { method: "POST", cookie: u.cookie, json: eventInput({ title: "Cal, Event; One", registrationDeadlineAt: deadline.toISOString() }) })).body.data;
		await api("/api/me/bookmarks", { method: "POST", cookie: u.cookie, json: { hackathonId: ev.id } });
		const ms = await api("/api/me/milestones", { method: "POST", cookie: u.cookie, json: { title: "Draft pitch", dueAt: new Date(Date.now() + 2 * DAY).toISOString(), hackathonId: ev.id } });
		expect(ms.status).toBe(201);
		const from = new Date(Date.now() - DAY).toISOString();
		const to = new Date(Date.now() + 20 * DAY).toISOString();
		const cal = await api(`/api/calendar?from=${from}&to=${to}&scope=mine`, { cookie: u.cookie });
		const kinds = cal.body.data.filter((e: any) => e.hackathonId === ev.id).map((e: any) => e.kind);
		expect(kinds).toEqual(["milestone", "registration_deadline", "event_start", "event_end"]);
		expect((await api(`/api/calendar?from=${to}&to=${from}`)).status).toBe(400);

		const ics = await api(`/api/hackathons/${ev.id}/calendar.ics`, { cookie: u.cookie });
		expect(ics.headers.get("content-type")).toMatch(/text\/calendar/);
		expect(ics.text).toContain("BEGIN:VCALENDAR");
		const stamp = deadline.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
		expect(ics.text).toContain(`DTSTART:${stamp}`);
		expect(ics.text).toContain(String.raw`SUMMARY:Registration deadline: Cal\, Event\; One`);
		expect(ics.text).toContain("\r\n");

		const sel = await api("/api/calendar/export.ics", {
			method: "POST",
			cookie: u.cookie,
			json: { entries: [{ hackathonId: ev.id, kinds: ["registration_deadline"] }], milestoneIds: [ms.body.data.id] },
		});
		expect(sel.status).toBe(200);
		expect(sel.text.match(/BEGIN:VEVENT/g)).toHaveLength(2);
		expect(sel.text).toContain("Milestone: Draft pitch");
	});

	it("does not export dates that are unknown", async () => {
		const u = await signUp();
		const ev = (await api("/api/me/events", { method: "POST", cookie: u.cookie, json: eventInput({ registrationDeadlineAt: null, eventStartAt: null, eventEndAt: null }) })).body.data;
		expect((await api(`/api/hackathons/${ev.id}/calendar.ics`, { cookie: u.cookie })).status).toBe(400);
	});
});
