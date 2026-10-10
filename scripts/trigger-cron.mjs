#!/usr/bin/env node
// Trigger a Cron Trigger handler on the running local dev server.
//   npm run cron:test -- reminders   (default)
//   npm run cron:test -- sync
// Uses the /cdn-cgi/handler/scheduled endpoint exposed by the Cloudflare Vite
// plugin / wrangler dev. Set HACKRADAR_DEV_URL if your dev server isn't on :5173.
const job = process.argv[2] ?? "reminders";
const cron = job === "sync" ? "15 */6 * * *" : "5 * * * *";
const base = process.env.HACKRADAR_DEV_URL ?? "http://localhost:5173";
const url = `${base}/cdn-cgi/handler/scheduled?cron=${encodeURIComponent(cron)}`;
const res = await fetch(url);
console.log(`${res.status} ${res.statusText} — triggered "${cron}" (${job}) at ${url}`);
console.log(await res.text());
if (!res.ok) process.exit(1);
