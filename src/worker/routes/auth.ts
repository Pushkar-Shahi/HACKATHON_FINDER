// Better Auth's handlers (sign-up, sign-in, sign-out, sessions, password reset,
// optional Google OAuth, account deletion) mounted under /api/auth/*.
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { HttpError } from "../lib/http";

export const authRoutes = new Hono<AppEnv>();

authRoutes.on(["GET", "POST"], "/*", async (c) => {
	if (!c.env.BETTER_AUTH_SECRET) {
		throw new HttpError(503, "auth_not_configured", "Authentication is not configured on this deployment (BETTER_AUTH_SECRET is missing).");
	}
	return c.var.auth.handler(c.req.raw);
});
