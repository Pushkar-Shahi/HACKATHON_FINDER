import { hackathonInputSchema } from "@shared/schemas";
import type { ProviderAdapter, NormalizeResult } from "./types";
import { fetchWithRetry } from "./feed-adapter";

export const devpostAdapter: ProviderAdapter = {
  platformId: "devpost",
  displayName: "Devpost",
  homepageUrl: "https://devpost.com/",
  policySummary: "Custom Devpost API Integration",
  manualWorkflow: "Configured for automatic sync",
  getConfig: () => ({
    mode: "authorized_feed",
    valid: true,
    problem: null,
    feedUrl: "direct",
    token: null,
    authorizationRef: "direct",
  }),
  fetchEvents: async (_config, opts) => {
    const records: unknown[] = [];
    let page = 1;
    while (page <= opts.maxPages) {
      const res = await fetchWithRetry(
        `https://devpost.com/api/hackathons?status[]=upcoming&status[]=open&per_page=100&page=${page}`,
        {},
        opts.fetcher,
      );
      const data = (await res.json()) as any;
      if (!data.hackathons || data.hackathons.length === 0) break;
      records.push(...data.hackathons);
      if (data.hackathons.length < 100) break;
      page++;
    }
    return { records, pagesFetched: page, truncated: false };
  },
  normalizeEvent: (raw: any): NormalizeResult => {
    try {
      const input = hackathonInputSchema.parse({
        title: raw.title,
        organizer: raw.organization_name || null,
        platform: "devpost",
        canonicalUrl: raw.url,
        registrationUrl: raw.url,
        coverImageUrl: raw.thumbnail_url
          ? raw.thumbnail_url.startsWith("//")
            ? `https:${raw.thumbnail_url}`
            : raw.thumbnail_url
          : null,
        description: null,
        registrationOpenAt: null,
        registrationDeadlineAt: null,
        eventStartAt: null,
        eventEndAt: null,
        eventTimezone: null,
        participationMode:
          raw.displayed_location?.location === "Online"
            ? "online"
            : "in_person",
        location:
          raw.displayed_location?.location === "Online"
            ? null
            : raw.displayed_location?.location,
        country: null,
        topics: [],
        technologies: (raw.themes || []).map((t: any) => t.name).slice(0, 20),
        prizeAmount: null,
        prizeCurrency: null,
        prizeDetails: raw.prize_amount || null,
        sourceStatus: raw.open_state === "open" ? "open" : "closed",
      });
      return {
        ok: true,
        event: {
          externalId: String(raw.id),
          input,
          sourceUpdatedAt: new Date(),
          metadata: { fetchedVia: "direct_api" },
        },
      };
    } catch (e: any) {
      return { ok: false, externalId: String(raw.id || ""), reason: e.message };
    }
  },
};
