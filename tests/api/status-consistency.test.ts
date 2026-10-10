// The SQL CASE expressions used for filtering must agree with the TypeScript
// derivation used everywhere else.
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { eq, inArray } from "drizzle-orm";
import { createDb } from "../../src/worker/db/client";
import { hackathons } from "../../src/worker/db/schema";
import { eventStatusSql, registrationStatusSql } from "../../src/worker/db/queries/status-sql";
import { createHackathon } from "../../src/worker/services/hackathon-writer";
import { deriveEventStatus, deriveRegistrationStatus } from "../../src/shared/status";
import { datedEvent } from "../../src/worker/db/queries/hackathons";
import { hackathonInputSchema } from "../../src/shared/schemas";

const DAY = 86_400_000;
const offsets = [null, -10 * DAY, -1 * DAY, 2 * DAY, 6 * DAY, 8 * DAY];
const sourceStatuses = [null, "open", "closed", "cancelled"] as const;

describe("status SQL ⇔ TypeScript", () => {
	it("agree across a grid of date/status combinations", async () => {
		const db = createDb((env as unknown as { DB: D1Database }).DB);
		const now = Date.now();
		const ids: string[] = [];
		let i = 0;
		for (const open of [null, -5 * DAY, 3 * DAY]) {
			for (const deadline of offsets) {
				for (const start of [null, -2 * DAY, 4 * DAY]) {
					for (const end of [null, -1 * DAY, 9 * DAY]) {
						const source = sourceStatuses[i++ % sourceStatuses.length];
						const iso = (o: number | null) => (o === null ? null : new Date(now + o).toISOString());
						const parsed = hackathonInputSchema.safeParse({
							title: `Grid ${i}`,
							platform: "other",
							canonicalUrl: `https://example.com/grid/${crypto.randomUUID()}`,
							registrationOpenAt: open !== null && deadline !== null && open > deadline ? null : iso(open),
							registrationDeadlineAt: iso(deadline),
							eventStartAt: start !== null && end !== null && start > end ? null : iso(start),
							eventEndAt: iso(end),
							sourceStatus: source,
						});
						if (!parsed.success) continue;
						const id = await createHackathon(db, parsed.data, {
							ownerId: null,
							visibility: "public",
							lastVerifiedAt: i % 2 ? new Date(now - DAY) : new Date(now - 10 * DAY),
						});
						ids.push(id);
					}
				}
			}
		}
		const rows = await db
			.select({ row: hackathons, reg: registrationStatusSql(now), ev: eventStatusSql(now) })
			.from(hackathons)
			.where(inArray(hackathons.id, ids.slice(0, 90)));
		const rows2 = await db
			.select({ row: hackathons, reg: registrationStatusSql(now), ev: eventStatusSql(now) })
			.from(hackathons)
			.where(inArray(hackathons.id, ids.slice(90)));
		const all = [...rows, ...rows2];
		expect(all.length).toBe(ids.length);
		expect(all.length).toBeGreaterThan(100);
		for (const r of all) {
			expect(r.reg).toBe(deriveRegistrationStatus(datedEvent(r.row), now));
			expect(r.ev).toBe(deriveEventStatus(datedEvent(r.row), now));
		}
		await db.delete(hackathons).where(eq(hackathons.primaryPlatformId, "other"));
	});
});
