import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * Errors thrown inside route handlers are converted into the standard JSON
 * error body by the app-level error handler: { error: { code, message, fields? } }.
 */
export class HttpError extends Error {
	constructor(
		public readonly status: ContentfulStatusCode,
		public readonly code: string,
		message: string,
		public readonly fields?: Record<string, string[]>,
	) {
		super(message);
	}
}

export const notFound = (what = "Resource") => new HttpError(404, "not_found", `${what} not found`);
export const forbidden = (message = "You do not have permission to do that") => new HttpError(403, "forbidden", message);
export const unauthorized = () => new HttpError(401, "unauthorized", "Sign in to continue");
export const conflict = (message: string) => new HttpError(409, "conflict", message);
export const badRequest = (message: string, fields?: Record<string, string[]>) =>
	new HttpError(400, "bad_request", message, fields);

export function ok<T>(c: Context, data: T, meta?: Record<string, unknown>, status: ContentfulStatusCode = 200) {
	return c.json(meta ? { data, meta } : { data }, status);
}

export function created<T>(c: Context, data: T) {
	return c.json({ data }, 201);
}

export function toIso(d: Date | null | undefined): string | null {
	return d ? d.toISOString() : null;
}

export function parseJsonArray<T = string>(raw: string | null | undefined): T[] {
	if (!raw) return [];
	try {
		const v = JSON.parse(raw);
		return Array.isArray(v) ? (v as T[]) : [];
	} catch {
		return [];
	}
}

export function parseJsonObject(raw: string | null | undefined): Record<string, unknown> {
	if (!raw) return {};
	try {
		const v = JSON.parse(raw);
		return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}
