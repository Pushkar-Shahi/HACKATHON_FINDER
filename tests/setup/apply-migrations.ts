import { applyD1Migrations, env } from "cloudflare:test";

// Apply drizzle/migrations to the test D1 database before each test file.
// applyD1Migrations is idempotent (it records applied migrations).
const testEnv = env as unknown as { DB: D1Database; TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] };
await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
