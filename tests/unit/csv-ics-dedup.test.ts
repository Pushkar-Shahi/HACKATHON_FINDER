import { describe, expect, it } from "vitest";
import { mapCsvRow, parseCsv, resolveHeaders, sanitizeCell, serializeCsv } from "../../src/worker/services/csv";
import { buildIcs, escapeIcsText, foldLine, hackathonToIcsEvents } from "../../src/worker/services/calendar-export";
import { canonicalUrlKey, normalizeTechnology, normalizeTitle } from "../../src/worker/services/event-normalizer";
import { scoreDuplicate } from "../../src/worker/services/deduplication";

describe("CSV parsing", () => {
	it("handles quotes, escaped quotes, CRLF, BOM and blank lines", () => {
		const rows = parseCsv('﻿a,b,c\r\n"x, y","he said ""hi""",\n\n"multi\nline",2,3\n');
		expect(rows).toEqual([
			["a", "b", "c"],
			["x, y", 'he said "hi"', ""],
			["multi\nline", "2", "3"],
		]);
	});
	it("rejects malformed quoting", () => {
		expect(() => parseCsv('a,b\n"open,1')).toThrow(/Unterminated/);
		expect(() => parseCsv('a,b\nab"c,1')).toThrow(/Unexpected quote/);
	});
	it("neutralizes formula injection on export", () => {
		expect(sanitizeCell("=SUM(A1)")).toBe("'=SUM(A1)");
		expect(sanitizeCell("+1")).toBe("'+1");
		expect(sanitizeCell("@cmd")).toBe("'@cmd");
		expect(sanitizeCell("Normal")).toBe("Normal");
		expect(serializeCsv([["a,b", 'q"t', 5, null]])).toBe('"a,b","q""t",5,\r\n');
	});
	it("maps aliased headers and validates rows", () => {
		const { mapping, missing, unknown } = resolveHeaders(["Title", "URL", "Deadline", "TZ", "Topics", "Mystery"]);
		expect(missing).toEqual([]);
		expect(unknown).toEqual(["Mystery"]);
		const ok = mapCsvRow(["My Event", "https://example.com/e", "2030-01-02 10:00", "Europe/London", "ai; Web development"], mapping);
		expect(ok.errors).toEqual([]);
		expect(ok.input!.registrationDeadlineAt).toBe("2030-01-02T10:00:00.000Z");
		expect(ok.input!.topics).toEqual(["ai", "web"]);
		const bad = mapCsvRow(["My Event", "https://example.com/e", "2030-01-02 10:00", "", "astrology"], mapping);
		expect(bad.input).toBeNull();
		expect(bad.errors.join(" ")).toMatch(/timezone column is required/);
		expect(bad.errors.join(" ")).toMatch(/unknown topic/);
	});
});

describe("ICS generation", () => {
	it("escapes text and folds long lines to 75 octets", () => {
		expect(escapeIcsText("a,b;c\\d\ne")).toBe(String.raw`a\,b\;c\\d\ne`);
		const long = "SUMMARY:" + "é".repeat(100);
		const folded = foldLine(long).split("\r\n");
		for (const line of folded) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
		expect(folded.slice(1).every((l) => l.startsWith(" "))).toBe(true);
	});
	it("emits UTC instants and skips unknown dates", () => {
		const events = hackathonToIcsEvents({
			id: "h1",
			title: "Test",
			canonicalUrl: "https://example.com",
			registrationOpenAt: null,
			registrationDeadlineAt: new Date("2026-11-20T18:29:00Z"),
			eventStartAt: null,
			eventEndAt: null,
			isDemo: true,
		});
		expect(events).toHaveLength(1);
		const ics = buildIcs(events, "Cal", new Date("2026-10-10T00:00:00Z"));
		expect(ics).toContain("DTSTART:20261120T182900Z");
		expect(ics).toContain("DEMO");
		expect(ics).toContain("TRIGGER:-PT1440M");
		expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0")).toBe(true);
		expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
	});
});

describe("normalization & duplicate detection", () => {
	it("canonicalizes URLs", () => {
		expect(canonicalUrlKey("http://WWW.Example.com/Event/?utm_source=x&b=2&a=1#top")).toBe("https://example.com/Event?a=1&b=2");
		expect(canonicalUrlKey("https://example.com/event/")).toBe(canonicalUrlKey("https://example.com/event"));
	});
	it("normalizes titles and technologies", () => {
		expect(normalizeTitle("  HackMIT — Fall 2026!  ")).toBe("hackmit fall 2026");
		expect(normalizeTitle("Café & Code")).toBe("cafe and code");
		expect(normalizeTechnology("C++").slug).toBe("cplusplus");
	});
	it("only treats URL matches as exact; title-only is low confidence", () => {
		const base = { canonicalUrlKey: "https://a.example/e", normalizedTitle: "big hack", organizer: "Org", eventStartAt: 1_000_000, registrationDeadlineAt: null };
		expect(scoreDuplicate(base, { ...base, normalizedTitle: "other" })!.confidence).toBe("exact");
		expect(scoreDuplicate(base, { ...base, canonicalUrlKey: "https://b.example/e", organizer: null, eventStartAt: null })!.confidence).toBe("low");
		expect(scoreDuplicate(base, { ...base, canonicalUrlKey: "https://b.example/e", eventStartAt: 1_000_000 + 3_600_000 })!.confidence).toBe("high");
		expect(scoreDuplicate(base, { ...base, canonicalUrlKey: "https://b.example/e", normalizedTitle: "different" })).toBeNull();
	});
});
