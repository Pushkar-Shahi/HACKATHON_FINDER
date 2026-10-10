// Typed fetch wrapper for the same-origin Worker API (/api/*). Cookies carry
// the session; no tokens are ever stored in JavaScript.
import type { ApiErrorBody } from "@shared/types";

export class ApiError extends Error {
	constructor(
		public readonly status: number,
		public readonly code: string,
		message: string,
		public readonly fields?: Record<string, string[]>,
	) {
		super(message);
	}
	get isNetwork() {
		return this.status === 0;
	}
}

export type QueryValue = string | number | boolean | null | undefined | string[];

export function toQueryString(query?: Record<string, QueryValue>): string {
	if (!query) return "";
	const params = new URLSearchParams();
	for (const [k, v] of Object.entries(query)) {
		if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) continue;
		params.set(k, Array.isArray(v) ? v.join(",") : String(v));
	}
	const s = params.toString();
	return s ? `?${s}` : "";
}

export interface ApiOptions {
	method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
	json?: unknown;
	query?: Record<string, QueryValue>;
	signal?: AbortSignal;
}

export interface ApiResult<T, M = Record<string, unknown>> {
	data: T;
	meta?: M;
}

async function request(path: string, opts: ApiOptions): Promise<Response> {
	try {
		return await fetch(`${path}${toQueryString(opts.query)}`, {
			method: opts.method ?? "GET",
			credentials: "same-origin",
			headers: opts.json !== undefined ? { "Content-Type": "application/json" } : undefined,
			body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
			signal: opts.signal,
		});
	} catch (err) {
		if (err instanceof DOMException && err.name === "AbortError") throw err;
		throw new ApiError(0, "network_error", "Can't reach HackRadar. Check your connection and try again.");
	}
}

async function toError(res: Response): Promise<ApiError> {
	let body: Partial<ApiErrorBody> = {};
	try {
		body = await res.json();
	} catch {
		/* non-JSON error body */
	}
	const message =
		body.error?.message ??
		(res.status === 429 ? "Too many requests — please wait a moment." : res.status >= 500 ? "The server had a problem. Please try again." : `Request failed (${res.status})`);
	if (res.status === 401) window.dispatchEvent(new CustomEvent("hackradar:unauthorized"));
	return new ApiError(res.status, body.error?.code ?? "http_error", message, body.error?.fields);
}

export async function api<T, M = Record<string, unknown>>(path: string, opts: ApiOptions = {}): Promise<ApiResult<T, M>> {
	const res = await request(path, opts);
	if (!res.ok) throw await toError(res);
	return (await res.json()) as ApiResult<T, M>;
}

export async function apiData<T>(path: string, opts: ApiOptions = {}): Promise<T> {
	return (await api<T>(path, opts)).data;
}

/** Fetch a file (CSV / ICS) and hand it to the browser as a download. */
export async function downloadFile(path: string, filename: string, opts: ApiOptions = {}): Promise<void> {
	const res = await request(path, opts);
	if (!res.ok) throw await toError(res);
	const blob = await res.blob();
	saveBlob(blob, filename);
}

export function saveBlob(blob: Blob, filename: string) {
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function errorMessage(err: unknown): string {
	if (err instanceof ApiError) return err.message;
	if (err instanceof Error) return err.message;
	return "Something went wrong";
}
