import { QueryClient, type QueryClient as QC } from "@tanstack/react-query";
import { ApiError } from "./api";

export const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: 30_000,
			refetchOnWindowFocus: false,
			retry: (count, err) => {
				// Never retry auth/permission/validation failures.
				if (err instanceof ApiError && err.status >= 400 && err.status < 500) return false;
				return count < 2;
			},
		},
	},
});

/** Personal data changed — refresh everything derived from it. */
export function invalidatePersonal(qc: QC) {
	for (const key of ["hackathons", "hackathon", "tracking", "bookmarks", "collections", "stats", "activity", "recommendations", "calendar", "notifications", "unread-count", "milestones"]) {
		void qc.invalidateQueries({ queryKey: [key] });
	}
}
