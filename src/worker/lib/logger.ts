// Structured JSON logs (visible in `wrangler tail` / Workers Observability).
// Values under sensitive-looking keys are redacted, and bearer tokens / long
// secrets embedded in strings are masked, so logs never leak credentials.

const SENSITIVE_KEY = /(secret|token|password|passwd|api[-_]?key|authorization|cookie|session)/i;

export function redact(value: unknown, depth = 0): unknown {
	if (depth > 4) return "[truncated]";
	if (typeof value === "string") return redactString(value);
	if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			out[k] = SENSITIVE_KEY.test(k) ? "[redacted]" : redact(v, depth + 1);
		}
		return out;
	}
	return value;
}

export function redactString(s: string): string {
	return s
		.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
		.replace(/([?&](?:token|key|api_key|secret|signature)=)[^&\s]+/gi, "$1[redacted]")
		.replace(/\bre_[A-Za-z0-9_]{10,}\b/g, "[redacted]")
		.slice(0, 2000);
}

/** Error text safe to persist (sync logs) or show to admins. */
export function safeErrorMessage(err: unknown): string {
	const raw = err instanceof Error ? err.message : String(err);
	return redactString(raw).slice(0, 500);
}

type Level = "info" | "warn" | "error";

export function log(level: Level, event: string, fields: Record<string, unknown> = {}) {
	const line = JSON.stringify({ level, event, ts: new Date().toISOString(), ...(redact(fields) as object) });
	if (level === "error") console.error(line);
	else if (level === "warn") console.warn(line);
	else console.log(line);
}
