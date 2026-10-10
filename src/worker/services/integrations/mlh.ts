import { hackathonInputSchema } from "@shared/schemas";
import type { ProviderAdapter, NormalizeResult } from "./types";
import { fetchWithRetry } from "./feed-adapter";

export const mlhAdapter: ProviderAdapter = {
  platformId: "mlh",
  displayName: "MLH",
  homepageUrl: "https://mlh.com/",
  policySummary: "Custom MLH Integration",
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
    for (const year of [
      new Date().getFullYear(),
      new Date().getFullYear() + 1,
    ]) {
      try {
        const res = await fetchWithRetry(
          `https://mlh.com/seasons/${year}/events`,
          {},
          opts.fetcher,
        );
        const html = await res.text();
        const match = html.match(
          /<script data-page="app" type="application\/json">(.*?)<\/script>/,
        );
        if (match && match[1]) {
          const data = JSON.parse(match[1]);
          if (data.props?.pastEvents) records.push(...data.props.pastEvents);
          if (data.props?.upcomingEvents)
            records.push(...data.props.upcomingEvents);
        }
      } catch (e) {
        // Ignore missing seasons
      }
    }
    return { records, pagesFetched: 1, truncated: false };
  },
  normalizeEvent: (raw: any): NormalizeResult => {
    try {
      const input = hackathonInputSchema.parse({
        title: raw.name,
        organizer: null,
        platform: "mlh",
        canonicalUrl: raw.websiteUrl || `https://mlh.com${raw.url}`,
        registrationUrl: raw.websiteUrl || `https://mlh.com${raw.url}`,
        coverImageUrl: raw.backgroundUrl || raw.logoUrl || null,
        description: null,
        registrationOpenAt: null,
        registrationDeadlineAt: null,
        eventStartAt: raw.startsAt || null,
        eventEndAt: raw.endsAt || null,
        eventTimezone: null,
        participationMode:
          raw.formatType === "digital"
            ? "online"
            : raw.formatType === "physical"
              ? "in_person"
              : "hybrid",
        location: raw.venueAddress?.city
          ? `${raw.venueAddress.city}, ${raw.venueAddress.state}`
          : raw.location,
        country: raw.venueAddress?.country || null,
        topics: [],
        technologies: [],
        prizeAmount: null,
        prizeCurrency: null,
        prizeDetails: null,
        sourceStatus: raw.status === "ended" ? "closed" : "open",
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
