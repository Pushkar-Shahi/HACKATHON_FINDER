// Mutations used from cards and detail pages. Success toasts are shown only
// after the server confirms the change.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useNavigate } from "react-router";
import { errorMessage } from "@/lib/api";
import { invalidatePersonal } from "@/lib/query-client";
import { addBookmark, addTracking, removeBookmark, removeTracking, updateTracking } from "@/services/personal";
import type { HackathonSummary } from "@shared/types";
import { TRACKING_STATUS_LABELS, type Priority, type TrackingStatus } from "@shared/constants";
import { useMe } from "./use-me";

export function useRequireSignIn() {
	const { user } = useMe();
	const navigate = useNavigate();
	return () => {
		if (user) return true;
		toast.info("Sign in to save and track hackathons");
		navigate(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
		return false;
	};
}

export function useBookmarkToggle() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async (h: Pick<HackathonSummary, "id" | "viewer">) => {
			if (h.viewer?.bookmarkId) {
				await removeBookmark(h.viewer.bookmarkId);
				return false;
			}
			await addBookmark(h.id);
			return true;
		},
		onSuccess: (saved) => {
			toast.success(saved ? "Saved" : "Removed from saved");
			invalidatePersonal(qc);
		},
		onError: (err) => toast.error(errorMessage(err)),
	});
}

export function useTrackingStatus() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: async ({ h, status }: { h: Pick<HackathonSummary, "id" | "viewer">; status: TrackingStatus | null }) => {
			const existing = h.viewer?.tracking;
			if (status === null) {
				if (existing) await removeTracking(existing.id);
				return null;
			}
			if (existing) await updateTracking(existing.id, { status });
			else await addTracking({ hackathonId: h.id, status });
			return status;
		},
		onSuccess: (status) => {
			toast.success(status ? `Tracker: ${TRACKING_STATUS_LABELS[status]}` : "Removed from tracker");
			invalidatePersonal(qc);
		},
		onError: (err) => toast.error(errorMessage(err)),
	});
}

export function useTrackingUpdate() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ id, ...body }: { id: string; status?: TrackingStatus; priority?: Priority; personalNotes?: string | null; teamName?: string | null }) =>
			updateTracking(id, body),
		onSuccess: () => {
			toast.success("Tracker updated");
			invalidatePersonal(qc);
		},
		onError: (err) => toast.error(errorMessage(err)),
	});
}
