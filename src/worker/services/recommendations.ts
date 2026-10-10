// Transparent, rule-based recommendations. Every point of score comes with a
// human-readable reason, and anything we could not verify becomes a caution
// rather than a claim (e.g. we never say "you are eligible").
import type { HackathonSummary, Recommendation } from "@shared/types";
import { PARTICIPATION_MODE_LABELS, TOPIC_LABELS, type ExperienceLevel, type PreferredMode, type TopicId } from "@shared/constants";
import { formatTimeRemaining, verificationState } from "@shared/status";

export interface RecommendationProfile {
	interests: TopicId[];
	preferredMode: PreferredMode;
	experienceLevel: ExperienceLevel | null;
	isStudent: boolean | null;
	country: string | null;
}

export function scoreRecommendation(h: HackathonSummary, p: RecommendationProfile, now: number): Omit<Recommendation, "hackathon"> | null {
	if (h.registrationStatus === "closed" || h.eventStatus === "completed" || h.eventStatus === "cancelled") return null;
	if (h.viewer?.tracking?.status === "not_participating") return null;
	if (p.isStudent === true && h.isStudentEligible === false) return null;

	let score = 0;
	let relevance = 0;
	const reasons: string[] = [];
	const cautions: string[] = [];

	const matched = h.topics.filter((t) => p.interests.includes(t));
	if (matched.length) {
		score += 3 * Math.min(matched.length, 2);
		relevance++;
		reasons.push(`Matches your interests: ${matched.map((t) => TOPIC_LABELS[t]).join(", ")}`);
	}

	if (p.preferredMode !== "any" && h.participationMode) {
		if (h.participationMode === p.preferredMode) {
			score += 2;
			relevance++;
			reasons.push(`Matches your ${PARTICIPATION_MODE_LABELS[h.participationMode].toLowerCase()} participation preference`);
		} else {
			score -= 1;
			cautions.push(`${PARTICIPATION_MODE_LABELS[h.participationMode]} event (you prefer ${PARTICIPATION_MODE_LABELS[p.preferredMode].toLowerCase()})`);
		}
	} else if (p.preferredMode !== "any" && !h.participationMode) {
		cautions.push("Participation format not stated");
	}

	if (h.registrationDeadlineAt) {
		const left = Date.parse(h.registrationDeadlineAt) - now;
		if (h.registrationStatus === "closing_soon") {
			score += 1;
			reasons.push(`Registration closes in ${formatTimeRemaining(left)}`);
		}
	} else if (h.registrationStatus === "unknown") {
		cautions.push("Registration deadline not verified");
	}
	if (h.registrationStatus === "opening_soon") reasons.push("Registration opens soon");

	if (p.experienceLevel === "beginner") {
		if (h.isBeginnerFriendly === true) {
			score += 1;
			reasons.push("Listed as beginner-friendly");
		} else if (h.isBeginnerFriendly === null) {
			cautions.push("Beginner-friendliness not stated");
		}
	}

	if (p.isStudent === true) {
		if (h.isStudentEligible === true) {
			score += 1;
			reasons.push("Listed as open to students — confirm the official rules");
		} else {
			cautions.push("Student eligibility not stated — check the official rules");
		}
	}

	if (h.isInternational === true) {
		reasons.push("Listed as open internationally");
	} else if (p.country && h.country && h.country.toLowerCase() !== p.country.toLowerCase()) {
		cautions.push(`Hosted in ${h.country}; international eligibility not stated`);
	}

	const v = verificationState(h.lastVerifiedAt ? Date.parse(h.lastVerifiedAt) : null, now);
	if (v === "unverified") cautions.push("Details not verified by HackRadar");
	else if (v === "stale") cautions.push("Details may be outdated");
	if (h.isDemo) cautions.push("Demo record — fictional sample data");

	// Only recommend when something about the user actually matched.
	if (relevance === 0) return null;
	return { score, reasons, cautions };
}

export function rankRecommendations(items: HackathonSummary[], p: RecommendationProfile, now: number, limit = 6): Recommendation[] {
	return items
		.map((h) => {
			const r = scoreRecommendation(h, p, now);
			return r ? { hackathon: h, ...r } : null;
		})
		.filter((r): r is Recommendation => r !== null)
		.sort((a, b) => b.score - a.score || (Date.parse(a.hackathon.registrationDeadlineAt ?? "9999") - Date.parse(b.hackathon.registrationDeadlineAt ?? "9999")))
		.slice(0, limit);
}
