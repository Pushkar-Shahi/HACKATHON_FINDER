import { describe, expect, it } from "vitest";
import { activeChips, readFilters, toApiQuery, writeFilters } from "@/components/filters/discover-params";

describe("discover URL state", () => {
	it("round-trips filters through the URL and builds the API query", () => {
		const f = readFilters(new URLSearchParams("q=ai&platforms=devpost,bogus&deadline=7d&students=true&sort=prize&page=2"));
		expect(f.platforms).toEqual(["devpost"]);
		expect(f.page).toBe(2);
		const again = readFilters(writeFilters(f));
		expect(again).toEqual(f);
		const api = toApiQuery(f, 18);
		expect(api).toMatchObject({ q: "ai", platforms: ["devpost"], deadline: "7d", students: true, sort: "prize", prizeCurrency: "USD", page: 2 });
		expect(activeChips(f).map((c) => c.key)).toEqual(["q", "platforms:devpost", "deadline", "students"]);
		const cleared = activeChips(f)[1].clear(f);
		expect(cleared.platforms).toEqual([]);
	});
});
