import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, CalendarPlus, ExternalLink, Lock, Pencil, Send, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ErrorState } from "@/components/common/states";
import { DemoBadge, EventStatusBadge, PlatformBadge, RegistrationBadge, VerificationLabel } from "@/components/hackathons/badges";
import { DeadlineCountdown, UrgencyLabel } from "@/components/hackathons/deadline";
import { BookmarkButton, OfficialLink, TrackerMenu } from "@/components/hackathons/actions";
import { MilestoneList } from "@/components/calendar/milestones";
import { deleteEvent, downloadEventIcs, getHackathon, requestPublication, withdrawPublication } from "@/services/hackathons";
import { addTracking, updateBookmark } from "@/services/personal";
import { useTrackingUpdate } from "@/hooks/use-hackathon-actions";
import { useMe } from "@/hooks/use-me";
import { useNow } from "@/hooks/use-utils";
import { errorMessage } from "@/lib/api";
import { invalidatePersonal } from "@/lib/query-client";
import { formatDateTime, formatFee, formatPrize, formatRelative, formatTeamSize, localTimeZone } from "@/lib/format";
import type { HackathonDetail } from "@shared/types";
import { PARTICIPATION_MODE_LABELS, PLATFORM_LABELS, PRIORITIES, PRIORITY_LABELS, TOPIC_LABELS, type Priority } from "@shared/constants";

function Section({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
	return (
		<section id={id} className="rounded-lg border bg-card p-4">
			<h2 className="mb-3 text-sm font-semibold">{title}</h2>
			{children}
		</section>
	);
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="grid grid-cols-[9rem_1fr] gap-3 py-1.5 text-sm">
			<dt className="text-muted-foreground">{label}</dt>
			<dd className="min-w-0">{children}</dd>
		</div>
	);
}

const NOT_STATED = <span className="text-muted-foreground">Not stated</span>;

function triState(v: boolean | null, yes: string, no: string) {
	return v === null ? NOT_STATED : v ? yes : no;
}

function DateRow({ label, iso, tz, now, deadline }: { label: string; iso: string | null; tz: string | null; now: number; deadline?: boolean }) {
	return (
		<div className="flex flex-col gap-0.5 border-b py-2.5 last:border-0 sm:flex-row sm:items-baseline sm:justify-between">
			<span className="text-sm text-muted-foreground">{label}</span>
			{iso ? (
				<span className="text-right text-sm">
					<span className="font-medium">{formatDateTime(iso)}</span>
					<span className="ml-2 text-xs text-muted-foreground">{formatRelative(iso, now)}</span>
					{tz && formatDateTime(iso, { timeZone: tz }) !== formatDateTime(iso) && <span className="block text-xs text-muted-foreground">{formatDateTime(iso, { timeZone: tz })} event time</span>}
					{deadline && (
						<span className="mt-1 block">
							<UrgencyLabel deadline={iso} now={now} />
						</span>
					)}
				</span>
			) : (
				<span className="text-sm text-muted-foreground">Not announced / not verified</span>
			)}
		</div>
	);
}

function PersonalPanel({ h }: { h: HackathonDetail }) {
	const qc = useQueryClient();
	const tracking = h.viewer?.tracking;
	const update = useTrackingUpdate();
	const [notes, setNotes] = useState(h.viewerDetail?.personalNotes ?? "");
	const [team, setTeam] = useState(h.viewerDetail?.teamName ?? "");
	const [bmNote, setBmNote] = useState(h.viewerDetail?.bookmarkNote ?? "");

	const startTracking = useMutation({
		mutationFn: () => addTracking({ hackathonId: h.id, status: "interested" }),
		onSuccess: () => {
			toast.success("Added to your tracker");
			invalidatePersonal(qc);
		},
		onError: (e) => toast.error(errorMessage(e)),
	});
	const saveBmNote = useMutation({
		mutationFn: () => updateBookmark(h.viewer!.bookmarkId!, bmNote.trim() || null),
		onSuccess: () => {
			toast.success("Note saved");
			invalidatePersonal(qc);
		},
		onError: (e) => toast.error(errorMessage(e)),
	});

	return (
		<Section title="Your tracking">
			<div className="flex flex-wrap gap-2">
				<BookmarkButton h={h} withLabel />
				<TrackerMenu h={h} />
			</div>
			{tracking ? (
				<form
					className="mt-4 space-y-3"
					onSubmit={(e) => {
						e.preventDefault();
						update.mutate({ id: tracking.id, personalNotes: notes.trim() || null, teamName: team.trim() || null });
					}}
				>
					<div className="grid grid-cols-2 gap-2">
						<div>
							<Label htmlFor="priority" className="text-xs">
								Priority
							</Label>
							<Select value={tracking.priority} onValueChange={(v) => update.mutate({ id: tracking.id, priority: v as Priority })}>
								<SelectTrigger id="priority" size="sm" className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{PRIORITIES.map((p) => (
										<SelectItem key={p} value={p}>
											{PRIORITY_LABELS[p]}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div>
							<Label htmlFor="team" className="text-xs">
								Team name
							</Label>
							<Input id="team" value={team} onChange={(e) => setTeam(e.target.value)} maxLength={100} placeholder="Optional" className="h-8" />
						</div>
					</div>
					<div>
						<Label htmlFor="notes" className="text-xs">
							Private notes
						</Label>
						<Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={10000} rows={4} placeholder="Ideas, requirements, teammates… only you can see this." />
					</div>
					<Button size="sm" type="submit" disabled={update.isPending}>
						Save notes
					</Button>
				</form>
			) : (
				<p className="mt-3 text-sm text-muted-foreground">
					Add this event to your tracker to keep private notes, a team name and a priority.{" "}
					<Button variant="link" size="sm" className="h-auto px-0" onClick={() => startTracking.mutate()} disabled={startTracking.isPending}>
						Start tracking
					</Button>
				</p>
			)}
			{h.viewer?.bookmarkId && (
				<div className="mt-4 border-t pt-3">
					<Label htmlFor="bmnote" className="text-xs">
						Saved-list note
					</Label>
					<div className="mt-1 flex gap-2">
						<Input id="bmnote" value={bmNote} onChange={(e) => setBmNote(e.target.value)} maxLength={2000} placeholder="Why you saved it" className="h-8" />
						<Button size="sm" variant="outline" onClick={() => saveBmNote.mutate()} disabled={saveBmNote.isPending}>
							Save
						</Button>
					</div>
				</div>
			)}
			<div className="mt-4 border-t pt-3">
				<h3 className="mb-2 text-xs font-semibold text-muted-foreground uppercase">Preparation milestones</h3>
				<MilestoneList hackathonId={h.id} />
			</div>
		</Section>
	);
}

function OwnerActions({ h }: { h: HackathonDetail }) {
	const qc = useQueryClient();
	const navigate = useNavigate();
	const [note, setNote] = useState("");
	const [open, setOpen] = useState(false);
	const del = useMutation({
		mutationFn: () => deleteEvent(h.id),
		onSuccess: () => {
			toast.success("Event deleted");
			invalidatePersonal(qc);
			navigate("/my-events");
		},
		onError: (e) => toast.error(errorMessage(e)),
	});
	const publish = useMutation({
		mutationFn: () => requestPublication(h.id, note.trim() || null),
		onSuccess: () => {
			toast.success("Submitted for review");
			setOpen(false);
			void qc.invalidateQueries({ queryKey: ["hackathon", h.id] });
		},
		onError: (e) => toast.error(errorMessage(e)),
	});
	const withdraw = useMutation({
		mutationFn: () => withdrawPublication(h.id),
		onSuccess: () => {
			toast.success("Publication request withdrawn");
			void qc.invalidateQueries({ queryKey: ["hackathon", h.id] });
		},
		onError: (e) => toast.error(errorMessage(e)),
	});
	if (!h.isOwner) return null;
	if (h.visibility === "public") {
		return <p className="text-xs text-muted-foreground">Published in the shared feed — only administrators can edit it now.</p>;
	}
	return (
		<div className="flex flex-wrap items-center gap-2">
			<span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
				<Lock className="size-3" /> Private to you
			</span>
			<Button asChild size="sm" variant="outline">
				<Link to={`/events/${h.id}/edit`}>
					<Pencil /> Edit
				</Link>
			</Button>
			{h.publicationStatus === "pending" ? (
				<Button size="sm" variant="outline" onClick={() => withdraw.mutate()} disabled={withdraw.isPending}>
					<Undo2 /> Withdraw publication request
				</Button>
			) : (
				<Dialog open={open} onOpenChange={setOpen}>
					<DialogTrigger asChild>
						<Button size="sm" variant="outline">
							<Send /> {h.publicationStatus === "rejected" ? "Resubmit for publication" : "Submit for publication"}
						</Button>
					</DialogTrigger>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>Share with everyone?</DialogTitle>
							<DialogDescription>
								An administrator will review this event before it appears in the shared feed. Once published, only administrators can edit it.
							</DialogDescription>
						</DialogHeader>
						<Label htmlFor="pubnote">Note for reviewers (optional)</Label>
						<Textarea id="pubnote" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="e.g. Confirmed on the organizer's site on Oct 10" />
						<DialogFooter>
							<Button onClick={() => publish.mutate()} disabled={publish.isPending}>
								Submit for review
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			)}
			<AlertDialog>
				<AlertDialogTrigger asChild>
					<Button size="sm" variant="ghost" className="text-destructive">
						<Trash2 /> Delete
					</Button>
				</AlertDialogTrigger>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete “{h.title}”?</AlertDialogTitle>
						<AlertDialogDescription>This permanently removes the event along with its tracker entry, saved status and milestones.</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction onClick={() => del.mutate()} className="bg-destructive text-white hover:bg-destructive/90">
							Delete event
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
			{h.publicationStatus === "pending" && <span className="text-xs text-info">Awaiting review</span>}
			{h.publicationStatus === "rejected" && <span className="text-xs text-urgent">Not approved{h.reviewNote ? `: ${h.reviewNote}` : ""}</span>}
		</div>
	);
}

export function HackathonDetailPage() {
	const { id = "" } = useParams();
	const { user } = useMe();
	const now = useNow();
	const q = useQuery({ queryKey: ["hackathon", id], queryFn: () => getHackathon(id) });
	const ics = useMutation({
		mutationFn: (kinds?: string[]) => downloadEventIcs(id, q.data?.title ?? "hackathon", kinds),
		onError: (e) => toast.error(errorMessage(e)),
	});

	if (q.isLoading) {
		return (
			<div className="space-y-4">
				<Skeleton className="h-8 w-2/3" />
				<Skeleton className="h-40" />
				<Skeleton className="h-64" />
			</div>
		);
	}
	if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
	const h = q.data!;
	const prize = formatPrize(h.prizeAmount, h.prizeCurrency);
	const fee = formatFee(h.participationFeeAmount, h.participationFeeCurrency);
	const team = formatTeamSize(h.teamSizeMin, h.teamSizeMax);
	const hasDates = Boolean(h.registrationOpenAt || h.registrationDeadlineAt || h.eventStartAt);

	return (
		<div>
			<Button asChild variant="ghost" size="sm" className="mb-3 -ml-2">
				<Link to="/discover">
					<ArrowLeft /> Discover
				</Link>
			</Button>

			{h.isDemo && (
				<div role="note" className="mb-4 rounded-md border border-demo/30 bg-demo-soft px-3 py-2 text-sm text-demo">
					This is a <strong>demo record</strong> — fictional sample data used to demonstrate HackRadar. It is not a real hackathon.
				</div>
			)}

			<header className="mb-6">
				<div className="mb-2 flex flex-wrap items-center gap-1.5">
					<PlatformBadge platform={h.platform} />
					<RegistrationBadge status={h.registrationStatus} />
					<EventStatusBadge status={h.eventStatus} />
					{h.isDemo && <DemoBadge />}
				</div>
				<h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{h.title}</h1>
				{h.organizer && <p className="mt-1 text-muted-foreground">by {h.organizer}</p>}
				<div className="mt-4 flex flex-wrap items-center gap-2">
					<OfficialLink url={h.canonicalUrl} label="Official event page" size="default" />
					{h.registrationUrl && h.registrationUrl !== h.canonicalUrl && <OfficialLink url={h.registrationUrl} label="Register on source" size="default" variant="outline" />}
					{hasDates && (
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button variant="outline" disabled={ics.isPending}>
									<CalendarPlus /> Add to calendar
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent>
								<DropdownMenuItem onSelect={() => ics.mutate(undefined)}>All dates (.ics)</DropdownMenuItem>
								{h.registrationDeadlineAt && <DropdownMenuItem onSelect={() => ics.mutate(["registration_deadline"])}>Registration deadline only</DropdownMenuItem>}
								{h.eventStartAt && <DropdownMenuItem onSelect={() => ics.mutate(["event"])}>Event dates only</DropdownMenuItem>}
							</DropdownMenuContent>
						</DropdownMenu>
					)}
				</div>
				<p className="mt-2 text-xs text-muted-foreground">Registration happens on the source platform. HackRadar never registers or submits on your behalf.</p>
				<div className="mt-3">
					<OwnerActions h={h} />
				</div>
			</header>

			<div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
				<div className="min-w-0 space-y-5">
					<Section title="Important dates">
						<div className="mb-2">
							<DeadlineCountdown deadline={h.registrationDeadlineAt} now={now} />
						</div>
						<DateRow label="Registration opens" iso={h.registrationOpenAt} tz={h.eventTimezone} now={now} />
						<DateRow label="Registration deadline" iso={h.registrationDeadlineAt} tz={h.eventTimezone} now={now} deadline />
						<DateRow label="Event starts" iso={h.eventStartAt} tz={h.eventTimezone} now={now} />
						<DateRow label="Event ends" iso={h.eventEndAt} tz={h.eventTimezone} now={now} />
						<p className="mt-2 text-xs text-muted-foreground">
							Times shown in your timezone ({localTimeZone}).{" "}
							{h.eventTimezone ? `Event timezone: ${h.eventTimezone}.` : "The event's own timezone was not provided."}
						</p>
					</Section>

					<Section title="Overview">
						{h.description ? <p className="text-sm whitespace-pre-wrap">{h.description}</p> : <p className="text-sm text-muted-foreground">No description provided.</p>}
					</Section>

					<Section title="Eligibility">
						<dl>
							<Fact label="Summary">{h.eligibilitySummary ?? NOT_STATED}</Fact>
							<Fact label="Students">{triState(h.isStudentEligible, "Open to students (as listed)", "Not open to students")}</Fact>
							<Fact label="Beginners">{triState(h.isBeginnerFriendly, "Listed as beginner-friendly", "Not aimed at beginners")}</Fact>
							<Fact label="International">{triState(h.isInternational, "Open internationally (as listed)", "Regional eligibility")}</Fact>
						</dl>
						{h.eligibilityDetails && <p className="mt-3 text-sm whitespace-pre-wrap">{h.eligibilityDetails}</p>}
						<p className="mt-3 text-xs text-muted-foreground">Always confirm eligibility in the official rules — HackRadar does not verify individual eligibility.</p>
					</Section>

					<Section title="Registration">
						<p className="text-sm">
							Register directly on {PLATFORM_LABELS[h.platform] === "Other / direct" ? "the organizer's site" : PLATFORM_LABELS[h.platform]}:{" "}
							<a href={h.registrationUrl ?? h.canonicalUrl} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-primary underline-offset-4 hover:underline">
								{h.registrationUrl ?? h.canonicalUrl}
							</a>
						</p>
						{fee && <p className="mt-2 text-sm">Participation fee: {fee}</p>}
						{h.additionalNotes && <p className="mt-2 text-sm whitespace-pre-wrap text-muted-foreground">{h.additionalNotes}</p>}
					</Section>

					<div className="grid gap-5 md:grid-cols-2">
						<Section title="Team requirements">
							<p className="text-sm">{team ?? <span className="text-muted-foreground">Team size not stated</span>}</p>
						</Section>
						<Section title="Location & format">
							<dl>
								<Fact label="Format">{h.participationMode ? PARTICIPATION_MODE_LABELS[h.participationMode] : NOT_STATED}</Fact>
								<Fact label="Location">{h.location ?? NOT_STATED}</Fact>
								<Fact label="Country">{h.country ?? NOT_STATED}</Fact>
							</dl>
						</Section>
					</div>

					<Section title="Topics & technologies">
						{h.topics.length + h.technologies.length === 0 ? (
							<p className="text-sm text-muted-foreground">None listed.</p>
						) : (
							<div className="flex flex-wrap gap-1.5">
								{h.topics.map((t) => (
									<Link key={t} to={`/discover?topics=${t}`} className="rounded bg-secondary px-2 py-0.5 text-xs hover:bg-accent">
										{TOPIC_LABELS[t]}
									</Link>
								))}
								{h.technologies.map((t) => (
									<span key={t} className="rounded border px-2 py-0.5 text-xs text-muted-foreground">
										{t}
									</span>
								))}
							</div>
						)}
					</Section>

					<Section title="Rewards & benefits">
						<p className="text-sm">{prize ? <span className="text-lg font-semibold">{prize}</span> : <span className="text-muted-foreground">Prize not stated</span>}</p>
						{h.prizeDetails && <p className="mt-2 text-sm whitespace-pre-wrap">{h.prizeDetails}</p>}
					</Section>
				</div>

				<div className="space-y-5">
					{user ? (
						<PersonalPanel key={`${h.viewerDetail?.personalNotes ?? ""}|${h.viewerDetail?.teamName ?? ""}|${h.viewerDetail?.bookmarkNote ?? ""}`} h={h} />
					) : (
						<Section title="Your tracking">
							<p className="text-sm text-muted-foreground">Sign in to save this event, track your participation and keep private notes.</p>
							<Button asChild size="sm" className="mt-3">
								<Link to={`/login?next=/hackathons/${h.id}`}>Sign in</Link>
							</Button>
						</Section>
					)}

					<Section title="Verification">
						<VerificationLabel lastVerifiedAt={h.lastVerifiedAt} isOwner={h.isOwner} now={now} />
						<dl className="mt-2">
							<Fact label="Data quality">{h.dataQuality === "verified" ? "Verified" : h.dataQuality === "needs_review" ? "Needs review" : "Unverified"}</Fact>
							<Fact label="Last checked">{h.lastCheckedAt ? formatRelative(h.lastCheckedAt, now) : "Never"}</Fact>
						</dl>
						{h.contradictions.length > 0 && (
							<div className="mt-3 rounded-md border border-warning/30 bg-warning-soft p-2 text-xs text-warning">
								<p className="flex items-center gap-1 font-medium">
									<AlertTriangle className="size-3.5" /> Inconsistencies found
								</p>
								<ul className="mt-1 list-disc pl-4">
									{h.contradictions.map((c) => (
										<li key={c}>{c}</li>
									))}
								</ul>
							</div>
						)}
						<p className="mt-3 text-xs text-muted-foreground">Registration status is HackRadar's estimate from these dates, not confirmation from the platform.</p>
					</Section>

					<Section title="Sources">
						<ul className="space-y-2 text-sm">
							{h.sources.map((s) => (
								<li key={s.id} className="flex items-start justify-between gap-2">
									<div className="min-w-0">
										<PlatformBadge platform={s.platform} />
										<a href={s.sourceEventUrl} target="_blank" rel="noopener noreferrer nofollow" className="mt-1 block truncate text-xs text-primary hover:underline">
											{s.sourceEventUrl}
										</a>
										<span className="text-[11px] text-muted-foreground">Checked {s.lastCheckedAt ? formatRelative(s.lastCheckedAt, now) : "never"}</span>
									</div>
									<a href={s.sourceEventUrl} target="_blank" rel="noopener noreferrer nofollow" aria-label="Open source" className="text-muted-foreground hover:text-foreground">
										<ExternalLink className="size-4" />
									</a>
								</li>
							))}
						</ul>
					</Section>
				</div>
			</div>
		</div>
	);
}
