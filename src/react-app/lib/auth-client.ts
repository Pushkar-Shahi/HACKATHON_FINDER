// Better Auth browser client. Talks to /api/auth/* on the same origin.
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
	baseURL: typeof window !== "undefined" ? window.location.origin : undefined,
	basePath: "/api/auth",
});
