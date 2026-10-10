// Major League Hacking (MLH) — https://www.mlh.com/
//
// Policy check (2026-10-10): MLH's Terms of Use (mlh.com/terms) grant access
// "solely for your personal purposes and non-commercial use" and prohibit
// reproducing or distributing site content without written consent. MLH
// publishes an events calendar web page but no public events API (the MyMLH
// OAuth API covers user profiles for organizers, not event listings). HackRadar
// runs MLH in Manual Mode unless MLH grants written permission and an
// authorized feed is configured via MLH_FEED_URL + MLH_FEED_AUTHORIZATION_REF.
import { createFeedAdapter } from "./feed-adapter";

export const mlhAdapter = createFeedAdapter({
	platformId: "mlh",
	displayName: "MLH",
	homepageUrl: "https://www.mlh.com/",
	envPrefix: "MLH",
	policySummary:
		"MLH's Terms of Use limit site access to personal, non-commercial use and prohibit redistributing content without written consent. There is no public events API, so HackRadar does not collect MLH data automatically.",
	manualWorkflow:
		"Browse the MLH season events calendar, then add events you care about with Add hackathon (platform \"MLH\") or a CSV import.",
});
