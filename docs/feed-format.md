# HackRadar Feed v1 (authorized integrations)

HackRadar never scrapes Devpost, MachineHack, MLH or Unstop. The only automated
ingestion path is an **authorized feed**: a JSON endpoint that you have explicit
permission to consume (for example, API access granted by the platform under an
agreement, or an export published by an event organizer for this purpose).

A provider uses its feed only when **both** of these Cloudflare secrets are set:

| Secret | Purpose |
| --- | --- |
| `<PREFIX>_FEED_URL` | `https://` URL of the feed. Hostnames only (no IPs, no `localhost`), no credentials in the URL. |
| `<PREFIX>_FEED_AUTHORIZATION_REF` | A short note identifying the permission you hold (e.g. `"Devpost partner agreement 2026-03, ticket #123"`). Shown to admins; required so nothing is collected without a recorded authorization. |
| `<PREFIX>_FEED_TOKEN` *(optional)* | Sent as `Authorization: Bearer <token>`. |

`<PREFIX>` is `DEVPOST`, `MACHINEHACK`, `MLH` or `UNSTOP`.

```bash
npx wrangler secret put UNSTOP_FEED_URL
npx wrangler secret put UNSTOP_FEED_AUTHORIZATION_REF
npx wrangler secret put UNSTOP_FEED_TOKEN   # optional
```

Then, in **Admin → Sources & sync**, click **Sync now** to verify the connection.
The source shows **Connected** only after that sync succeeds. Turn on
**Auto-sync** to include it in the 6-hourly Cron Trigger.

## Request

```
GET <FEED_URL>?updated_since=<ISO-8601>&cursor=<opaque>
Accept: application/json
Authorization: Bearer <token>        (if configured)
```

- `updated_since` is sent after the first successful sync (incremental sync).
- `cursor` is sent when the previous page returned `nextCursor`.
- HackRadar fetches at most 10 pages and 500 records per run, retries 5xx and
  network errors twice with backoff, waits for `Retry-After` up to 5 seconds on
  `429`, and otherwise reports the provider as *Temporarily Unavailable*.

## Response

```json
{
  "version": 1,
  "nextCursor": null,
  "events": [
    {
      "id": "evt_123",
      "title": "Example AI Hackathon",
      "url": "https://organizer.example/hackathon",
      "registrationUrl": "https://organizer.example/hackathon/register",
      "description": "Plain text.",
      "organizer": "Example Org",
      "coverImageUrl": "https://organizer.example/cover.png",
      "registrationOpensAt": "2026-11-01T09:00:00+05:30",
      "registrationDeadlineAt": "2026-11-20T23:59:00+05:30",
      "startsAt": "2026-11-25T09:00:00+05:30",
      "endsAt": "2026-11-27T18:00:00+05:30",
      "timezone": "Asia/Kolkata",
      "mode": "online",
      "location": null,
      "country": "India",
      "topics": ["ai", "ml"],
      "technologies": ["Python", "PyTorch"],
      "prize": { "amount": 5000, "currency": "USD", "details": "1st: $3000, 2nd: $2000" },
      "teamSize": { "min": 1, "max": 4 },
      "fee": { "amount": 0, "currency": null },
      "eligibility": { "summary": "Students worldwide", "details": null, "students": true, "beginners": true, "international": true },
      "status": "open",
      "updatedAt": "2026-10-09T10:00:00Z"
    }
  ]
}
```

Rules:

- `id`, `title` and `url` are required; everything else may be omitted or
  `null`. **Missing values stay missing** — HackRadar never fills in guesses.
- Date-times must include an offset or `Z`. `timezone` is the event's IANA zone,
  used only for display.
- `mode` ∈ `online | in_person | hybrid`; `status` ∈ `open | closed | cancelled`.
- `topics` use HackRadar topic ids (`ai, ml, genai, agentic_ai, data_science, web,
  mobile, cybersecurity, cloud, devops_mlops, robotics, blockchain, fintech,
  healthcare, climate, open_innovation, other`); unknown topics are kept as
  technologies.
- `url` must be `http(s)`; records that fail validation are skipped and listed
  under **Admin → Failed imports**. A failed sync never deletes existing data.
- Records are matched by `(platform, id)` first, then by canonical URL. Matches on
  title alone are only flagged for admin review, never merged automatically.
