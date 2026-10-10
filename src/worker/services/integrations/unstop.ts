// Unstop — https://unstop.com/
//
// Policy check (2026-10-10): Unstop does not document a public events API. Its
// robots.txt disallows automated access to /api/* (except /api/public/*, which
// is undocumented), and its Terms could not be retrieved without a browser
// session, so permission for automated collection cannot be established.
// robots.txt rules are not a grant of permission, so HackRadar runs Unstop in
// Manual Mode unless an authorized feed is configured via UNSTOP_FEED_URL +
// UNSTOP_FEED_AUTHORIZATION_REF.
import { createFeedAdapter } from "./feed-adapter";

export const unstopAdapter = createFeedAdapter({
	platformId: "unstop",
	displayName: "Unstop",
	homepageUrl: "https://unstop.com/",
	envPrefix: "UNSTOP",
	policySummary:
		"Unstop does not document a public events API, and permission for automated collection could not be verified. HackRadar does not collect Unstop data automatically.",
	manualWorkflow:
		"Open the hackathon on Unstop, then use Add hackathon (platform \"Unstop\") or import a CSV. Register on Unstop itself.",
});
