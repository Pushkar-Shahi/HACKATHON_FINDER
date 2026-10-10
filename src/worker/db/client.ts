import { drizzle } from "drizzle-orm/d1";
import { schema } from "./schema";

/** Creates a request-scoped Drizzle client over the D1 binding. */
export function createDb(d1: D1Database) {
	return drizzle(d1, { schema });
}

export type Database = ReturnType<typeof createDb>;
