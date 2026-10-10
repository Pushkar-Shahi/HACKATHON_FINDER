import { describe, expect, it } from "vitest";
import { api, signUp } from "../helpers";

const header = "title,official_url,platform,registration_deadline,timezone,mode,topics,prize_amount,prize_currency,student_eligible";

describe("CSV import", () => {
	it("previews valid, invalid and duplicate rows, then imports only selected valid rows atomically", async () => {
		const u = await signUp();
		const existing = (
			await api("/api/me/events", {
				method: "POST",
				cookie: u.cookie,
				json: { title: "Existing Event", platform: "mlh", canonicalUrl: "https://example.com/existing", topics: [], technologies: [] },
			})
		).body.data;
		const csv = [
			header,
			`Good One,https://example.com/good-1,devpost,2030-11-01 23:59,Asia/Kolkata,online,AI;Machine learning,"10,000",inr,yes`,
			`"Quoted, Title",https://example.com/good-2,Unstop,2030-11-02T10:00:00Z,,hybrid,web,,,`,
			`No Timezone,https://example.com/bad-1,devpost,2030-11-01 23:59,,online,,,,`,
			`Bad URL,javascript:alert(1),devpost,,,,,,,`,
			`Dup,https://www.example.com/existing/?utm_source=x,mlh,,,,,,,`,
			`Date only,https://example.com/bad-2,other,2030-11-01,UTC,,,,,`,
		].join("\n");
		const preview = await api("/api/me/events/import/preview", { method: "POST", cookie: u.cookie, json: { csv } });
		expect(preview.status).toBe(200);
		const p = preview.body.data;
		expect(p).toMatchObject({ totalRows: 6, validCount: 2, invalidCount: 3, duplicateCount: 1 });
		expect(p.rows[2].errors.join(" ")).toMatch(/timezone column is required/);
		expect(p.rows[3].status).toBe("invalid");
		expect(p.rows[4].duplicateOf.id).toBe(existing.id);
		expect(p.rows[5].errors.join(" ")).toMatch(/include a time/);

		// Selecting an invalid row rejects the whole import and writes nothing.
		const bad = await api("/api/me/events/import", { method: "POST", cookie: u.cookie, json: { csv, rows: [1, 3] } });
		expect(bad.status).toBe(400);
		const before = await api("/api/hackathons?mine=true", { cookie: u.cookie });
		expect(before.body.meta.total).toBe(1);

		const ok = await api("/api/me/events/import", { method: "POST", cookie: u.cookie, json: { csv, rows: [1, 2] } });
		expect(ok.status).toBe(201);
		expect(ok.body.data.imported).toBe(2);
		const imported = await api(`/api/hackathons/${ok.body.data.createdIds[0]}`, { cookie: u.cookie });
		expect(imported.body.data).toMatchObject({
			title: "Good One",
			visibility: "private",
			prizeAmount: 10000,
			prizeCurrency: "INR",
			isStudentEligible: true,
			eventTimezone: "Asia/Kolkata",
			// 23:59 IST = 18:29 UTC
			registrationDeadlineAt: "2030-11-01T18:29:00.000Z",
		});
		expect(imported.body.data.topics.sort()).toEqual(["ai", "ml"]);
	});

	it("reports missing required columns and malformed CSV", async () => {
		const u = await signUp();
		const missing = await api("/api/me/events/import/preview", { method: "POST", cookie: u.cookie, json: { csv: "name,link\nA,https://a.example" } });
		expect(missing.body.data.missingRequiredHeaders).toEqual(["title", "official_url"]);
		const broken = await api("/api/me/events/import/preview", { method: "POST", cookie: u.cookie, json: { csv: 'title,official_url\n"unterminated,https://x.example' } });
		expect(broken.status).toBe(400);
	});

	it("exports CSV with formula-injection protection", async () => {
		const u = await signUp();
		await api("/api/me/events", {
			method: "POST",
			cookie: u.cookie,
			json: { title: "=HYPERLINK(\"http://evil\")", platform: "other", canonicalUrl: "https://example.com/csv-export", topics: ["ai"], technologies: [] },
		});
		const res = await api("/api/me/events/export.csv?scope=mine", { cookie: u.cookie });
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toMatch(/text\/csv/);
		expect(res.text).toContain(`"'=HYPERLINK(""http://evil"")"`);
		expect(res.text.split("\r\n")[0]).toMatch(/^title,official_url,/);
	});
});
