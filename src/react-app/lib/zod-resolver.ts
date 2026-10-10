// Minimal React Hook Form resolver for Zod 4 (keeps the dependency tree small).
import type { FieldErrors, FieldValues, Resolver } from "react-hook-form";
import type { z } from "zod";

export function zodResolver<Schema extends z.ZodType<FieldValues, FieldValues>>(
	schema: Schema,
): Resolver<z.input<Schema>, unknown, z.output<Schema>> {
	return async (values) => {
		const result = await schema.safeParseAsync(values);
		if (result.success) return { values: result.data, errors: {} };
		const errors: Record<string, unknown> = {};
		for (const issue of result.error.issues) {
			const path = issue.path.map(String);
			if (!path.length) path.push("root");
			let node = errors;
			path.forEach((key, i) => {
				if (i === path.length - 1) {
					if (!node[key]) node[key] = { type: issue.code, message: issue.message };
				} else {
					node[key] = (node[key] as Record<string, unknown>) ?? {};
					node = node[key] as Record<string, unknown>;
				}
			});
		}
		return { values: {}, errors: errors as FieldErrors<z.input<Schema>> };
	};
}
