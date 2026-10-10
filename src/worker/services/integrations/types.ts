// Common provider-adapter interface. Every platform implements the same
// contract so the synchronization service never contains provider-specific code.
import type { HackathonInput } from "@shared/schemas";
import type { IntegrationMode, IntegrationStatus, SourcePlatformId } from "@shared/constants";
import type { AppBindings } from "../../env";

export interface ProviderConfig {
	mode: IntegrationMode;
	/** True when the configuration is complete and safe to use. */
	valid: boolean;
	/** Human-readable reason when `valid` is false (never contains secrets). */
	problem: string | null;
	feedUrl: string | null;
	token: string | null;
	/** Operator-supplied reference to the agreement/permission that authorizes access. */
	authorizationRef: string | null;
}

/** A record as produced by a provider, after normalization and validation. */
export interface ProviderEvent {
	externalId: string;
	input: HackathonInput;
	sourceUpdatedAt: Date | null;
	metadata: Record<string, unknown> | null;
}

export type NormalizeResult = { ok: true; event: ProviderEvent } | { ok: false; externalId: string | null; reason: string };

export interface FetchOptions {
	/** Only return records updated since this instant (incremental sync). */
	since: Date | null;
	fetcher: typeof fetch;
	maxPages: number;
}

export interface FetchResult {
	records: unknown[];
	pagesFetched: number;
	truncated: boolean;
}

export interface ProviderStatus {
	status: IntegrationStatus;
	detail: string;
}

export interface ProviderAdapter {
	readonly platformId: SourcePlatformId;
	readonly displayName: string;
	readonly homepageUrl: string;
	/** Short statement of what the platform's terms permit, as verified when the adapter was written. */
	readonly policySummary: string;
	/** What users do while the provider is in Manual Mode. */
	readonly manualWorkflow: string;
	getConfig(env: AppBindings): ProviderConfig;
	fetchEvents(config: ProviderConfig, opts: FetchOptions): Promise<FetchResult>;
	normalizeEvent(raw: unknown): NormalizeResult;
}

/** 429 / 5xx / network failures — the provider may recover on its own. */
export class ProviderUnavailableError extends Error {
	constructor(
		message: string,
		public readonly retryAfterSeconds: number | null = null,
	) {
		super(message);
	}
}

/** Bad configuration, 4xx responses or malformed payloads — needs operator attention. */
export class ProviderResponseError extends Error {}
