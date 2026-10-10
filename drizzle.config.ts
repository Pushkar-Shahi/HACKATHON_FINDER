import { defineConfig } from "drizzle-kit";

// drizzle-kit only *generates* SQL migration files here. They are applied to
// D1 with Wrangler (`npm run db:migrate:local` / `npm run db:migrate:remote`),
// which records applied migrations in the d1_migrations table.
export default defineConfig({
	dialect: "sqlite",
	schema: "./src/worker/db/schema.ts",
	out: "./drizzle/migrations",
});
