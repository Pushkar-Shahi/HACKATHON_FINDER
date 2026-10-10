// Devpost — https://devpost.com/
//
// Policy check (2026-10-10): Devpost's Terms of Service (info.devpost.com/terms,
// section 4) prohibit using manual or automated software, scripts or robots to
// access, scrape, crawl or spider the site or its data. No public events API is
// documented. HackRadar therefore NEVER fetches devpost.com pages or its
// undocumented JSON endpoints. Devpost events enter HackRadar through manual
// entry or CSV import, or through a feed Devpost (or an organizer) has
// explicitly authorized — configured via DEVPOST_FEED_URL +
// DEVPOST_FEED_AUTHORIZATION_REF.
import { createFeedAdapter } from "./feed-adapter";

export const devpostAdapter = createFeedAdapter({
	platformId: "devpost",
	displayName: "Devpost",
	homepageUrl: "https://devpost.com/",
	envPrefix: "DEVPOST",
	policySummary:
		"Devpost's Terms of Service prohibit scraping, crawling and other automated access, and no public events API is documented. HackRadar does not collect Devpost data automatically.",
	manualWorkflow:
		"Open the hackathon on Devpost, then use Add hackathon (choose platform \"Devpost\" and paste the official event URL) or import a CSV. Registration always happens on Devpost.",
});
