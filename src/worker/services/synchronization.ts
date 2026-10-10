// Provider synchronization. Called by the 6-hourly Cron Trigger (only for
// providers with a valid authorized feed and auto-sync enabled) and by
// administrators. A failed sync records the error and leaves every previously
// imported record untouched — nothing is ever deleted because a provider failed.
import { and, desc, eq, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { hackathonSources, hackathons, platforms, syncRecordErrors, syncRuns } from "../db/schema";
import type { AppBindings } from "../env";
import type { IntegrationStatus, SourcePlatformId } from "@shared/constants";
import type { SourceStatusReport } from "@shared/types";
import { PROVIDERS } from "./integrations";
import { ProviderUnavailableError, type ProviderAdapter, type ProviderConfig, type ProviderEvent, type ProviderStatus } from "./integrations/types";
import { createHackathon, updateHackathon } from "./hackathon-writer";
import { canonicalUrlKey, normalizeTitle, toHackathonColumns } from "./event-normalizer";
import { findDuplicates, recordDuplicateCandidates } from "./deduplication";
import { notifyDeadlineChange } from "./reminders";
import { log, safeErrorMessage } from "../lib/logger";
import { toIso } from "../lib/http";

export const MAX_RECORDS_PER_RUN = 500;
const MAX_PAGES_PER_RUN = 10;

export interface SyncSummary {
	platformId: SourcePlatformId;
	status: "success" | "partial" | "failed" | "unavailable" | "skipped";
	runId: string | null;
	fetched: number;
	added: number;
	updated: number;
	unchanged: number;
	skipped: number;
	error: string | null;
}

export interface SyncOptions {
	trigger: "cron" | "admin";
	userId?: string | null;
	now?: number;
	fetcher?: typeof fetch;
}

/** Compare provider-owned columns to decide whether an update is real. */
function columnsDiffer(existing: typeof hackathons.$inferSelect, cols: ReturnType<typeof toHackathonColumns>): boolean {
	for (const [key, value] of Object.entries(cols)) {
		const current = (existing as Record<string, unknown>)[key];
		const a = current instanceof Date ? current.getTime() : (current ?? null);
		const b = value instanceof Date ? value.getTime() : (value ?? null);
		if (a !== b) return true;
	}
	return false;
}

type UpsertOutcome = "added" | "updated" | "unchanged";

export async function upsertProviderEvent(db: Database, platformId: SourcePlatformId, ev: ProviderEvent, now: number): Promise<UpsertOutcome> {
	const nowDate = new Date(now);
	// 1. Reliable provider id match → same record.
	const [byExternal] = await db
		.select({ source: hackathonSources, row: hackathons })
		.from(hackathonSources)
		.innerJoin(hackathons, eq(hackathons.id, hackathonSources.hackathonId))
		.where(and(eq(hackathonSources.platformId, platformId), eq(hackathonSources.externalEventId, ev.externalId)))
		.limit(1);

	if (byExternal) {
		const { source, row } = byExternal;
		const sourceUnchanged =
			ev.sourceUpdatedAt !== null && source.sourceUpdatedAt !== null && ev.sourceUpdatedAt.getTime() <= source.sourceUpdatedAt.getTime();
		const cols = toHackathonColumns(ev.input);
		if (sourceUnchanged || !columnsDiffer(row, cols)) {
			await db.batch([
				db.update(hackathons).set({ lastCheckedAt: nowDate, lastVerifiedAt: nowDate }).where(eq(hackathons.id, row.id)),
				db.update(hackathonSources).set({ lastCheckedAt: nowDate }).where(eq(hackathonSources.id, source.id)),
			]);
			return "unchanged";
		}
		const changes = await updateHackathon(
			db,
			row,
			ev.input,
			{ changedBy: "sync", changedByUserId: null, markVerified: true, lastCheckedAt: nowDate, sourceUpdatedAt: ev.sourceUpdatedAt },
			[
				db
					.update(hackathonSources)
					.set({
						sourceEventUrl: ev.input.canonicalUrl,
						sourceRegistrationUrl: ev.input.registrationUrl,
						sourceUpdatedAt: ev.sourceUpdatedAt,
						lastCheckedAt: nowDate,
					})
					.where(eq(hackathonSources.id, source.id)),
			],
		);
		const deadlineChange = changes.find((c) => c.field === "registrationDeadlineAt");
		if (deadlineChange && deadlineChange.oldValue) {
			await notifyDeadlineChange(db, { id: row.id, title: ev.input.title }, deadlineChange.oldValue, deadlineChange.newValue, now);
		}
		return "updated";
	}

	// 2. Same canonical URL as an existing public record (e.g. listed on two platforms):
	//    attach source attribution without overwriting the primary platform's data.
	const subject = {
		canonicalUrlKey: canonicalUrlKey(ev.input.canonicalUrl),
		normalizedTitle: normalizeTitle(ev.input.title),
		organizer: ev.input.organizer,
		eventStartAt: ev.input.eventStartAt ? Date.parse(ev.input.eventStartAt) : null,
		registrationDeadlineAt: ev.input.registrationDeadlineAt ? Date.parse(ev.input.registrationDeadlineAt) : null,
	};
	const matches = await findDuplicates(db, subject, { userId: null });
	const exact = matches.find((m) => m.confidence === "exact");
	if (exact) {
		await db.batch([
			db
				.insert(hackathonSources)
				.values({
					hackathonId: exact.hackathonId,
					platformId,
					externalEventId: ev.externalId,
					sourceEventUrl: ev.input.canonicalUrl,
					sourceRegistrationUrl: ev.input.registrationUrl,
					sourceUpdatedAt: ev.sourceUpdatedAt,
					lastCheckedAt: nowDate,
					metadata: ev.metadata ? JSON.stringify(ev.metadata) : null,
				})
				.onConflictDoNothing(),
			db.update(hackathons).set({ lastCheckedAt: nowDate }).where(eq(hackathons.id, exact.hackathonId)),
		]);
		return "updated";
	}

	// 3. New record. Title-only matches become review candidates, never automatic merges.
	const id = await createHackathon(db, ev.input, {
		ownerId: null,
		visibility: "public",
		internalStatus: "verified",
		lastVerifiedAt: nowDate,
		lastCheckedAt: nowDate,
		sourceUpdatedAt: ev.sourceUpdatedAt,
		source: {
			platformId,
			externalEventId: ev.externalId,
			sourceEventUrl: ev.input.canonicalUrl,
			sourceRegistrationUrl: ev.input.registrationUrl,
			sourceUpdatedAt: ev.sourceUpdatedAt,
			metadata: ev.metadata,
		},
	});
	await recordDuplicateCandidates(db, id, matches);
	return "added";
}

export async function syncProvider(db: Database, env: AppBindings, adapter: ProviderAdapter, opts: SyncOptions): Promise<SyncSummary> {
	const now = opts.now ?? Date.now();
	const nowDate = new Date(now);
	const fetcher = opts.fetcher ?? fetch;
	const config = adapter.getConfig(env);
	const base: SyncSummary = {
		platformId: adapter.platformId,
		status: "skipped",
		runId: null,
		fetched: 0,
		added: 0,
		updated: 0,
		unchanged: 0,
		skipped: 0,
		error: null,
	};

	if (!config.valid) {
		// Nothing is contacted. Record the honest status; no "successful" run is fabricated.
		const status: IntegrationStatus = config.mode === "manual" ? "manual_mode" : "setup_required";
		await db
			.update(platforms)
			.set({ integrationMode: config.mode, integrationStatus: status })
			.where(eq(platforms.id, adapter.platformId));
		if (opts.trigger === "admin") {
			await db.insert(syncRuns).values({
				platformId: adapter.platformId,
				trigger: opts.trigger,
				triggeredByUserId: opts.userId ?? null,
				status: "skipped",
				startedAt: nowDate,
				finishedAt: nowDate,
				errorMessage: config.problem ?? "Manual Mode: no authorized feed is configured, so nothing was fetched.",
			});
		}
		return { ...base, error: config.problem ?? "manual_mode" };
	}

	const [platform] = await db.select().from(platforms).where(eq(platforms.id, adapter.platformId));
	const runId = crypto.randomUUID();
	await db.batch([
		db.insert(syncRuns).values({
			id: runId,
			platformId: adapter.platformId,
			trigger: opts.trigger,
			triggeredByUserId: opts.userId ?? null,
			status: "running",
			startedAt: nowDate,
		}),
		db
			.update(platforms)
			.set({ integrationMode: "authorized_feed", lastAttemptedSyncAt: nowDate })
			.where(eq(platforms.id, adapter.platformId)),
	]);

	const summary: SyncSummary = { ...base, runId };
	const recordErrors: { externalEventId: string | null; reason: string }[] = [];
	let diagnostics: Record<string, unknown> = {};
	try {
		const result = await adapter.fetchEvents(config, {
			since: platform?.lastSuccessfulSyncAt ?? null,
			fetcher,
			maxPages: MAX_PAGES_PER_RUN,
		});
		diagnostics = { pagesFetched: result.pagesFetched, truncated: result.truncated, incremental: Boolean(platform?.lastSuccessfulSyncAt) };
		const records = result.records.slice(0, MAX_RECORDS_PER_RUN);
		summary.fetched = records.length;
		for (const raw of records) {
			const normalized = adapter.normalizeEvent(raw);
			if (!normalized.ok) {
				summary.skipped++;
				recordErrors.push({ externalEventId: normalized.externalId, reason: normalized.reason.slice(0, 500) });
				continue;
			}
			try {
				const outcome = await upsertProviderEvent(db, adapter.platformId, normalized.event, now);
				summary[outcome]++;
			} catch (err) {
				summary.skipped++;
				recordErrors.push({ externalEventId: normalized.event.externalId, reason: `Database write failed: ${safeErrorMessage(err)}` });
			}
		}
		summary.status = summary.skipped > 0 ? "partial" : "success";
		await db
			.update(platforms)
			.set({
				integrationStatus: "connected",
				lastSuccessfulSyncAt: nowDate,
				lastSyncError: summary.skipped > 0 ? `${summary.skipped} record(s) skipped — see failed imports` : null,
			})
			.where(eq(platforms.id, adapter.platformId));
	} catch (err) {
		const unavailable = err instanceof ProviderUnavailableError;
		summary.status = unavailable ? "unavailable" : "failed";
		summary.error = safeErrorMessage(err);
		await db
			.update(platforms)
			.set({ integrationStatus: unavailable ? "temporarily_unavailable" : "sync_failed", lastSyncError: summary.error })
			.where(eq(platforms.id, adapter.platformId));
		log("warn", "sync.failed", { platform: adapter.platformId, status: summary.status, error: summary.error });
	}

	await db
		.update(syncRuns)
		.set({
			status: summary.status,
			finishedAt: new Date(),
			recordsFetched: summary.fetched,
			recordsAdded: summary.added,
			recordsUpdated: summary.updated,
			recordsSkipped: summary.skipped,
			errorMessage: summary.error,
			diagnostics: JSON.stringify({ ...diagnostics, unchanged: summary.unchanged }),
		})
		.where(eq(syncRuns.id, runId));
	if (recordErrors.length) {
		await db.insert(syncRecordErrors).values(
			recordErrors.slice(0, 100).map((e) => ({ syncRunId: runId, platformId: adapter.platformId, ...e })),
		);
	}
	log("info", "sync.finished", { ...summary });
	return summary;
}

/** Cron entry point: only providers with a valid authorized feed AND auto-sync enabled are contacted. */
export async function runScheduledSync(db: Database, env: AppBindings, now: number, fetcher: typeof fetch = fetch) {
	const rows = await db.select().from(platforms);
	const results: SyncSummary[] = [];
	for (const adapter of Object.values(PROVIDERS)) {
		const config = adapter.getConfig(env);
		const row = rows.find((r) => r.id === adapter.platformId);
		if (!config.valid || !row?.autoSyncEnabled) {
			// Keep the stored status honest (e.g. a secret was removed) without contacting anyone.
			const status: IntegrationStatus = config.mode === "manual" ? "manual_mode" : config.valid ? (row?.integrationStatus as IntegrationStatus) : "setup_required";
			if (row && row.integrationStatus !== status) {
				await db.update(platforms).set({ integrationStatus: status, integrationMode: config.mode }).where(eq(platforms.id, adapter.platformId));
			}
			continue;
		}
		try {
			results.push(await syncProvider(db, env, adapter, { trigger: "cron", now, fetcher }));
		} catch (err) {
			// One provider's failure never blocks the others.
			log("error", "sync.unhandled", { platform: adapter.platformId, error: safeErrorMessage(err) });
		}
	}
	return results;
}

export function computeProviderStatus(config: ProviderConfig, row: typeof platforms.$inferSelect | undefined): ProviderStatus {
	if (config.mode === "manual") {
		return { status: "manual_mode", detail: "No authorized automated access is configured. Events are added manually or by CSV import." };
	}
	if (!config.valid) return { status: "setup_required", detail: config.problem ?? "Configuration incomplete." };
	if (!row?.lastAttemptedSyncAt) {
		return { status: "setup_required", detail: "Authorized feed configured. Waiting for the first sync to verify the connection." };
	}
	switch (row.integrationStatus) {
		case "connected":
			return { status: "connected", detail: "The most recent sync completed successfully." };
		case "temporarily_unavailable":
			return { status: "temporarily_unavailable", detail: "The provider did not respond or rate-limited the last sync. It will be retried on the next scheduled run." };
		default:
			return { status: "sync_failed", detail: "The last sync failed. Check the error and sync logs." };
	}
}

export async function getSourceStatuses(db: Database, env: AppBindings): Promise<SourceStatusReport[]> {
	const rows = await db.select().from(platforms);
	const counts = await db.all<{ platformId: string; n: number }>(
		// Public, non-demo records only — private user events are never counted here.
		sql`SELECT s.platform_id AS platformId, count(DISTINCT s.hackathon_id) AS n
			FROM ${hackathonSources} s JOIN ${hackathons} h ON h.id = s.hackathon_id
			WHERE h.visibility = 'public' AND h.is_demo = 0
			GROUP BY s.platform_id`,
	);
	const reports: SourceStatusReport[] = [];
	for (const adapter of Object.values(PROVIDERS)) {
		const config = adapter.getConfig(env);
		const row = rows.find((r) => r.id === adapter.platformId);
		const status = computeProviderStatus(config, row);
		const [lastRun] = await db
			.select()
			.from(syncRuns)
			.where(and(eq(syncRuns.platformId, adapter.platformId), sql`${syncRuns.status} != 'skipped'`))
			.orderBy(desc(syncRuns.startedAt))
			.limit(1);
		reports.push({
			platform: adapter.platformId,
			name: adapter.displayName,
			homepageUrl: adapter.homepageUrl,
			integrationMode: config.mode,
			integrationMethod:
				config.mode === "manual" ? "Manual entry and CSV import" : "Authorized feed (HackRadar Feed v1)",
			status: status.status,
			statusDetail: status.detail,
			policySummary: adapter.policySummary,
			manualWorkflow: adapter.manualWorkflow,
			autoSyncConfigured: config.valid && Boolean(row?.autoSyncEnabled),
			autoSyncEnabled: Boolean(row?.autoSyncEnabled),
			lastAttemptedSyncAt: toIso(row?.lastAttemptedSyncAt),
			lastSuccessfulSyncAt: toIso(row?.lastSuccessfulSyncAt),
			lastError: config.mode === "manual" ? null : (row?.lastSyncError ?? null),
			lastRun: lastRun
				? {
						added: lastRun.recordsAdded,
						updated: lastRun.recordsUpdated,
						skipped: lastRun.recordsSkipped,
						status: lastRun.status,
						finishedAt: toIso(lastRun.finishedAt),
					}
				: null,
			eventCount: Number(counts.find((c) => c.platformId === adapter.platformId)?.n ?? 0),
		});
	}
	return reports;
}
