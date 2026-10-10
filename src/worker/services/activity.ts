import type { Database } from "../db/client";
import { activityLog } from "../db/schema";

export type ActivityAction =
	| "bookmark_added"
	| "bookmark_removed"
	| "bookmark_note_updated"
	| "tracking_added"
	| "tracking_status_changed"
	| "tracking_priority_changed"
	| "tracking_notes_updated"
	| "tracking_removed"
	| "event_created"
	| "event_updated"
	| "event_deleted"
	| "events_imported"
	| "collection_created"
	| "publication_requested"
	| "milestone_created";

/** Returns an insert statement so callers can include it in their D1 batch. */
export function activityInsert(
	db: Database,
	userId: string,
	action: ActivityAction,
	hackathonId: string | null,
	details: Record<string, unknown> = {},
) {
	return db.insert(activityLog).values({ userId, action, hackathonId, details: JSON.stringify(details).slice(0, 2000) });
}
