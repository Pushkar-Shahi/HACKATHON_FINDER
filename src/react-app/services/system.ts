import { api, apiData } from "@/lib/api";
import type { AppConfig, HackathonDetail, HackathonSummary, SourceStatusReport } from "@shared/types";
import type { HackathonInputRaw } from "@shared/schemas";

export const getConfig = () => apiData<AppConfig>("/api/config");
export const getSources = () => apiData<SourceStatusReport[]>("/api/sources");

// ---- admin (all routes are authorized server-side) ----
export type AdminSource = SourceStatusReport & { config: { feedHost: string | null; hasToken: boolean; authorizationRef: string | null; problem: string | null } };
export interface SyncLog {
	id: string;
	platform: string;
	trigger: string;
	status: string;
	startedAt: string;
	finishedAt: string | null;
	fetched: number;
	added: number;
	updated: number;
	skipped: number;
	error: string | null;
}
export interface ImportFailure {
	id: string;
	platform: string;
	externalEventId: string | null;
	reason: string;
	runStartedAt: string;
	createdAt: string;
}
export interface DuplicatePair {
	id: string;
	confidence: string;
	reasons: string[];
	a: HackathonSummary;
	b: HackathonSummary;
	createdAt: string;
}
export type AdminOverview = Record<string, number>;

export const adminOverview = () => apiData<AdminOverview>("/api/admin/overview");
export const adminSources = () => apiData<AdminSource[]>("/api/admin/sources");
export const adminSync = (id: string) => apiData<{ status: string; added: number; updated: number; skipped: number; error: string | null }>(`/api/admin/sources/${id}/sync`, { method: "POST", json: {} });
export const adminSetAutoSync = (id: string, autoSyncEnabled: boolean) => apiData<unknown>(`/api/admin/sources/${id}`, { method: "PATCH", json: { autoSyncEnabled } });
export const adminSyncLogs = (page = 1) => apiData<SyncLog[]>("/api/admin/sync-logs", { query: { page } });
export const adminImportFailures = () => apiData<ImportFailure[]>("/api/admin/import-failures");
export const adminVerificationQueue = (page = 1) => api<{ hackathon: HackathonSummary; contradictions: string[] }[]>("/api/admin/verification-queue", { query: { page } });
export const adminGetHackathon = (id: string) => apiData<HackathonDetail>(`/api/admin/hackathons/${id}`);
export const adminUpdateHackathon = (id: string, event: HackathonInputRaw, markVerified: boolean) =>
	apiData<unknown>(`/api/admin/hackathons/${id}`, { method: "PUT", json: { event, markVerified } });
export const adminVerify = (id: string) => apiData<{ verified: boolean; contradictions: string[] }>(`/api/admin/hackathons/${id}/verify`, { method: "POST", json: {} });
export const adminDelete = (id: string) => apiData<unknown>(`/api/admin/hackathons/${id}`, { method: "DELETE" });
export const adminSubmissions = () => apiData<HackathonSummary[]>("/api/admin/submissions");
export const adminDecide = (id: string, approve: boolean, note: string | null) => apiData<unknown>(`/api/admin/submissions/${id}`, { method: "POST", json: { approve, note } });
export const adminDuplicates = () => apiData<DuplicatePair[]>("/api/admin/duplicates");
export const adminResolveDuplicate = (id: string, action: "merge" | "dismiss", keepId?: string) =>
	apiData<unknown>(`/api/admin/duplicates/${id}`, { method: "POST", json: { action, keepId } });
export const adminDemoCount = () => apiData<{ count: number }>("/api/admin/demo");
export const adminLoadDemo = () => apiData<{ created: number }>("/api/admin/demo", { method: "POST", json: {} });
export const adminRemoveDemo = () => apiData<{ removed: number }>("/api/admin/demo", { method: "DELETE" });
