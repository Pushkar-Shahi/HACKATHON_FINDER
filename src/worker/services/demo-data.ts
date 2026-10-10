// Clearly-labelled FICTIONAL sample events for demonstrating the interface.
// Every record has is_demo = 1, a "[Demo]" title prefix, an example.com URL,
// platform "other" (so no real platform is implied to host it) and a
// description saying it is not real. Admins can load or remove them from
// Admin → Demo data. Dates are relative to "now" so the demo stays useful.
import { eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { hackathons } from "../db/schema";
import { hackathonInputSchema, type HackathonInputRaw } from "@shared/schemas";
import { DAY_MS, HOUR_MS } from "@shared/constants";
import { createHackathonStatements } from "./hackathon-writer";
import { runBatch } from "../db/queries/hackathons";
import type { BatchItem } from "drizzle-orm/batch";

const NOTE = "This is fictional sample data used to demonstrate HackRadar. It is not a real event — do not try to register.";

function demoEvents(now: number): HackathonInputRaw[] {
	const at = (offsetMs: number) => new Date(Math.floor((now + offsetMs) / HOUR_MS) * HOUR_MS).toISOString();
	const base = { platform: "other" as const, organizer: "HackRadar Demo Data", sourceStatus: null };
	return [
		{
			...base,
			title: "[Demo] Agentic AI Build Sprint",
			canonicalUrl: "https://example.com/hackradar-demo/agentic-ai-sprint",
			description: `${NOTE}\n\nA sample online sprint about building tool-using AI agents.`,
			registrationOpenAt: at(-10 * DAY_MS),
			registrationDeadlineAt: at(30 * HOUR_MS),
			eventStartAt: at(3 * DAY_MS),
			eventEndAt: at(5 * DAY_MS),
			eventTimezone: "UTC",
			participationMode: "online",
			topics: ["agentic_ai", "genai", "ai"],
			technologies: ["Python", "LangGraph"],
			prizeAmount: 5000,
			prizeCurrency: "USD",
			teamSizeMin: 1,
			teamSizeMax: 4,
			participationFeeAmount: 0,
			eligibilitySummary: "Sample eligibility text: open to students and professionals.",
			isStudentEligible: true,
			isBeginnerFriendly: true,
			isInternational: true,
		},
		{
			...base,
			title: "[Demo] Climate Data Challenge",
			canonicalUrl: "https://example.com/hackradar-demo/climate-data",
			description: `${NOTE}\n\nA sample data-science challenge using open climate datasets.`,
			registrationOpenAt: at(-5 * DAY_MS),
			registrationDeadlineAt: at(6 * DAY_MS),
			eventStartAt: at(10 * DAY_MS),
			eventEndAt: at(12 * DAY_MS),
			eventTimezone: "Europe/Berlin",
			participationMode: "hybrid",
			location: "Berlin (sample)",
			country: "Germany",
			topics: ["data_science", "climate", "ml"],
			technologies: ["Pandas", "PyTorch"],
			prizeAmount: 3000,
			prizeCurrency: "EUR",
			teamSizeMin: 2,
			teamSizeMax: 5,
			eligibilitySummary: "Sample eligibility text: university students only.",
			isStudentEligible: true,
			isBeginnerFriendly: null,
			isInternational: false,
		},
		{
			...base,
			title: "[Demo] Campus Web Dev Weekend",
			canonicalUrl: "https://example.com/hackradar-demo/campus-web",
			description: `${NOTE}\n\nA sample in-person weekend hackathon for web developers.`,
			registrationOpenAt: at(2 * DAY_MS),
			registrationDeadlineAt: at(20 * DAY_MS),
			eventStartAt: at(25 * DAY_MS),
			eventEndAt: at(27 * DAY_MS),
			eventTimezone: "Asia/Kolkata",
			participationMode: "in_person",
			location: "Bengaluru (sample)",
			country: "India",
			topics: ["web", "open_innovation"],
			technologies: ["React", "TypeScript"],
			prizeAmount: 150000,
			prizeCurrency: "INR",
			teamSizeMin: 2,
			teamSizeMax: 4,
			participationFeeAmount: 0,
			isBeginnerFriendly: true,
		},
		{
			...base,
			title: "[Demo] FinTech Security Hack",
			canonicalUrl: "https://example.com/hackradar-demo/fintech-security",
			description: `${NOTE}\n\nA sample event combining fintech and cybersecurity — currently running.`,
			registrationDeadlineAt: at(-3 * DAY_MS),
			eventStartAt: at(-1 * DAY_MS),
			eventEndAt: at(2 * DAY_MS),
			eventTimezone: "America/New_York",
			participationMode: "online",
			topics: ["fintech", "cybersecurity"],
			prizeAmount: 10000,
			prizeCurrency: "USD",
			teamSizeMax: 3,
		},
		{
			...base,
			title: "[Demo] Robotics Open Build",
			canonicalUrl: "https://example.com/hackradar-demo/robotics-open",
			description: `${NOTE}\n\nA sample record with deliberately missing dates, showing how HackRadar handles unknowns.`,
			participationMode: "in_person",
			location: "Location not announced (sample)",
			topics: ["robotics"],
		},
		{
			...base,
			title: "[Demo] Healthcare GenAI Hackathon",
			canonicalUrl: "https://example.com/hackradar-demo/health-genai",
			description: `${NOTE}\n\nA sample online hackathon on generative AI for healthcare.`,
			registrationOpenAt: at(-20 * DAY_MS),
			registrationDeadlineAt: at(14 * DAY_MS),
			eventStartAt: at(16 * DAY_MS),
			eventEndAt: at(18 * DAY_MS),
			eventTimezone: "Asia/Singapore",
			participationMode: "online",
			topics: ["healthcare", "genai", "ai"],
			technologies: ["Transformers"],
			prizeAmount: 8000,
			prizeCurrency: "USD",
			teamSizeMin: 1,
			teamSizeMax: 5,
			participationFeeAmount: 0,
			isStudentEligible: true,
			isInternational: true,
		},
		{
			...base,
			title: "[Demo] Cloud & DevOps Marathon (past)",
			canonicalUrl: "https://example.com/hackradar-demo/cloud-devops",
			description: `${NOTE}\n\nA sample completed event.`,
			registrationDeadlineAt: at(-40 * DAY_MS),
			eventStartAt: at(-30 * DAY_MS),
			eventEndAt: at(-28 * DAY_MS),
			eventTimezone: "UTC",
			participationMode: "online",
			topics: ["cloud", "devops_mlops"],
		},
	];
}

export async function demoCount(db: Database): Promise<number> {
	const rows = await db.select({ id: hackathons.id }).from(hackathons).where(eq(hackathons.isDemo, true));
	return rows.length;
}

export async function loadDemoData(db: Database, now = Date.now()): Promise<number> {
	if ((await demoCount(db)) > 0) return 0;
	const stmts: BatchItem<"sqlite">[] = [];
	for (const raw of demoEvents(now)) {
		const input = hackathonInputSchema.parse(raw);
		stmts.push(...createHackathonStatements(db, input, { ownerId: null, visibility: "public", isDemo: true, internalStatus: "unverified" }).stmts);
	}
	await runBatch(db, stmts);
	return demoEvents(now).length;
}

/** Removes all demo records (cascades to bookmarks/tracking that referenced them). */
export async function removeDemoData(db: Database): Promise<number> {
	const res = await db.delete(hackathons).where(eq(hackathons.isDemo, true)).returning({ id: hackathons.id });
	return res.length;
}
