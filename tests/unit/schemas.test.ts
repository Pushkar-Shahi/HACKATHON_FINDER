import { describe, expect, it } from "vitest";
import { hackathonInputSchema, hackathonListQuerySchema, notificationPreferencesUpdateSchema } from "../../src/shared/schemas";

describe("shared validation", () => {
	const base = { title: "Valid Event", platform: "devpost", canonicalUrl: "https://example.com/e" };
	it("accepts minimal input and normalizes empties to null", () => {
		const r = hackathonInputSchema.parse({ ...base, organizer: "", registrationUrl: "" });
		expect(r.organizer).toBeNull();
		expect(r.registrationUrl).toBeNull();
		expect(r.topics).toEqual([]);
	});
	it("rejects dangerous or invalid values", () => {
		expect(hackathonInputSchema.safeParse({ ...base, canonicalUrl: "javascript:alert(1)" }).success).toBe(false);
		expect(hackathonInputSchema.safeParse({ ...base, canonicalUrl: "data:text/html,hi" }).success).toBe(false);
		expect(hackathonInputSchema.safeParse({ ...base, eventTimezone: "Mars/Olympus" }).success).toBe(false);
		expect(hackathonInputSchema.safeParse({ ...base, prizeAmount: 10 }).success).toBe(false); // currency required
		expect(hackathonInputSchema.safeParse({ ...base, prizeAmount: 10, prizeCurrency: "XYZ1" }).success).toBe(false);
		expect(hackathonInputSchema.safeParse({ ...base, registrationDeadlineAt: "2026-11-01 10:00" }).success).toBe(false); // needs offset
		expect(hackathonInputSchema.safeParse({ ...base, topics: ["not-a-topic"] }).success).toBe(false);
	});
	it("parses list queries with defaults and limits", () => {
		const q = hackathonListQuerySchema.parse({ platforms: "devpost,mlh", students: "true" });
		expect(q).toMatchObject({ platforms: ["devpost", "mlh"], students: true, sort: "deadline", page: 1, pageSize: 18 });
		expect(hackathonListQuerySchema.safeParse({ pageSize: "1000" }).success).toBe(false);
		expect(hackathonListQuerySchema.safeParse({ platforms: "myspace" }).success).toBe(false);
	});
	it("validates notification preference times", () => {
		const ok = { deliveryTime: "09:30", timezone: "Asia/Kolkata", reminders: [], deadlineChanged: { in_app: true, email: false } };
		expect(notificationPreferencesUpdateSchema.safeParse(ok).success).toBe(true);
		expect(notificationPreferencesUpdateSchema.safeParse({ ...ok, deliveryTime: "25:00" }).success).toBe(false);
	});
});

