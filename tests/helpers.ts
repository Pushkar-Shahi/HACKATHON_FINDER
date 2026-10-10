// Helpers for API tests that call the Worker through SELF.fetch.
import { SELF } from "cloudflare:test";

export const ORIGIN = "http://hackradar.test";

export interface TestUser {
	email: string;
	cookie: string;
	id: string;
}

let counter = 0;

export async function api(path: string, init: RequestInit & { cookie?: string; json?: unknown } = {}) {
	const headers = new Headers(init.headers);
	headers.set("Origin", ORIGIN);
	if (init.cookie) headers.set("Cookie", init.cookie);
	let body = init.body;
	if (init.json !== undefined) {
		headers.set("Content-Type", "application/json");
		body = JSON.stringify(init.json);
	}
	const res = await SELF.fetch(`${ORIGIN}${path}`, { ...init, headers, body });
	const text = await res.text();
	let data: any = null;
	try {
		data = text ? JSON.parse(text) : null;
	} catch {
		data = text;
	}
	return { status: res.status, body: data, headers: res.headers, text };
}

function cookieFrom(res: { headers: Headers }): string {
	const all = res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie") ?? ""];
	return all
		.map((c) => c.split(";")[0])
		.filter(Boolean)
		.join("; ");
}

export async function signUp(name = "Test User"): Promise<TestUser> {
	counter++;
	const email = `user${Date.now()}${counter}${Math.floor(Math.random() * 1e6)}@example.com`;
	const res = await api("/api/auth/sign-up/email", { method: "POST", json: { email, password: "correct-horse-battery", name } });
	if (res.status !== 200) throw new Error(`sign-up failed: ${res.status} ${res.text}`);
	return { email, cookie: cookieFrom(res), id: res.body.user.id };
}

export async function signIn(email: string, password: string) {
	const res = await api("/api/auth/sign-in/email", { method: "POST", json: { email, password } });
	return { ...res, cookie: cookieFrom(res) };
}

export function isoIn(ms: number) {
	return new Date(Date.now() + ms).toISOString();
}

export const DAY = 86_400_000;
export const HOUR = 3_600_000;
export const MINUTE = 60_000;

export function eventInput(overrides: Record<string, unknown> = {}) {
	return {
		title: `Test Hackathon ${Math.random().toString(36).slice(2, 8)}`,
		platform: "devpost",
		canonicalUrl: `https://example.com/events/${Math.random().toString(36).slice(2)}`,
		registrationDeadlineAt: isoIn(5 * DAY),
		eventStartAt: isoIn(10 * DAY),
		eventEndAt: isoIn(12 * DAY),
		eventTimezone: "UTC",
		participationMode: "online",
		topics: ["ai"],
		technologies: ["Python"],
		...overrides,
	};
}
