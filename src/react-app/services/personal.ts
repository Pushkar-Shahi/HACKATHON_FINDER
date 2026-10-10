// Tracker, bookmarks, collections, milestones, notifications, profile.
import { api, apiData, downloadFile } from "@/lib/api";
import type {
	ActivityItem,
	BookmarkRecord,
	CalendarEntry,
	CollectionRecord,
	DashboardStats,
	MilestoneRecord,
	NotificationPreferences,
	NotificationRecord,
	PaginationMeta,
	Profile,
	Recommendation,
	TrackingRecord,
} from "@shared/types";
import type { Priority, TrackingStatus } from "@shared/constants";

// ---- tracker ----
export const listTracking = (query: { status?: string[]; q?: string; sort?: string }) => apiData<TrackingRecord[]>("/api/me/tracking", { query });
export const addTracking = (body: { hackathonId: string; status?: TrackingStatus; priority?: Priority }) =>
	apiData<{ id: string }>("/api/me/tracking", { method: "POST", json: body });
export const updateTracking = (id: string, body: Partial<{ status: TrackingStatus; priority: Priority; personalNotes: string | null; teamName: string | null }>) =>
	apiData<{ id: string }>(`/api/me/tracking/${id}`, { method: "PATCH", json: body });
export const removeTracking = (id: string) => apiData<{ deleted: boolean }>(`/api/me/tracking/${id}`, { method: "DELETE" });

// ---- bookmarks & collections ----
export const listBookmarks = (query: { collectionId?: string; sort?: string }) => apiData<BookmarkRecord[]>("/api/me/bookmarks", { query });
export const addBookmark = (hackathonId: string, collectionId?: string) =>
	apiData<{ id: string }>("/api/me/bookmarks", { method: "POST", json: { hackathonId, collectionId } });
export const updateBookmark = (id: string, note: string | null) => apiData<{ id: string }>(`/api/me/bookmarks/${id}`, { method: "PATCH", json: { note } });
export const removeBookmark = (id: string) => apiData<{ deleted: boolean }>(`/api/me/bookmarks/${id}`, { method: "DELETE" });
export const listCollections = () => apiData<CollectionRecord[]>("/api/me/collections");
export const createCollection = (name: string, description: string | null = null) =>
	apiData<CollectionRecord>("/api/me/collections", { method: "POST", json: { name, description } });
export const updateCollection = (id: string, body: { name?: string; description?: string | null }) =>
	apiData<CollectionRecord>(`/api/me/collections/${id}`, { method: "PATCH", json: body });
export const deleteCollection = (id: string) => apiData<{ deleted: boolean }>(`/api/me/collections/${id}`, { method: "DELETE" });
export const addToCollection = (collectionId: string, hackathonId: string) =>
	apiData<unknown>(`/api/me/collections/${collectionId}/items`, { method: "POST", json: { hackathonId } });
export const removeFromCollection = (collectionId: string, hackathonId: string) =>
	apiData<unknown>(`/api/me/collections/${collectionId}/items/${hackathonId}`, { method: "DELETE" });
export const moveBetweenCollections = (hackathonId: string, fromCollectionId: string | null, toCollectionId: string) =>
	apiData<unknown>("/api/me/collections/move", { method: "POST", json: { hackathonId, fromCollectionId, toCollectionId } });

// ---- calendar & milestones ----
export const listCalendar = (from: string, to: string, scope: "mine" | "all") => apiData<CalendarEntry[]>("/api/calendar", { query: { from, to, scope } });
export const exportCalendar = (entries: { hackathonId: string; kinds: string[] }[], milestoneIds: string[]) =>
	downloadFile("/api/calendar/export.ics", "hackradar-calendar.ics", { method: "POST", json: { entries, milestoneIds } });
export const listMilestones = (hackathonId?: string) => apiData<MilestoneRecord[]>("/api/me/milestones", { query: { hackathonId } });
export const createMilestone = (body: { title: string; dueAt: string; hackathonId?: string | null; notes?: string | null }) =>
	apiData<MilestoneRecord>("/api/me/milestones", { method: "POST", json: body });
export const updateMilestone = (id: string, body: { title?: string; dueAt?: string; notes?: string | null; completed?: boolean }) =>
	apiData<MilestoneRecord>(`/api/me/milestones/${id}`, { method: "PATCH", json: body });
export const deleteMilestone = (id: string) => apiData<{ deleted: boolean }>(`/api/me/milestones/${id}`, { method: "DELETE" });

// ---- notifications ----
export const listNotifications = (query: { unread?: boolean; page?: number }) =>
	api<NotificationRecord[], PaginationMeta & { unreadCount: number }>("/api/me/notifications", { query: { unread: query.unread ? "true" : undefined, page: query.page } });
export const unreadCount = () => apiData<{ unreadCount: number }>("/api/me/notifications/unread-count");
export const markNotification = (id: string, read: boolean) => apiData<unknown>(`/api/me/notifications/${id}`, { method: "PATCH", json: { read } });
export const markAllRead = () => apiData<{ updated: number }>("/api/me/notifications/read-all", { method: "POST", json: {} });
export const getPreferences = () => apiData<NotificationPreferences>("/api/me/preferences");
export const savePreferences = (body: Omit<NotificationPreferences, "emailConfigured">) =>
	apiData<NotificationPreferences>("/api/me/preferences", { method: "PATCH", json: body });

// ---- profile & dashboard ----
export const getMe = () => apiData<Profile | null>("/api/me");
export const updateProfile = (body: Partial<Omit<Profile, "userId" | "email" | "name" | "role" | "createdAt">>) =>
	apiData<Profile>("/api/me/profile", { method: "PATCH", json: body });
export const getStats = () => apiData<DashboardStats>("/api/dashboard/stats");
export const getRecommendations = () => api<Recommendation[], { needsPreferences: boolean }>("/api/me/recommendations");
export const getActivity = () => apiData<ActivityItem[]>("/api/me/activity");
export const deleteMyData = () => apiData<{ deleted: boolean }>("/api/me/data", { method: "DELETE", json: { confirm: "DELETE" } });
