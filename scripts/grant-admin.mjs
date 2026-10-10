#!/usr/bin/env node
// Bootstrap (or revoke) an administrator. Roles can only be changed with direct
// database access — there is intentionally no API endpoint for it.
//
//   npm run admin:grant -- you@example.com            # local D1
//   npm run admin:grant -- you@example.com --remote   # production D1
//   npm run admin:grant -- you@example.com --remote --env staging
//   npm run admin:grant -- you@example.com --revoke
//
// The user must already have signed up.
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const email = args.find((a) => !a.startsWith("--"));
const remote = args.includes("--remote");
const revoke = args.includes("--revoke");
const envIdx = args.indexOf("--env");
const envName = envIdx >= 0 ? args[envIdx + 1] : null;

// Strict validation: the value is embedded in SQL, so only plain addresses are accepted.
if (!email || !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email)) {
	console.error("Usage: npm run admin:grant -- <email> [--remote] [--env staging] [--revoke]");
	process.exit(1);
}

const role = revoke ? "user" : "admin";
const sql = `UPDATE user SET role = '${role}' WHERE lower(email) = lower('${email}'); SELECT email, role FROM user WHERE lower(email) = lower('${email}');`;
const wranglerArgs = ["wrangler", "d1", "execute", "DB", remote ? "--remote" : "--local", "--command", sql];
if (envName) wranglerArgs.push("--env", envName);

const res = spawnSync("npx", wranglerArgs, { stdio: "inherit", shell: false });
if (res.status !== 0) process.exit(res.status ?? 1);
console.log(`\n${revoke ? "Revoked admin from" : "Granted admin to"} ${email} (${remote ? "remote" : "local"}${envName ? `, env ${envName}` : ""}). If no row is listed above, the user has not signed up yet.`);
