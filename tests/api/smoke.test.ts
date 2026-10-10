import { describe, expect, it } from "vitest";
import { api, signUp } from "../helpers";

describe("smoke", () => {
	it("health reports migrations applied", async () => {
		const res = await api("/api/health");
		expect(res.status).toBe(200);
		expect(res.body.data.migrationsApplied).toBe(true);
	});
	it("can sign up and read /api/me", async () => {
		const u = await signUp();
		const me = await api("/api/me", { cookie: u.cookie });
		expect(me.status).toBe(200);
		expect(me.body.data.email).toBe(u.email);
		expect(me.body.data.role).toBe("user");
	});
});
