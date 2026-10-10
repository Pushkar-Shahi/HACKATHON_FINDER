import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Bookmark, CalendarClock, CheckCircle2, Clock, History, Lightbulb, PlayCircle, Radio, Sparkles } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { getActivity, getRecommendations } from "@/services/personal";
import { listHackathons } from "@/services/hackathons";
import type { DashboardStats, HackathonSummary } from "@shared/types";
import { PARTICIPATION_MODE_LABELS, TRACKING_STATUS_LABELS, type TrackingStatus } from "@shared/constants";
import { formatPrize, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DeadlineCountdown, UrgencyLabel } from "@/components/hackathons/deadline";
import { DemoBadge, PlatformBadge } from "@/components/hackathons/badges";
import { BookmarkButton, OfficialLink } from "@/components/hackathons/actions";
import { EmptyState, ErrorState } from "@/components/common/states";
import { HackathonRow } from "@/components/hackathons/hackathon-card";

export function StatCards({ stats, loading, signedIn }: { stats?: DashboardStats; loading: boolean; signedIn: boolean }) {
	const cards = [
		{ label: "Upcoming", value: stats?.upcoming, to: "/discover?status=upcoming", icon: CalendarClock },
		{ label: "Registration open", value: stats?.registrationOpen, to: "/discover?registration=open", icon: Radio },
		{ label: "Deadlines in 7 days", value: stats?.deadlinesNext7Days, to: "/discover?deadline=7d", icon: Clock },
		{ label: "Ongoing", value: stats?.ongoing, to: "/discover?status=ongoing", icon: PlayCircle },
		{ label: "Saved", value: stats?.saved, to: signedIn ? "/saved" : "/login?next=/saved", icon: Bookmark, personal: true },
		{ label: "Registered", value: stats?.registered, to: signedIn ? "/tracker?status=registered,preparing,submitted" : "/login?next=/tracker", icon: CheckCircle2, personal: true },
	];
	return (
		<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
			{cards.map((c) => (
				<Link key={c.label} to={c.to} className="group rounded-lg border bg-card px-3 py-2.5 transition-colors hover:border-foreground/20">
					<div className="flex items-center justify-between text-xs text-muted-foreground">
						{c.label}
						<c.icon className="size-3.5" />
					</div>
					<div className="mt-1 text-xl font-semibold tabular">
						{loading ? <Skeleton className="h-6 w-10" /> : c.personal && !signedIn ? <span className="text-sm font-normal text-muted-foreground">Sign in</span> : (c.value ?? 0).toLocaleString()}
					</div>
				</Link>
			))}
		</div>
	);
}

function ClosingItem({ h, now }: { h: HackathonSummary; now: number }) {
	const prize = formatPrize(h.prizeAmount, h.prizeCurrency);
	const eligibility = [h.isStudentEligible ? "Students eligible" : null, h.isBeginnerFriendly ? "Beginner-friendly" : null, h.eligibilitySummary].filter(Boolean)[0];
	return (
		<li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
			<div className="min-w-0 flex-1">
				<div className="flex flex-wrap items-center gap-1.5">
					<Link to={`/hackathons/${h.id}`} className="truncate font-medium hover:text-primary">
						{h.title}
					</Link>
					{h.isDemo && <DemoBadge />}
					<UrgencyLabel deadline={h.registrationDeadlineAt} now={now} />
				</div>
				<div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
					<PlatformBadge platform={h.platform} />
					<span>{h.participationMode ? PARTICIPATION_MODE_LABELS[h.participationMode] : "Format not stated"}</span>
					{prize && <span>Prize {prize}</span>}
					{eligibility && <span className="truncate">{eligibility}</span>}
				</div>
			</div>
			<div className="flex items-center gap-2">
				<DeadlineCountdown deadline={h.registrationDeadlineAt} now={now} />
				<BookmarkButton h={h} />
				<OfficialLink url={h.registrationUrl ?? h.canonicalUrl} label="Open" variant="outline" />
			</div>
		</li>
	);
}

export function ClosingSoon({ now }: { now: number }) {
	const q = useQuery({
		queryKey: ["hackathons", { dashboard: "closing", registration: "closing_soon" }],
		queryFn: () => listHackathons({ registration: "closing_soon", sort: "deadline", pageSize: 6 }),
	});
	return (
		<section className="rounded-lg border bg-card p-4">
			<div className="mb-1 flex items-center justify-between">
				<h2 className="font-semibold">Closing soon</h2>
				<Button asChild variant="ghost" size="sm">
					<Link to="/discover?registration=closing_soon">
						View all <ArrowRight />
					</Link>
				</Button>
			</div>
			<p className="text-xs text-muted-foreground">Registration deadlines in the next 7 days, earliest first.</p>
			{q.isLoading ? (
				<div className="mt-3 space-y-2">
					{[0, 1, 2].map((i) => (
						<Skeleton key={i} className="h-12" />
					))}
				</div>
			) : q.isError ? (
				<ErrorState error={q.error} onRetry={() => q.refetch()} className="mt-3 py-6" />
			) : q.data!.data.length === 0 ? (
				<p className="mt-4 rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">No verified deadlines in the next 7 days.</p>
			) : (
				<ul className="divide-y">
					{q.data!.data.map((h) => (
						<ClosingItem key={h.id} h={h} now={now} />
					))}
				</ul>
			)}
		</section>
	);
}

const QUICK_VIEWS = [
	{ key: "upcoming", label: "All upcoming", query: { status: "upcoming", sort: "start" }, link: "/discover?status=upcoming&sort=start" },
	{ key: "open", label: "Registration open", query: { registration: "open" }, link: "/discover?registration=open" },
	{ key: "aiml", label: "AI & ML", query: { topics: "ai,ml,genai,agentic_ai" }, link: "/discover?topics=ai,ml,genai,agentic_ai" },
	{ key: "data", label: "Data science", query: { topics: "data_science" }, link: "/discover?topics=data_science" },
	{ key: "online", label: "Online", query: { modes: "online" }, link: "/discover?modes=online" },
	{ key: "recent", label: "Recently added", query: { sort: "recent" }, link: "/discover?sort=recent" },
	{ key: "closing", label: "Closing soon", query: { registration: "closing_soon" }, link: "/discover?registration=closing_soon" },
] as const;

export function QuickViews({ now, active, onChange }: { now: number; active: string; onChange: (k: string) => void }) {
	const view = QUICK_VIEWS.find((v) => v.key === active) ?? QUICK_VIEWS[0];
	const q = useQuery({ queryKey: ["hackathons", { quick: view.key }], queryFn: () => listHackathons({ sort: "deadline", ...view.query, pageSize: 5 }) });
	return (
		<section className="rounded-lg border bg-card p-4">
			<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
				<h2 className="font-semibold">Upcoming opportunities</h2>
				<Button asChild variant="ghost" size="sm">
					<Link to={view.link}>
						View all <ArrowRight />
					</Link>
				</Button>
			</div>
			<div className="mb-3 flex flex-wrap gap-1.5" role="tablist" aria-label="Quick views">
				{QUICK_VIEWS.map((v) => (
					<button
						key={v.key}
						role="tab"
						aria-selected={v.key === view.key}
						onClick={() => onChange(v.key)}
						className={cn("rounded-full border px-2.5 py-1 text-xs transition-colors", v.key === view.key ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent")}
					>
						{v.label}
					</button>
				))}
			</div>
			{q.isLoading ? (
				<div className="space-y-2">
					{[0, 1, 2].map((i) => (
						<Skeleton key={i} className="h-14" />
					))}
				</div>
			) : q.isError ? (
				<ErrorState error={q.error} onRetry={() => q.refetch()} className="py-6" />
			) : q.data!.data.length === 0 ? (
				<p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">Nothing in this view yet.</p>
			) : (
				<div className="space-y-2">
					{q.data!.data.map((h) => (
						<HackathonRow key={h.id} h={h} now={now} />
					))}
				</div>
			)}
		</section>
	);
}

export function Recommendations({ now }: { now: number }) {
	const q = useQuery({ queryKey: ["recommendations"], queryFn: getRecommendations });
	return (
		<section className="rounded-lg border bg-card p-4">
			<h2 className="flex items-center gap-2 font-semibold">
				<Sparkles className="size-4 text-primary" /> Recommended for you
			</h2>
			<p className="mb-3 text-xs text-muted-foreground">Rule-based: your interests, preferred format and deadlines. Always check eligibility on the official page.</p>
			{q.isLoading ? (
				<Skeleton className="h-24" />
			) : q.isError ? (
				<ErrorState error={q.error} onRetry={() => q.refetch()} className="py-6" />
			) : q.data!.meta?.needsPreferences ? (
				<EmptyState
					className="py-6"
					icon={<Lightbulb />}
					title="Tell HackRadar what you're into"
					description="Pick interests and a participation preference to get explained recommendations."
					action={
						<Button asChild size="sm">
							<Link to="/settings">Set preferences</Link>
						</Button>
					}
				/>
			) : q.data!.data.length === 0 ? (
				<p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">No open or upcoming events match your preferences right now.</p>
			) : (
				<ul className="space-y-3">
					{q.data!.data.map((r) => (
						<li key={r.hackathon.id} className="rounded-md border p-3">
							<div className="flex flex-wrap items-center gap-1.5">
								<Link to={`/hackathons/${r.hackathon.id}`} className="font-medium hover:text-primary">
									{r.hackathon.title}
								</Link>
								{r.hackathon.isDemo && <DemoBadge />}
							</div>
							<p className="mt-1 text-sm text-muted-foreground">Recommended because {r.reasons.map((x) => x.charAt(0).toLowerCase() + x.slice(1)).join("; ")}.</p>
							{r.cautions.length > 0 && <p className="mt-1 text-xs text-warning">Check: {r.cautions.join(" · ")}</p>}
							<div className="mt-2">
								<DeadlineCountdown deadline={r.hackathon.registrationDeadlineAt} now={now} compact />
							</div>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}

function describeActivity(action: string, details: Record<string, unknown>): string {
	switch (action) {
		case "bookmark_added":
			return "Saved";
		case "bookmark_removed":
			return "Removed from saved";
		case "bookmark_note_updated":
			return "Updated saved note for";
		case "tracking_added":
			return "Added to tracker";
		case "tracking_status_changed":
			return `Changed status to ${TRACKING_STATUS_LABELS[details.to as TrackingStatus] ?? details.to} for`;
		case "tracking_priority_changed":
			return `Set priority ${String(details.to)} for`;
		case "tracking_notes_updated":
			return "Edited notes on";
		case "tracking_removed":
			return "Removed from tracker";
		case "event_created":
			return "Added event";
		case "event_updated":
			return "Edited event";
		case "event_deleted":
			return `Deleted event “${String(details.title ?? "")}”`;
		case "events_imported":
			return `Imported ${String(details.count)} events from CSV`;
		case "collection_created":
			return `Created collection “${String(details.name ?? "")}”`;
		case "publication_requested":
			return "Requested publication of";
		case "milestone_created":
			return `Added milestone “${String(details.title ?? "")}”`;
		default:
			return action.replace(/_/g, " ");
	}
}

export function RecentActivity() {
	const q = useQuery({ queryKey: ["activity"], queryFn: getActivity });
	return (
		<section className="rounded-lg border bg-card p-4">
			<h2 className="mb-3 flex items-center gap-2 font-semibold">
				<History className="size-4 text-muted-foreground" /> Recent activity
			</h2>
			{q.isLoading ? (
				<Skeleton className="h-24" />
			) : q.isError ? (
				<ErrorState error={q.error} onRetry={() => q.refetch()} className="py-6" />
			) : q.data!.length === 0 ? (
				<p className="text-sm text-muted-foreground">Your saves, tracker updates and notes will appear here.</p>
			) : (
				<ul className="space-y-2 text-sm">
					{q.data!.map((a) => (
						<li key={a.id} className="flex items-baseline justify-between gap-3">
							<span className="min-w-0">
								{describeActivity(a.action, a.details)}{" "}
								{a.hackathonId && a.hackathonTitle && (
									<Link to={`/hackathons/${a.hackathonId}`} className="font-medium hover:text-primary">
										{a.hackathonTitle}
									</Link>
								)}
							</span>
							<span className="shrink-0 text-xs text-muted-foreground">{formatRelative(a.createdAt)}</span>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
