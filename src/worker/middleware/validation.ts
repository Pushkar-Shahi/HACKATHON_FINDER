// Zod-powered request validation producing consistent 400 responses:
// { error: { code: "validation_error", message, fields: { "path": ["msg"] } } }
import { validator } from "hono/validator";
import type { ValidationTargets } from "hono";
import type { z } from "zod";

export function issuesToFields(issues: z.core.$ZodIssue[]): Record<string, string[]> {
	const fields: Record<string, string[]> = {};
	for (const issue of issues) {
		const key = issue.path.map(String).join(".") || "_root";
		(fields[key] ??= []).push(issue.message);
	}
	return fields;
}

export function validate<Target extends keyof ValidationTargets, Schema extends z.ZodType>(target: Target, schema: Schema) {
	return validator(target, (value, c) => {
		const result = schema.safeParse(value);
		if (!result.success) {
			return c.json(
				{ error: { code: "validation_error", message: "Some fields are invalid", fields: issuesToFields(result.error.issues) } },
				400,
			);
		}
		return result.data as z.output<Schema>;
	});
}
