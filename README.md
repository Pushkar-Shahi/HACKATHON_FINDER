# HackRadar

**Discover hackathons in one place. Track every deadline. Manage participation without losing opportunities across platforms.**

HackRadar is a full-stack hackathon discovery and tracking platform that runs entirely on Cloudflare: a React SPA served by Workers Static Assets, a Hono API on Cloudflare Workers, Cloudflare D1 for persistence, Better Auth for accounts, and Cron Triggers for synchronization and reminders.

It brings together events from **Devpost, MachineHack, Major League Hacking (MLH) and Unstop** — but only through methods those platforms permit. None of the four currently offers an open events API that HackRadar may use, so every source starts in **Manual Mode**: events arrive through manual entry, CSV import, or an **authorized feed** that an operator has explicit permission to connect. See [Source integration status](#19-source-integration-status-and-limitations).

---

## Contents

1. [Project overview](#1-project-overview)
2. [Features](#2-features)
3. [Architecture](#3-architecture)
4. [Technology stack](#4-technology-stack)
5. [Repository structure](#5-repository-structure)
6. [Prerequisites](#6-prerequisites)
7. [Local setup](#7-local-setup)
8. [Environment configuration](#8-environment-configuration)
9. [Authentication configuration](#9-authentication-configuration)
10. [D1 database creation](#10-d1-database-creation)
11. [Migration commands](#11-migration-commands)
12. [Local development commands](#12-local-development-commands)
13. [Testing](#13-testing)
14. [Cloudflare deployment](#14-cloudflare-deployment)
15. [GitHub integration](#15-github-integration)
16. [Cron Triggers](#16-cron-triggers)
17. [Optional email setup](#17-optional-email-setup)
18. [Optional R2 setup](#18-optional-r2-setup)
19. [Source integration status and limitations](#19-source-integration-status-and-limitations)
20. [Troubleshooting](#20-troubleshooting)
21. [Security considerations](#21-security-considerations)
22. [Future development ideas](#22-future-development-ideas)

---

## 1. Project overview

Students and developers check several hackathon sites every day. HackRadar replaces that with one dashboard that answers:

- What is open for registration, and what was just announced?
- Which deadlines are approaching (with honest countdowns — unknown dates are shown as unknown)?
- Which events match my interests (AI/ML, data science, web…), my format preference (online / in-person) and my eligibility?
- What have I saved, registered for, and what should I prioritize this week?

HackRadar is independent and not affiliated with or endorsed by any source platform. Registration always happens on the official event page.

## 2. Features

| Area | What works |
| --- | --- |
| **Dashboard** | Live counts from D1 (upcoming, registration open, deadlines in 7 days, ongoing, saved, registered) that deep-link to filtered views; *Closing soon*; quick views (all upcoming, open, AI & ML, data science, online, recently added, closing soon); transparent rule-based recommendations with reasons and cautions; recent activity. |
| **Discover** | Unified feed across sources with source badges; grid and compact list views; partial, case-insensitive, debounced search over title, description, organizer, platform, topics, technologies and eligibility; combined filters (platform, registration status, event status, mode, 17 topics, deadline windows incl. custom range and "no verified deadline", beginner-friendly, students, international, free, minimum prize per currency, team size, location, organizer, saved, tracked, mine); active filter chips and *Clear all*; sorting by deadline, start date, recently added, recently verified, alphabetical, relevance and prize (single currency only); pagination; loading, empty and error states. Filter state lives in the URL. |
| **Event details** | Overview, important dates (your timezone + the event's), eligibility with explicit "not stated" values, registration instructions, team requirements, topics, rewards, location, source links, verification status and contradictions, personal notes/team/priority, saved-list note, preparation milestones, ICS download. |
| **Tracker** | Statuses Interested → Shortlisted → Planning → Registered → Preparing → Submitted → Completed → Won / Not participating; priority, private notes, team name; search, status filters, deadline/start/priority sorting; CSV export. One record per user per event (unique constraint). |
| **Saved & collections** | Bookmarks with notes; named collections (e.g. "AI and ML", "High Priority"); add/remove/move between collections; sort by deadline, event date or date saved. |
| **Calendar** | Month, week and agenda views; registration opening, deadlines, event start/end and personal milestones with distinct colours; my events vs all events; ICS export for one event, selected entries or all deadlines in view. |
| **Notifications** | In-app reminders 7 days / 3 days / 24 hours / deadline day, plus verified deadline-change notices; per-interval and per-channel preferences; preferred local delivery time and timezone; idempotent scheduling and delivery (never duplicated); unread counts, read/unread, links to events; optional email via Resend; optional browser notifications (explicit permission). |
| **Manual entry & CSV** | Add/edit/delete your own events (private by default, Zod-validated on client and server, duplicate warnings); publication requests reviewed by admins; CSV import with preview, per-row validation, duplicate detection, row selection, downloadable error report and an atomic all-or-nothing commit; CSV export with formula-injection protection. |
| **Sources** | Per-platform status (Connected / Manual Mode / Setup Required / Sync Failed / Temporarily Unavailable — Connected only after a real successful sync), method, last attempted/successful sync, last-run counts, last error, auto-sync configuration, access policy and manual workflow. |
| **Admin** | Data-quality overview, provider sync + auto-sync toggle, sync logs, verification queue, publication review, duplicate review and merge (preserving bookmarks/tracking/sources), failed-import review, shared-event editing, demo-data management. Server-side authorization on every route. |
| **Accounts** | Email/password sign-up, sign-in, sign-out, persistent sessions, password change, password reset (when email is configured; printed to the console in local development), optional Google sign-in, delete tracking data, delete account. |

## 3. Architecture

```
                         ┌──────────────────── Cloudflare (one Worker) ────────────────────┐
 Browser ── GET /, /discover, … ──► Workers Static Assets (React SPA, SPA fallback)        │
    │                                                                                       │
    └──── fetch /api/* (same origin, cookies) ──► Worker: Hono router                       │
                                                   ├─ middleware: secure headers, session,  │
                                                   │  Origin check, Zod validation, limits │
                                                   ├─ /api/auth/*  → Better Auth            │
                                                   ├─ /api/*       → route handlers         │
                                                   │       └─ services (normalize, dedupe,  │
                                                   │          reminders, ICS, CSV, sync)    │
                                                   └─ Drizzle ORM ──► D1 (SQLite)           │
 Cron Triggers (UTC) ── scheduled() ──► provider sync (authorized feeds only)               │
                                    └─► reminder scheduling + delivery ──► (optional) Resend│
                         └─────────────────────────────────────────────────────────────────┘
```

Key decisions:

- **Same-origin API.** The SPA calls `/api/*` on its own origin, so there is no CORS configuration. `assets.run_worker_first: ["/api/*"]` routes API calls to the Worker; every other unknown path falls back to `index.html`.
- **No long-running processes.** Background work runs only in Cron Triggers; nothing uses `setInterval` or in-memory state.
- **Per-request clients.** D1 is reachable only via the request's `env`, so the Drizzle client and Better Auth instance are created per request.
- **UTC storage.** All instants are stored as epoch milliseconds in UTC. A wall-clock time is converted only with an explicitly chosen IANA timezone; HackRadar never guesses one.
- **Derived statuses.** Registration/event statuses are computed from stored dates (in TypeScript for display and in SQL for filtering — a test asserts both agree). They are HackRadar estimates, not confirmation from the platform.
- **Money** is stored as integer minor units with an ISO 4217 currency; prizes are never compared across currencies.

## 4. Technology stack

- **Frontend:** React 19, TypeScript, Vite 7, Tailwind CSS 4, shadcn/ui (Radix), Lucide React, React Router, TanStack Query, React Hook Form, Zod 4, date-fns (+ `@date-fns/tz`), Sonner.
- **Backend:** Cloudflare Workers, Hono, TypeScript, Cloudflare Vite plugin, Wrangler.
- **Database:** Cloudflare D1, Drizzle ORM, versioned SQL migrations (drizzle-kit → Wrangler).
- **Auth:** Better Auth (Drizzle adapter on D1), PBKDF2-SHA256 password hashing via Web Crypto.
- **Testing:** Vitest 4 with `@cloudflare/vitest-plugin` (tests run inside workerd with a real local D1), Testing Library + jsdom for route tests.
- **Optional:** Resend (email), Google OAuth.

## 5. Repository structure

```text
hackradar/
├── public/                  favicon, manifest, _headers (CSP), theme-init.js
├── src/
│   ├── react-app/           React SPA
│   │   ├── components/      layout, dashboard, hackathons, filters, calendar, notifications, common, ui (shadcn)
│   │   ├── pages/           one file per route
│   │   ├── hooks/           session, debounce, now-ticker, mutations
│   │   ├── lib/             API client, auth client, formatting, query client, zod resolver
│   │   ├── services/        typed API calls
│   │   ├── styles/          design tokens (light/dark)
│   │   ├── App.tsx          routes (code-split)
│   │   └── main.tsx
│   ├── worker/              Cloudflare Worker
│   │   ├── index.ts         Hono app + scheduled export
│   │   ├── scheduled.ts     Cron Trigger dispatcher
│   │   ├── routes/          auth, hackathons (+ my events / CSV), bookmarks, tracker, calendar, notifications, sources, me, admin
│   │   ├── middleware/      authentication, authorization, validation, security (Origin check, rate limit)
│   │   ├── auth/            Better Auth config, password hashing
│   │   ├── db/              Drizzle schema, client, queries (status SQL, listing)
│   │   ├── services/        integrations/ (devpost, machinehack, mlh, unstop, feed-adapter), event-normalizer,
│   │   │                    deduplication, synchronization, reminders, calendar-export, csv, recommendations, demo-data, email
│   │   └── lib/             HTTP helpers, redacting logger
│   └── shared/              constants, Zod schemas, API types, status & time logic (used by both sides)
├── drizzle/migrations/      versioned SQL migrations (0000 schema, 0001 platform seed)
├── tests/                   unit/ (logic + frontend), api/ (Worker + D1), integration/ (cron, migrations)
├── scripts/                 grant-admin.mjs, trigger-cron.mjs
├── docs/feed-format.md      authorized feed specification
├── .github/workflows/       ci.yml, deploy.yml
├── .dev.vars.example
├── drizzle.config.ts  vite.config.ts  vitest.config.ts  wrangler.jsonc  tsconfig*.json
└── LICENSE
```

## 6. Prerequisites

- Node.js 20 or newer (developed with Node 26 / npm 11) and npm.
- A Cloudflare account (free plan works for development; see the CPU note in [Troubleshooting](#20-troubleshooting)).
- Git and a GitHub account for the CI/CD workflow.
- Optional: a [Resend](https://resend.com) account for email; a Google Cloud OAuth client for Google sign-in.

Wrangler is installed as a dev dependency — use it through `npx wrangler …` or the npm scripts.

## 7. Local setup

```bash
git clone https://github.com/<you>/hackradar.git
cd hackradar
npm install
cp .dev.vars.example .dev.vars
# edit .dev.vars: set BETTER_AUTH_SECRET (see below) and make BETTER_AUTH_URL match your dev URL
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
npm run db:migrate:local
npm run dev
```

Open the printed URL (Vite defaults to `http://localhost:5173`). If you run on another port (`npm run dev -- --port 5180`), set `BETTER_AUTH_URL` to the same origin — Better Auth rejects requests from other origins.

Then:

1. Create an account at `/signup`.
2. Make yourself an administrator (see [§9](#9-authentication-configuration)): `npm run admin:grant -- you@example.com`
3. Optional: **Admin → Demo data → Load demo data** to explore the UI with clearly-labelled fictional events.
4. Add real events via **Add hackathon** or **My events & import → CSV import**.

> npm 11 may report that install scripts for `esbuild`/`workerd` were not run. Their platform binaries ship as optional dependencies, so nothing needs to be approved for HackRadar to work.

## 8. Environment configuration

Configuration is split into **vars** (non-secret, in `wrangler.jsonc`) and **secrets** (`wrangler secret put`, or `.dev.vars` locally). Infrastructure (D1) is accessed through **bindings**, never connection strings.

| Name | Kind | Required | Description |
| --- | --- | --- | --- |
| `DB` | D1 binding | yes | Application + auth database. |
| `ENVIRONMENT` | var | yes | `production`, `staging` or `development` (local). `development` prints password-reset links to the console. |
| `BETTER_AUTH_URL` | var | yes | Public origin of the app, e.g. `https://hackradar.<subdomain>.workers.dev`. |
| `TRUSTED_ORIGINS` | var | no | Extra comma-separated origins allowed to send authenticated requests. |
| `EMAIL_FROM` | var | with email | Sender, e.g. `HackRadar <noreply@your-domain.com>`. |
| `BETTER_AUTH_SECRET` | secret | yes | 32+ random bytes; signs sessions. |
| `RESEND_API_KEY` | secret | no | Enables password-reset and reminder emails. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | secret | no | Enables "Continue with Google". |
| `<PROVIDER>_FEED_URL` / `_FEED_TOKEN` / `_FEED_AUTHORIZATION_REF` | secret | no | Authorized feed per provider (`DEVPOST`, `MACHINEHACK`, `MLH`, `UNSTOP`). See [docs/feed-format.md](docs/feed-format.md). |

- **Local:** `.dev.vars` (gitignored) overrides vars and provides secrets.
- **Production:** edit `vars` in `wrangler.jsonc`; set secrets with `npx wrangler secret put NAME`.
- **Staging / preview:** `env.staging` in `wrangler.jsonc` has its own Worker name, D1 database and vars; set its secrets with `npx wrangler secret put NAME --env staging`.

No secret is ever exposed to the browser bundle: the frontend has no `VITE_*` secrets and reads only `/api/config` (booleans such as "email configured").

After changing bindings run `npm run cf-typegen` to regenerate `worker-configuration.d.ts`.

## 9. Authentication configuration

Better Auth runs inside the Worker at `/api/auth/*`, storing users, sessions, accounts, verification tokens and rate-limit counters in D1 (tables `user`, `session`, `account`, `verification`, `rate_limit`, created by migration `0000`).

- **Sessions:** 30 days, refreshed daily, `HttpOnly` + `SameSite=Lax` cookies, `Secure` when `BETTER_AUTH_URL` is https.
- **Passwords:** 10–128 characters, hashed with PBKDF2-SHA256 (100,000 iterations — the Workers maximum) via Web Crypto so hashing stays within Workers CPU limits.
- **Rate limits (D1-backed):** sign-in 5/min, sign-up 10/h, reset requests 5/h per IP; app-level limits on event creation, CSV import and admin sync.
- **Password reset:** requires `RESEND_API_KEY` + `EMAIL_FROM` in production. In local development the reset link is printed in the dev-server terminal. Without email in production the UI says reset is unavailable.
- **Google (optional):** create an OAuth client, add the redirect URI `<BETTER_AUTH_URL>/api/auth/callback/google`, then set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. The button appears only when both are set.

### Bootstrapping the first administrator

Roles live in `user.role` and **cannot be changed through any API** (sign-up and profile endpoints reject or ignore `role`). Grant admin with direct database access after the person has signed up:

```bash
npm run admin:grant -- you@example.com                        # local D1
npm run admin:grant -- you@example.com --remote               # production D1
npm run admin:grant -- you@example.com --remote --env staging # staging D1
npm run admin:grant -- someone@example.com --revoke           # remove admin
```

Admin routes re-check the role in D1 on every request, so revocation is immediate.

## 10. D1 database creation

```bash
npx wrangler login
npx wrangler d1 create hackradar-db
# optional non-production database for previews/staging:
npx wrangler d1 create hackradar-db-staging
```

Copy each printed `database_id` into `wrangler.jsonc` (top-level `d1_databases` for production, `env.staging.d1_databases` for staging), replacing `00000000-0000-0000-0000-000000000000`. The ID is not a secret and can be committed. Local development does not need a real ID.

## 11. Migration commands

Schema lives in `src/worker/db/schema.ts`; SQL migrations live in `drizzle/migrations/` and are applied by Wrangler, which records them in the `d1_migrations` table.

```bash
npm run db:generate          # after editing schema.ts → new drizzle/migrations/NNNN_*.sql
npm run db:migrate:local     # apply to the local D1 (.wrangler/state)
npm run db:migrate:remote    # apply to production D1
npm run db:migrate:staging   # apply to staging D1
npm run db:list:remote       # show applied/pending remote migrations
```

Migrations are forward-only. Never reset or drop the production database during a deploy; to change a column, add a new migration. Seed data for platforms is itself a migration (`0001_seed_platforms.sql`). Custom SQL migrations: `npx drizzle-kit generate --custom --name <name>`.

## 12. Local development commands

```bash
npm run dev                  # Vite + Worker in workerd, local D1, hot reload
npm run build                # typecheck (tsc -b) + client and Worker build into dist/
npm run preview              # build, then serve the production build locally
npm run lint                 # ESLint
npm run typecheck            # tsc -b only
npm run cf-typegen           # regenerate Worker binding types
npm run cron:test            # trigger the reminder cron on the running dev server
npm run cron:test -- sync    # trigger the sync cron
```

`cron:test` targets `http://localhost:5173` by default; set `HACKRADAR_DEV_URL=http://localhost:5180` if you use another port. Inspect the local database with:

```bash
npx wrangler d1 execute DB --local --command "SELECT id, title, registration_deadline_at FROM hackathons LIMIT 10"
```

## 13. Testing

```bash
npm test             # all projects
npm run test:watch
npx vitest run --project workers   # API + integration tests in workerd with D1
npx vitest run --project unit      # pure logic + React route tests (jsdom)
```

The `workers` project runs the real Worker (`SELF.fetch`) against a local D1 that has every migration applied. Coverage includes: countdowns and unknown deadlines; timezone conversion and DST; sorting; combined filters; search (incl. LIKE-wildcard escaping); duplicate detection and merging; validation; bookmark persistence; tracker updates; cross-user ownership protection; admin authorization and privilege-escalation attempts; Origin/CSRF checks; failed/partial/unavailable sync handling; CSV validation and atomic import; notification idempotency; deadline-change handling; demo labelling; sign-up/sign-in/sign-out/expired sessions; account and data deletion; ICS output; SQL ⇔ TypeScript status consistency; D1 migrations; both Cron Trigger handlers; and frontend route guarding. The production build is verified by `npm run build` and `npx wrangler deploy --dry-run` (also run in CI).

## 14. Cloudflare deployment

First deployment from your machine:

```bash
npx wrangler login
npx wrangler d1 create hackradar-db            # paste database_id into wrangler.jsonc
npx wrangler secret put BETTER_AUTH_SECRET     # paste a random 32-byte value
npm run db:migrate:remote
npm run deploy                                 # build + wrangler deploy
```

`wrangler deploy` prints your URL (`https://hackradar.<subdomain>.workers.dev`). Set `vars.BETTER_AUTH_URL` in `wrangler.jsonc` to exactly that origin and run `npm run deploy` again, then sign up and run `npm run admin:grant -- you@example.com --remote`.

**Verify the deployment**

```bash
curl https://hackradar.<subdomain>.workers.dev/api/health
# {"data":{"status":"ok","database":"ok","migrationsApplied":true,"authConfigured":true,...}}
```

Then open the URL, refresh on a deep link such as `/discover?deadline=7d` (must not 404), sign up, save an event, sign out and back in (the save persists).

**Staging / previews**

```bash
npx wrangler secret put BETTER_AUTH_SECRET --env staging
npm run db:migrate:staging
npm run deploy:staging        # builds with CLOUDFLARE_ENV=staging, deploys hackradar-staging
```

Staging has its own D1 database, so preview traffic never touches production data. Avoid `wrangler versions upload` for previews of this app: uploaded versions share the production Worker's bindings, including the production D1.

**Custom domain (optional)** — in the Cloudflare dashboard open *Workers & Pages → hackradar → Settings → Domains & Routes → Add custom domain*, or add to `wrangler.jsonc`:

```jsonc
"routes": [{ "pattern": "hackradar.your-domain.com", "custom_domain": true }]
```

Then set `BETTER_AUTH_URL` to `https://hackradar.your-domain.com` (and list any other origin, e.g. the workers.dev URL, in `TRUSTED_ORIGINS`) and redeploy.

## 15. GitHub integration

```bash
git init && git add -A && git commit -m "HackRadar"
git branch -M main
git remote add origin git@github.com:<you>/hackradar.git
git push -u origin main
```

**Option A — GitHub Actions (included).** `.github/workflows/ci.yml` lints, tests, builds and dry-runs on pull requests. `.github/workflows/deploy.yml` deploys on every push to `main`: tests → build → `wrangler d1 migrations apply DB --remote` → `wrangler deploy` → health check. Add repository secrets:

- `CLOUDFLARE_API_TOKEN` — *My Profile → API Tokens → Create Token* with **Workers Scripts: Edit** and **D1: Edit** (Account) permissions.
- `CLOUDFLARE_ACCOUNT_ID` — shown on the Workers dashboard.

Application secrets stay in Cloudflare (`wrangler secret put`), never in GitHub.

**Option B — Cloudflare Workers Builds.** *Workers & Pages → hackradar → Settings → Build → Connect* your repository, set the production branch to `main`, build command `npm run build`, deploy command `npm run db:migrate:remote && npx wrangler deploy`. For non-production branches use `CLOUDFLARE_ENV=staging npm run build && npx wrangler deploy` so previews use the staging Worker and database. Use one option, not both.

## 16. Cron Triggers

Configured in `wrangler.jsonc` (expressions are UTC) and dispatched in `src/worker/scheduled.ts`:

| Cron | Job |
| --- | --- |
| `15 */6 * * *` | Provider sync. Contacts only providers with a valid authorized feed **and** auto-sync enabled in Admin. Manual-mode providers are never contacted. |
| `5 * * * *` | Reminders: cancel stale reminders (deadline changed, event un-saved, preference off), schedule reminders for deadlines in the next 8 days, deliver due in-app reminders, send email reminders when configured, skip missed ones. |

User-local delivery times are computed explicitly in each user's IANA timezone (DST-aware). Scheduling and delivery are idempotent: each reminder has a unique key `type:user:event:deadlineVersion:interval:channel`, and delivery moves a row from `scheduled` to `delivered` exactly once. Test locally with `npm run cron:test`; in production watch `npx wrangler tail` or *Workers → hackradar → Logs*.

## 17. Optional email setup

1. Create a Resend account and verify a sending domain.
2. `npx wrangler secret put RESEND_API_KEY`
3. Set `vars.EMAIL_FROM` in `wrangler.jsonc` (e.g. `"HackRadar <noreply@your-domain.com>"`) and redeploy.

Settings → Notifications then shows email as configured, enables the email checkboxes, and password reset becomes available. Without email, reminders are in-app only and any email reminders are recorded as `skipped` (never reported as sent).

## 18. Optional R2 setup

HackRadar does not need R2: events reference external links, and no user uploads are accepted, so no R2 binding is configured. If you add uploads (e.g. custom cover images), create a bucket (`npx wrangler r2 bucket create hackradar-uploads`), add an `r2_buckets` binding, accept files only through an authenticated Worker route that validates size and MIME type, generate random object keys, and keep the bucket private behind that route.

## 19. Source integration status and limitations

Policies were checked on **2026-10-10**. Re-check before enabling any automation.

| Platform | Finding | HackRadar status |
| --- | --- | --- |
| **Devpost** | Terms of Service §4 prohibit using software, scripts or robots to access, scrape, crawl or spider the site or its data. No public events API is documented. | **Manual Mode.** Never fetched automatically. An authorized feed can be connected only with Devpost's permission. |
| **MachineHack** | Only public API is a leaderboard endpoint (no hackathon listings); terms say contest data "may not be redistributed". | **Manual Mode.** |
| **MLH** | Terms of Use grant access for personal, non-commercial use and bar reproducing/distributing content without written consent. No public events API (MyMLH OAuth covers user profiles). | **Manual Mode.** |
| **Unstop** | No documented events API; robots.txt disallows `/api/*`; terms could not be retrieved without a browser session, so permission cannot be established. | **Manual Mode.** |

**No source currently has a verified automatic integration.** Each provider has a working adapter (`src/worker/services/integrations/`) implementing the common interface. It stays dormant until an operator configures an authorized feed ([docs/feed-format.md](docs/feed-format.md)); the source then shows **Setup Required** until a sync actually succeeds, at which point it becomes **Connected**. Failures surface as **Sync Failed** or **Temporarily Unavailable** without deleting any existing data.

Other limitations:

- Search uses indexed `LIKE` over a normalized text column; very large datasets would benefit from D1 FTS5.
- Pagination is offset-based (fine for thousands of events).
- Duplicate detection matches exact normalized titles and canonical URLs; fuzzy title similarity is not implemented.
- Browser notifications appear only while HackRadar is open (no Web Push service worker yet).
- Prize sorting compares a single currency; no currency conversion is performed.

## 20. Troubleshooting

| Symptom | Fix |
| --- | --- |
| Sign-in/sign-up returns 403 "invalid origin" | `BETTER_AUTH_URL` must equal the origin in your browser (scheme, host and port). Add other origins to `TRUSTED_ORIGINS`. |
| `/api/health` returns 503 with `migrationsApplied: false` | Run `npm run db:migrate:local` (dev) or `npm run db:migrate:remote` (prod). |
| `authConfigured: false` | Set `BETTER_AUTH_SECRET` (`.dev.vars` locally, `wrangler secret put` in prod). |
| `wrangler d1 migrations apply --remote` fails with an unknown database | Replace the placeholder `database_id` in `wrangler.jsonc`. |
| Deep links 404 in production | Ensure `assets.not_found_handling` is `single-page-application` (it is by default here) and you deployed the output of `npm run build`. |
| Port 5173 in use | `npm run dev -- --port 5180` and set `BETTER_AUTH_URL=http://localhost:5180` in `.dev.vars`. |
| "Exceeded CPU time limit" on sign-in (free plan) | Password hashing uses 100k PBKDF2 iterations. The Workers Paid plan removes the 10 ms limit; alternatively lower `ITERATIONS` in `src/worker/auth/password.ts` (weaker). |
| No reminders appear | Reminders cover saved or tracked events with deadlines in the next 8 days; check Settings → Notifications, then `npm run cron:test`. |
| Password reset says unavailable | Configure Resend ([§17](#17-optional-email-setup)). In development the link is printed in the terminal. |

## 21. Security considerations

- **Server-side authorization everywhere.** Every user query filters by the session's user id; private events are visible only to their creator (admins included, except pending publication requests). Tests verify cross-user isolation and privilege-escalation attempts.
- **Admin role** cannot be set via any API; it is granted by direct DB access and re-checked per request.
- **Validation:** Zod on client and server (shared schemas), request-size limits (64 KB JSON, 1 MB CSV), parameterized queries via Drizzle; `LIKE` wildcards in user input are escaped. Only `http(s)` URLs are stored or rendered; external links use `rel="noopener noreferrer nofollow"`.
- **CSRF:** SameSite=Lax cookies, an `Origin` check on all state-changing API requests, Better Auth's own origin checks, and no CORS headers.
- **XSS:** React escaping, no `dangerouslySetInnerHTML`, strict CSP for static assets (`public/_headers`), security headers on API responses.
- **CSV:** RFC 4180 parser, row/size limits, server-side revalidation on commit, atomic batch insert, formula-injection protection on export.
- **Outbound requests:** only to configured authorized feed URLs (https, hostname, no credentials in URL) and Resend. No user-supplied URL is ever fetched server-side (no SSRF surface).
- **Secrets** are Cloudflare secrets; logs pass through a redactor; API errors never include stack traces.
- **Data deletion:** Settings → Your data → *Delete tracking data* (`DELETE /api/me/data`) or *Delete account* (Better Auth `delete-user`, which purges private data first).

## 22. Future development ideas

- Partner integrations with any platform that grants API access (the adapter interface is ready).
- D1 FTS5 full-text search and cursor pagination.
- Web Push notifications via a service worker; digest emails.
- Team workspaces with shared trackers.
- Organizer self-service submissions with verification.
- Fuzzy duplicate detection (trigram similarity) feeding the admin review queue.
- Optional currency conversion for prize comparison with a recorded rate source and timestamp.
- iCalendar subscription feeds (per-user secret URL) instead of one-off ICS downloads.
