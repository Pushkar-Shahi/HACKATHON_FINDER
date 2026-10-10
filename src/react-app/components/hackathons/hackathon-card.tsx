import { Link } from "react-router";
import { CalendarDays, Globe2, Lock, MapPin, Trophy, Users, Wallet } from "lucide-react";
import type { HackathonSummary } from "@shared/types";
import { PARTICIPATION_MODE_LABELS, TOPIC_LABELS } from "@shared/constants";
import { formatDateRange, formatFee, formatPrize, formatTeamSize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DemoBadge, EventStatusBadge, PlatformBadge, RegistrationBadge, VerificationLabel } from "./badges";
import { DeadlineCountdown, UrgencyLabel } from "./deadline";
import { BookmarkButton, OfficialLink, TrackerMenu } from "./actions";

function Meta({ icon: Icon, children, className }: { icon: typeof MapPin; children: React.ReactNode; className?: string }) {
	return (
		<span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
			<Icon className="size-3.5 shrink-0 text-muted-foreground" />
			<span className="truncate">{children}</span>
		</span>
	);
}

function TopicChips({ topics, max = 3 }: { topics: HackathonSummary["topics"]; max?: number }) {
	if (!topics.length) return null;
	return (
		<div className="flex flex-wrap gap-1">
			{topics.slice(0, max).map((t) => (
				<span key={t} className="rounded bg-secondary px-1.5 py-0.5 text-[11px] text-secondary-foreground">
					{TOPIC_LABELS[t]}
				</span>
			))}
			{topics.length > max && <span className="px-1 text-[11px] text-muted-foreground">+{topics.length - max}</span>}
		</div>
	);
}

function eligibilityLine(h: HackathonSummary): string | null {
	const parts: string[] = [];
	if (h.isStudentEligible === true) parts.push("Students eligible");
	if (h.isStudentEligible === false) parts.push("Not open to students");
	if (h.isBeginnerFriendly === true) parts.push("Beginner-friendly");
	if (h.isInternational === true) parts.push("Open internationally");
	if (h.isInternational === false) parts.push("Regional eligibility");
	if (parts.length) return parts.join(" · ");
	return h.eligibilitySummary;
}

export function HackathonCard({ h, now }: { h: HackathonSummary; now: number }) {
	const prize = formatPrize(h.prizeAmount, h.prizeCurrency);
	const team = formatTeamSize(h.teamSizeMin, h.teamSizeMax);
	const fee = formatFee(h.participationFeeAmount, h.participationFeeCurrency);
	const eligibility = eligibilityLine(h);
	return (
		<article className={cn("group @container flex flex-col rounded-lg border bg-card p-4 transition-colors hover:border-foreground/20", h.isDemo && "border-demo/25")}>
			<div className="mb-2 flex flex-wrap items-center gap-1.5">
				<PlatformBadge platform={h.platform} />
				<RegistrationBadge status={h.registrationStatus} />
				{h.eventStatus !== "upcoming" && <EventStatusBadge status={h.eventStatus} />}
				{h.isDemo && <DemoBadge />}
				{h.visibility === "private" && (
					<span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title="Only visible to you">
						<Lock className="size-3" /> Private
					</span>
				)}
			</div>

			<Link to={`/hackathons/${h.id}`} className="rounded outline-none focus-visible:ring-2 focus-visible:ring-ring">
				<h3 className="line-clamp-2 font-semibold leading-snug group-hover:text-primary">{h.title}</h3>
			</Link>
			{h.organizer && <p className="mt-0.5 truncate text-sm text-muted-foreground">by {h.organizer}</p>}
			{h.shortDescription && <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{h.shortDescription}</p>}

			<div className="mt-3 space-y-1.5">
				<div className="flex flex-wrap items-center gap-2">
					<DeadlineCountdown deadline={h.registrationDeadlineAt} now={now} compact />
					<UrgencyLabel deadline={h.registrationDeadlineAt} now={now} />
				</div>
				<div className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm @[22rem]:grid-cols-2">
					<Meta icon={CalendarDays}>{formatDateRange(h.eventStartAt, h.eventEndAt)}</Meta>
					<Meta icon={h.participationMode === "online" ? Globe2 : MapPin}>
						{h.participationMode ? PARTICIPATION_MODE_LABELS[h.participationMode] : "Format not stated"}
						{h.location && h.participationMode !== "online" ? ` · ${h.location}` : ""}
					</Meta>
					{prize && <Meta icon={Trophy}>{prize}</Meta>}
					{team && <Meta icon={Users}>{team}</Meta>}
					{fee && <Meta icon={Wallet}>{fee === "Free" ? "Free to enter" : `Fee ${fee}`}</Meta>}
				</div>
				{eligibility && <p className="line-clamp-1 text-xs text-muted-foreground">{eligibility}</p>}
			</div>

			<div className="mt-3">
				<TopicChips topics={h.topics} />
			</div>

			<div className="mt-auto pt-4">
				<div className="mb-3">
					<VerificationLabel lastVerifiedAt={h.lastVerifiedAt} isOwner={h.isOwner} now={now} />
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<BookmarkButton h={h} />
					<TrackerMenu h={h} />
					<div className="ml-auto">
						<OfficialLink url={h.registrationUrl ?? h.canonicalUrl} label="Official" />
					</div>
				</div>
			</div>
		</article>
	);
}

export function HackathonRow({ h, now }: { h: HackathonSummary; now: number }) {
	const prize = formatPrize(h.prizeAmount, h.prizeCurrency);
	return (
		<article className={cn("flex flex-col gap-2 rounded-lg border bg-card px-3 py-2.5 sm:flex-row sm:items-center sm:gap-4", h.isDemo && "border-demo/25")}>
			<div className="min-w-0 flex-1">
				<div className="flex flex-wrap items-center gap-1.5">
					<Link to={`/hackathons/${h.id}`} className="truncate font-medium hover:text-primary">
						{h.title}
					</Link>
					{h.isDemo && <DemoBadge />}
				</div>
				<div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
					<PlatformBadge platform={h.platform} />
					<RegistrationBadge status={h.registrationStatus} />
					<span>{h.participationMode ? PARTICIPATION_MODE_LABELS[h.participationMode] : "Format not stated"}</span>
					<span>{formatDateRange(h.eventStartAt, h.eventEndAt)}</span>
					{prize && <span>{prize}</span>}
				</div>
			</div>
			<div className="flex items-center gap-2 sm:w-[19rem] sm:justify-end">
				<div className="mr-auto sm:mr-0">
					<DeadlineCountdown deadline={h.registrationDeadlineAt} now={now} compact />
				</div>
				<BookmarkButton h={h} />
				<TrackerMenu h={h} />
			</div>
		</article>
	);
}
