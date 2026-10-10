import { hackathonInputSchema } from "@shared/schemas";
import type { ProviderAdapter, NormalizeResult } from "./types";
import { fetchWithRetry } from "./feed-adapter";

export const unstopAdapter: ProviderAdapter = {
  platformId: "unstop",
  displayName: "Unstop",
  homepageUrl: "https://unstop.com/",
  policySummary: "Custom Unstop API Integration",
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
        `https://unstop.com/api/public/opportunity/search-new?opportunity=hackathons&oppstatus=open&per_page=100&page=${page}`,
        {},
        opts.fetcher,
      );
      const data = (await res.json()) as any;
      if (!data?.data?.data || data.data.data.length === 0) break;
      records.push(...data.data.data);
      if (
        data.data.current_page >= data.data.last_page ||
        data.data.data.length < 100
      )
        break;
      page++;
    }
    return { records, pagesFetched: page, truncated: false };
  },
  normalizeEvent: (raw: any): NormalizeResult => {
    try {
      const input = hackathonInputSchema.parse({
        title: raw.title,
        organizer: raw.organisation?.name || null,
        platform: "unstop",
        canonicalUrl: `https://unstop.com/${raw.public_url}`,
        registrationUrl: `https://unstop.com/${raw.public_url}`,
        coverImageUrl: raw.banner_mobile?.image_url || null,
        description: null,
        registrationOpenAt: raw.start_date
          ? new Date(raw.start_date).toISOString()
          : null,
        registrationDeadlineAt: raw.regnRequirements?.end_regn_dt
          ? new Date(raw.regnRequirements.end_regn_dt).toISOString()
          : null,
        eventStartAt: raw.start_date
          ? new Date(raw.start_date).toISOString()
          : null,
        eventEndAt: raw.end_date ? new Date(raw.end_date).toISOString() : null,
        eventTimezone: null,
        participationMode: raw.region === "online" ? "online" : "in_person",
        location:
          raw.address_with_country_logo?.address ||
          raw.address_with_country_logo?.city ||
          null,
        country: raw.address_with_country_logo?.country?.name || null,
        topics: [],
        technologies: (raw.required_skills || [])
          .map((s: any) => s.skill_name)
          .slice(0, 20),
        prizeAmount: null,
        prizeCurrency: null,
        prizeDetails: raw.prizes?.[0]?.others || null,
        sourceStatus: raw.status === "LIVE" ? "open" : "closed",
      });
      return {
        ok: true,
        event: {
          externalId: String(raw.id),
          input,
          sourceUpdatedAt: raw.updated_at
            ? new Date(raw.updated_at)
            : new Date(),
          metadata: { fetchedVia: "direct_api" },
        },
      };
    } catch (e: any) {
      return { ok: false, externalId: String(raw.id || ""), reason: e.message };
    }
  },
};
