import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";

const alias = {
	"@": path.resolve(__dirname, "src/react-app"),
	"@shared": path.resolve(__dirname, "src/shared"),
};

export default defineConfig({
	test: {
		projects: [
			{
				// API + integration tests run inside workerd with a real (local) D1
				// database that has every migration in drizzle/migrations applied.
				resolve: { alias },
				plugins: [
					cloudflareTest(async () => ({
						wrangler: { configPath: "./wrangler.jsonc" },
						miniflare: {
							bindings: {
								ENVIRONMENT: "test",
								BETTER_AUTH_URL: "http://hackradar.test",
								BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-characters-long",
								TEST_MIGRATIONS: await readD1Migrations(path.join(__dirname, "drizzle/migrations")),
							},
						},
					})),
				],
				test: {
					name: "workers",
					include: ["tests/api/**/*.test.ts", "tests/integration/**/*.test.ts"],
					setupFiles: ["./tests/setup/apply-migrations.ts"],
				},
			},
			{
				// Pure business logic and React components.
				resolve: { alias },
				plugins: [react()],
				test: {
					name: "unit",
					include: ["tests/unit/**/*.test.{ts,tsx}"],
					environment: "node",
				},
			},
		],
	},
});
