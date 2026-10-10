// Better Auth configured for Cloudflare Workers + D1 (via the Drizzle adapter).
//
// A new auth instance is created per request because D1 is only reachable
// through the request's `env` binding — there is no global connection.
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { AppBindings } from "../env";
import { isDevelopment } from "../env";
import type { Database } from "../db/client";
import { authSchema } from "../db/schema";
import { hashPassword, verifyPassword } from "./password";
import { isEmailConfigured, sendEmail, escapeHtml } from "../services/email";
import { createDefaultUserData, purgeUserData } from "../services/user-data";
import { log } from "../lib/logger";

export function trustedOrigins(env: AppBindings): string[] {
	const origins = new Set<string>();
	try {
		origins.add(new URL(env.BETTER_AUTH_URL).origin);
	} catch {
		/* invalid BETTER_AUTH_URL is reported by /api/health */
	}
	for (const o of (env.TRUSTED_ORIGINS ?? "").split(",")) {
		const trimmed = o.trim();
		if (trimmed) origins.add(trimmed.replace(/\/$/, ""));
	}
	return [...origins];
}

export function isGoogleConfigured(env: AppBindings): boolean {
	return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

export function createAuth(env: AppBindings, db: Database) {
	const secureCookies = env.BETTER_AUTH_URL.startsWith("https://");
	return betterAuth({
		appName: "HackRadar",
		baseURL: env.BETTER_AUTH_URL,
		basePath: "/api/auth",
		secret: env.BETTER_AUTH_SECRET,
		trustedOrigins: trustedOrigins(env),
		database: drizzleAdapter(db, { provider: "sqlite", schema: authSchema }),
		emailAndPassword: {
			enabled: true,
			minPasswordLength: 10,
			maxPasswordLength: 128,
			autoSignIn: true,
			revokeSessionsOnPasswordReset: true,
			resetPasswordTokenExpiresIn: 60 * 60,
			password: { hash: hashPassword, verify: verifyPassword },
			sendResetPassword: async ({ user, url }) => {
				if (isEmailConfigured(env)) {
					const result = await sendEmail(env, {
						to: user.email,
						subject: "Reset your HackRadar password",
						text: `Someone requested a password reset for your HackRadar account.\n\nReset it here (valid for 1 hour): ${url}\n\nIf this wasn't you, ignore this email.`,
						html: `<p>Someone requested a password reset for your HackRadar account.</p><p><a href="${escapeHtml(url)}">Reset your password</a> (valid for 1 hour).</p><p>If this wasn't you, ignore this email.</p>`,
					});
					if (!result.ok) log("warn", "auth.reset_email_failed", { error: result.error });
				} else if (isDevelopment(env)) {
					// Local development only: print the link so the flow can be tested without an email provider.
					console.log(`[dev] Password reset link for ${user.email}: ${url}`);
				} else {
					log("warn", "auth.reset_email_unavailable", { reason: "email_not_configured" });
				}
			},
		},
		socialProviders: isGoogleConfigured(env)
			? { google: { clientId: env.GOOGLE_CLIENT_ID!, clientSecret: env.GOOGLE_CLIENT_SECRET! } }
			: undefined,
		user: {
			additionalFields: {
				// input:false → cannot be supplied by sign-up or update-user requests.
				role: { type: "string", required: false, defaultValue: "user", input: false },
			},
			deleteUser: {
				enabled: true,
				beforeDelete: async (u) => {
					await purgeUserData(db, u.id);
				},
			},
		},
		session: {
			expiresIn: 60 * 60 * 24 * 30,
			updateAge: 60 * 60 * 24,
		},
		rateLimit: {
			enabled: env.ENVIRONMENT !== "test",
			storage: "database",
			window: 60,
			max: 100,
			customRules: {
				"/sign-in/email": { window: 60, max: 5 },
				"/sign-up/email": { window: 60 * 60, max: 10 },
				"/request-password-reset": { window: 60 * 60, max: 5 },
				"/reset-password": { window: 60 * 15, max: 10 },
				"/change-password": { window: 60 * 15, max: 10 },
			},
		},
		advanced: {
			useSecureCookies: secureCookies,
			ipAddress: { ipAddressHeaders: ["cf-connecting-ip", "x-forwarded-for"] },
			defaultCookieAttributes: { sameSite: "lax", httpOnly: true, secure: secureCookies },
		},
		databaseHooks: {
			user: {
				create: {
					after: async (u) => {
						await createDefaultUserData(db, u.id, u.name);
					},
				},
			},
		},
		telemetry: { enabled: false },
	});
}

export type Auth = ReturnType<typeof createAuth>;
export type AuthSession = Auth["$Infer"]["Session"]["session"];
export type AuthUser = Auth["$Infer"]["Session"]["user"];
