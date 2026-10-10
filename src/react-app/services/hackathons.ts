import { api, apiData, downloadFile, type QueryValue } from "@/lib/api";
import type { CsvImportResult, CsvPreview, HackathonDetail, HackathonSummary, PaginationMeta } from "@shared/types";
import type { HackathonInputRaw } from "@shared/schemas";

export type ListMeta = PaginationMeta & { generatedAt: string; prizeSortCurrency?: string };

export const listHackathons = (query: Record<string, QueryValue>, signal?: AbortSignal) =>
	api<HackathonSummary[], ListMeta>("/api/hackathons", { query, signal });

export const getHackathon = (id: string) => apiData<HackathonDetail>(`/api/hackathons/${id}`);

export const createEvent = (input: HackathonInputRaw) => apiData<HackathonDetail>("/api/me/events", { method: "POST", json: input });
export const updateEvent = (id: string, input: HackathonInputRaw) => apiData<HackathonDetail>(`/api/me/events/${id}`, { method: "PUT", json: input });
export const deleteEvent = (id: string) => apiData<{ deleted: boolean }>(`/api/me/events/${id}`, { method: "DELETE" });
export const requestPublication = (id: string, note: string | null) =>
	apiData<{ publicationStatus: string }>(`/api/me/events/${id}/publication`, { method: "POST", json: { note } });
export const withdrawPublication = (id: string) => apiData<{ publicationStatus: string }>(`/api/me/events/${id}/publication`, { method: "DELETE" });

export interface DuplicateMatch {
	hackathonId: string;
	title: string;
	confidence: "exact" | "high" | "medium" | "low";
	reasons: string[];
}
export const checkDuplicates = (body: { title: string; canonicalUrl: string; organizer?: string | null; eventStartAt?: string | null; registrationDeadlineAt?: string | null; excludeId?: string }) =>
	apiData<DuplicateMatch[]>("/api/hackathons/check-duplicates", { method: "POST", json: body });

export const previewCsv = (csv: string) => apiData<CsvPreview>("/api/me/events/import/preview", { method: "POST", json: { csv } });
export const importCsv = (csv: string, rows: number[]) => apiData<CsvImportResult>("/api/me/events/import", { method: "POST", json: { csv, rows } });
export const exportCsv = (scope: "mine" | "saved" | "tracked") =>
	downloadFile("/api/me/events/export.csv", `hackradar-${scope}-${new Date().toISOString().slice(0, 10)}.csv`, { query: { scope } });
export const downloadEventIcs = (id: string, title: string, kinds?: string[]) =>
	downloadFile(`/api/hackathons/${id}/calendar.ics`, `${title.replace(/[^\w-]+/g, "-").slice(0, 60) || "hackathon"}.ics`, { query: { kinds } });
