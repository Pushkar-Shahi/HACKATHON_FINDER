// MachineHack — https://machinehack.com/
//
// Policy check (2026-10-10): MachineHack's terms (machinehack.com/terms) state
// that contest data is "for contest use only and may not be redistributed".
// Its only documented public API (/api/public/leaderboard) returns leaderboard
// scores, not hackathon listings. No events API is offered, so HackRadar runs
// MachineHack in Manual Mode unless an authorized feed is configured via
// MACHINEHACK_FEED_URL + MACHINEHACK_FEED_AUTHORIZATION_REF.
import { createFeedAdapter } from "./feed-adapter";

export const machinehackAdapter = createFeedAdapter({
	platformId: "machinehack",
	displayName: "MachineHack",
	homepageUrl: "https://machinehack.com/",
	envPrefix: "MACHINEHACK",
	policySummary:
		"MachineHack documents a public leaderboard API only — no hackathon listing API — and its terms restrict redistribution of contest data. HackRadar does not collect MachineHack data automatically.",
	manualWorkflow:
		"Find the hackathon on MachineHack, then use Add hackathon (platform \"MachineHack\") with its official URL, or import several at once with CSV.",
});
