// Typed Worker bindings. D1 comes from wrangler.jsonc; plain vars from "vars";
// secrets from `wrangler secret put` (production) or .dev.vars (local).
// Every optional secret is typed as optional so code must handle "not configured".
import type { Database } from "./db/client";
import type { AuthSession, AuthUser, Auth } from "./auth/config";

export interface AppBindings {
	DB: D1Database;
	ENVIRONMENT: string;
	BETTER_AUTH_URL: string;
	BETTER_AUTH_SECRET?: string;
	/** Comma-separated extra origins allowed to call the API with cookies. */
	TRUSTED_ORIGINS?: string;

	// Optional email delivery (Resend). Both must be set to enable email.
	RESEND_API_KEY?: string;
	EMAIL_FROM?: string;

	// Optional Google OAuth. Both must be set to enable "Continue with Google".
	GOOGLE_CLIENT_ID?: string;
	GOOGLE_CLIENT_SECRET?: string;

	// Optional authorized provider feeds (see README → "Source integrations").
	// A feed is only used when FEED_URL *and* FEED_AUTHORIZATION_REF are set.
	DEVPOST_FEED_URL?: string;
	DEVPOST_FEED_TOKEN?: string;
	DEVPOST_FEED_AUTHORIZATION_REF?: string;
	MACHINEHACK_FEED_URL?: string;
	MACHINEHACK_FEED_TOKEN?: string;
	MACHINEHACK_FEED_AUTHORIZATION_REF?: string;
	MLH_FEED_URL?: string;
	MLH_FEED_TOKEN?: string;
	MLH_FEED_AUTHORIZATION_REF?: string;
	UNSTOP_FEED_URL?: string;
	UNSTOP_FEED_TOKEN?: string;
	UNSTOP_FEED_AUTHORIZATION_REF?: string;
}

export interface AppVariables {
	db: Database;
	auth: Auth;
	user: AuthUser | null;
	session: AuthSession | null;
	requestId: string;
}

export interface AppEnv {
	Bindings: AppBindings;
	Variables: AppVariables;
}

export function isProduction(env: AppBindings): boolean {
	return env.ENVIRONMENT === "production";
}

export function isDevelopment(env: AppBindings): boolean {
	return env.ENVIRONMENT === "development" || env.ENVIRONMENT === "test";
}
