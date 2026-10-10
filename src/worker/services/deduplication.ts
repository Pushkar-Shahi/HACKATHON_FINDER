// Duplicate detection. The same hackathon can legitimately appear on several
// platforms, so we look for matches — but we only treat two records as the
// same event automatically when a reliable key matches (provider event id or
// canonical URL). Title similarity alone is never enough to merge; it only
// produces a review candidate for administrators.
import { and, eq, inArray, or, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { runBatch } from "../db/queries/hackathons";
import {
	activityLog,
	bookmarks,
	collectionItems,
	duplicateCandidates,
	hackathonChanges,
	hackathonSources,
	hackathonTags,
	hackathons,
	milestones,
	notifications,
	userHackathonTracking,
} from "../db/schema";
import { DAY_MS } from "@shared/constants";

export type DuplicateConfidence = "exact" | "high" | "medium" | "low";

export interface DuplicateSubject {
	canonicalUrlKey: string;
	normalizedTitle: string;
	organizer: string | null;
	eventStartAt: number | null;
	registrationDeadlineAt: number | null;
}

export interface DuplicateMatch {
	hackathonId: string;
	title: string;
	confidence: DuplicateConfidence;
	reasons: string[];
}

const norm = (s: string | null) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** Pure scoring between two records. Returns null when they are not plausibly the same event. */
export function scoreDuplicate(a: DuplicateSubject, b: DuplicateSubject): { confidence: DuplicateConfidence; reasons: string[] } | null {
	if (a.canonicalUrlKey && a.canonicalUrlKey === b.canonicalUrlKey) {
		return { confidence: "exact", reasons: ["Same official event URL"] };
	}
	if (!a.normalizedTitle || a.normalizedTitle !== b.normalizedTitle) return null;
	const reasons = ["Same normalized title"];
	const sameOrganizer = norm(a.organizer) !== "" && norm(a.organizer) === norm(b.organizer);
	const startClose = a.eventStartAt !== null && b.eventStartAt !== null && Math.abs(a.eventStartAt - b.eventStartAt) <= DAY_MS;
	const deadlineClose =
		a.registrationDeadlineAt !== null && b.registrationDeadlineAt !== null && Math.abs(a.registrationDeadlineAt - b.registrationDeadlineAt) <= DAY_MS;
	if (sameOrganizer) reasons.push("Same organizer");
	if (startClose) reasons.push("Start dates within one day");
	if (deadlineClose) reasons.push("Deadlines within one day");
	const signals = Number(sameOrganizer) + Number(startClose) + Number(deadlineClose);
	const confidence: DuplicateConfidence = signals >= 2 ? "high" : signals === 1 ? "medium" : "low";
	return { confidence, reasons };
}

/**
 * Find likely duplicates of `subject` among records visible in `scope`:
 * public records plus (optionally) one user's private records.
 */
export async function findDuplicates(
	db: Database,
	subject: DuplicateSubject,
	scope: { userId: string | null; excludeId?: string },
): Promise<DuplicateMatch[]> {
	const visibility = scope.userId
		? or(eq(hackathons.visibility, "public"), eq(hackathons.createdByUserId, scope.userId))
		: eq(hackathons.visibility, "public");
	const rows = await db
		.select({
			id: hackathons.id,
			title: hackathons.title,
			canonicalUrlKey: hackathons.canonicalUrlKey,
			normalizedTitle: hackathons.normalizedTitle,
			organizer: hackathons.organizer,
			eventStartAt: hackathons.eventStartAt,
			registrationDeadlineAt: hackathons.registrationDeadlineAt,
		})
		.from(hackathons)
		.where(
			and(
				visibility,
				or(eq(hackathons.canonicalUrlKey, subject.canonicalUrlKey), eq(hackathons.normalizedTitle, subject.normalizedTitle)),
				scope.excludeId ? sql`${hackathons.id} != ${scope.excludeId}` : undefined,
			),
		)
		.limit(20);
	const order: Record<DuplicateConfidence, number> = { exact: 0, high: 1, medium: 2, low: 3 };
	return rows
		.map((r) => {
			const score = scoreDuplicate(subject, {
				canonicalUrlKey: r.canonicalUrlKey,
				normalizedTitle: r.normalizedTitle,
				organizer: r.organizer,
				eventStartAt: r.eventStartAt?.getTime() ?? null,
				registrationDeadlineAt: r.registrationDeadlineAt?.getTime() ?? null,
			});
			return score ? { hackathonId: r.id, title: r.title, ...score } : null;
		})
		.filter((m): m is DuplicateMatch => m !== null)
		.sort((a, b) => order[a.confidence] - order[b.confidence]);
}

/** Record review candidates (non-exact matches) for administrators. Idempotent. */
export async function recordDuplicateCandidates(db: Database, hackathonId: string, matches: DuplicateMatch[]) {
	const reviewable = matches.filter((m) => m.confidence !== "exact" && m.hackathonId !== hackathonId);
	if (reviewable.length === 0) return;
	await db
		.insert(duplicateCandidates)
		.values(
			reviewable.map((m) => ({
				hackathonId,
				candidateId: m.hackathonId,
				confidence: m.confidence,
				reasons: JSON.stringify(m.reasons),
			})),
		)
		.onConflictDoNothing();
}

/**
 * Merge `removeId` into `keepId` atomically (one D1 batch = one transaction).
 * Source attribution, tags, bookmarks, tracker records, collection membership,
 * milestones and notifications are re-pointed so existing user data stays valid.
 * When a user had both records, the surviving record keeps its data and any
 * notes from the removed record are appended rather than lost.
 */
export async function mergeHackathons(db: Database, keepId: string, removeId: string, resolvedByUserId: string) {
	if (keepId === removeId) throw new Error("Cannot merge a record into itself");
	const now = new Date();

	// Tracker notes: when a user tracked both records, append the removed record's notes.
	const [keepTracking, removeTracking] = await db.batch([
		db.select().from(userHackathonTracking).where(eq(userHackathonTracking.hackathonId, keepId)),
		db.select().from(userHackathonTracking).where(eq(userHackathonTracking.hackathonId, removeId)),
	]);
	const noteUpdates = removeTracking
		.map((old) => ({ old, keep: keepTracking.find((k) => k.userId === old.userId) }))
		.filter((p) => p.keep && p.old.personalNotes)
		.map(({ old, keep }) =>
			db
				.update(userHackathonTracking)
				.set({
					personalNotes: [keep!.personalNotes, `[Merged from duplicate] ${old.personalNotes}`].filter(Boolean).join("\n\n").slice(0, 10_000),
					updatedAt: now,
				})
				.where(eq(userHackathonTracking.id, keep!.id)),
		);

	const usersWithKeep = (table: typeof bookmarks | typeof userHackathonTracking) =>
		db.select({ u: table.userId }).from(table).where(eq(table.hackathonId, keepId));

	await runBatch(db, [
		...noteUpdates,
		db.update(hackathonSources).set({ hackathonId: keepId }).where(eq(hackathonSources.hackathonId, removeId)),
		db
			.insert(hackathonTags)
			.select(
				db
					.select({ hackathonId: sql<string>`${keepId}`.as("hackathon_id"), tagId: hackathonTags.tagId })
					.from(hackathonTags)
					.where(eq(hackathonTags.hackathonId, removeId)),
			)
			.onConflictDoNothing(),
		// Re-point user rows; where the user already has a row on the kept record, drop the duplicate.
		db.delete(bookmarks).where(and(eq(bookmarks.hackathonId, removeId), inArray(bookmarks.userId, usersWithKeep(bookmarks)))),
		db.update(bookmarks).set({ hackathonId: keepId }).where(eq(bookmarks.hackathonId, removeId)),
		db
			.delete(userHackathonTracking)
			.where(and(eq(userHackathonTracking.hackathonId, removeId), inArray(userHackathonTracking.userId, usersWithKeep(userHackathonTracking)))),
		db.update(userHackathonTracking).set({ hackathonId: keepId }).where(eq(userHackathonTracking.hackathonId, removeId)),
		db
			.delete(collectionItems)
			.where(
				and(
					eq(collectionItems.hackathonId, removeId),
					inArray(
						collectionItems.collectionId,
						db.select({ c: collectionItems.collectionId }).from(collectionItems).where(eq(collectionItems.hackathonId, keepId)),
					),
				),
			),
		db.update(collectionItems).set({ hackathonId: keepId }).where(eq(collectionItems.hackathonId, removeId)),
		db.update(milestones).set({ hackathonId: keepId }).where(eq(milestones.hackathonId, removeId)),
		db.update(notifications).set({ hackathonId: keepId }).where(eq(notifications.hackathonId, removeId)),
		db.update(activityLog).set({ hackathonId: keepId }).where(eq(activityLog.hackathonId, removeId)),
		db.update(hackathonChanges).set({ hackathonId: keepId }).where(eq(hackathonChanges.hackathonId, removeId)),
		db
			.update(duplicateCandidates)
			.set({ status: "merged", resolvedAt: now, resolvedByUserId })
			.where(
				and(
					eq(duplicateCandidates.status, "open"),
					or(inArray(duplicateCandidates.hackathonId, [keepId, removeId]), inArray(duplicateCandidates.candidateId, [keepId, removeId])),
				),
			),
		db.delete(hackathons).where(eq(hackathons.id, removeId)),
	]);
}
