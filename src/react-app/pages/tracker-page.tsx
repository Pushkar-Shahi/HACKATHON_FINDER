import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, ListChecks, NotebookPen, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CardGridSkeleton, EmptyState, ErrorState, PageHeader } from "@/components/common/states";
import { DemoBadge, PlatformBadge } from "@/components/hackathons/badges";
import { DeadlineCountdown } from "@/components/hackathons/deadline";
import { OfficialLink } from "@/components/hackathons/actions";
import { listTracking, removeTracking } from "@/services/personal";
import { exportCsv } from "@/services/hackathons";
import { useTrackingUpdate } from "@/hooks/use-hackathon-actions";
import { useDebouncedValue, useNow } from "@/hooks/use-utils";
import { errorMessage } from "@/lib/api";
import { invalidatePersonal } from "@/lib/query-client";
import { formatDateRange } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TrackingRecord } from "@shared/types";
import { PRIORITIES, PRIORITY_LABELS, TRACKING_STATUSES, TRACKING_STATUS_LABELS, type Priority, type TrackingStatus } from "@shared/constants";

function NotesDialog({ record, onClose }: { record: TrackingRecord; onClose: () => void }) {
	const update = useTrackingUpdate();
	const [notes, setNotes] = useState(record.personalNotes ?? "");
	const [team, setTeam] = useState(record.teamName ?? "");
	return (
		<Dialog open onOpenChange={(o) => !o && onClose()}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Notes · {record.hackathon.title}</DialogTitle>
					<DialogDescription>Private to you.</DialogDescription>
				</DialogHeader>
				<form
					className="space-y-3"
					onSubmit={(e) => {
						e.preventDefault();
						update.mutate({ id: record.id, personalNotes: notes.trim() || null, teamName: team.trim() || null }, { onSuccess: onClose });
					}}
				>
					<div>
						<Label htmlFor="t-team">Team name</Label>
						<Input id="t-team" value={team} onChange={(e) => setTeam(e.target.value)} maxLength={100} />
					</div>
					<div>
						<Label htmlFor="t-notes">Notes</Label>
						<Textarea id="t-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={6} maxLength={10000} />
					</div>
					<DialogFooter>
						<Button type="submit" disabled={update.isPending}>
							Save
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

export function TrackerPage() {
	const [params, setParams] = useSearchParams();
	const qc = useQueryClient();
	const now = useNow();
	const statuses = (params.get("status") ?? "").split(",").filter((s): s is TrackingStatus => (TRACKING_STATUSES as readonly string[]).includes(s));
	const sort = params.get("sort") ?? "deadline";
	const [search, setSearch] = useState(params.get("q") ?? "");
	const q = useDebouncedValue(search, 300);
	const [notesFor, setNotesFor] = useState<TrackingRecord | null>(null);
	const update = useTrackingUpdate();

	useEffect(() => {
		const p = new URLSearchParams(params);
		if (q) p.set("q", q);
		else p.delete("q");
		setParams(p, { replace: true });
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [q]);

	const query = useQuery({ queryKey: ["tracking", { statuses, q, sort }], queryFn: () => listTracking({ status: statuses, q: q || undefined, sort }) });
	const remove = useMutation({
		mutationFn: (id: string) => removeTracking(id),
		onSuccess: () => {
			toast.success("Removed from tracker");
			invalidatePersonal(qc);
		},
		onError: (e) => toast.error(errorMessage(e)),
	});
	const exportMut = useMutation({ mutationFn: () => exportCsv("tracked"), onError: (e) => toast.error(errorMessage(e)) });

	const setStatuses = (next: TrackingStatus[]) => {
		const p = new URLSearchParams(params);
		if (next.length) p.set("status", next.join(","));
		else p.delete("status");
		setParams(p, { replace: true });
	};

	return (
		<div>
			<PageHeader
				title="My tracker"
				description="Your participation pipeline. Registration deadlines and event dates are tracked separately."
				actions={
					<Button size="sm" variant="outline" onClick={() => exportMut.mutate()} disabled={exportMut.isPending}>
						<Download /> Export CSV
					</Button>
				}
			/>
			<div className="mb-3 flex flex-wrap items-center gap-2">
				<div className="relative min-w-48 flex-1">
					<Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
					<Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tracker, notes, team…" className="h-9 pl-8" aria-label="Search tracker" />
				</div>
				<Select
					value={sort}
					onValueChange={(v) => {
						const p = new URLSearchParams(params);
						p.set("sort", v);
						setParams(p, { replace: true });
					}}
				>
					<SelectTrigger size="sm" className="w-52" aria-label="Sort tracker">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="deadline">Registration deadline</SelectItem>
						<SelectItem value="start">Event start date</SelectItem>
						<SelectItem value="priority">Priority</SelectItem>
						<SelectItem value="updated">Recently updated</SelectItem>
					</SelectContent>
				</Select>
			</div>
			<div className="mb-4 flex flex-wrap gap-1.5" aria-label="Filter by status">
				{TRACKING_STATUSES.map((s) => {
					const on = statuses.includes(s);
					return (
						<button
							key={s}
							type="button"
							aria-pressed={on}
							onClick={() => setStatuses(on ? statuses.filter((x) => x !== s) : [...statuses, s])}
							className={cn("rounded-full border px-2.5 py-1 text-xs", on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent")}
						>
							{TRACKING_STATUS_LABELS[s]}
						</button>
					);
				})}
				{statuses.length > 0 && (
					<Button variant="link" size="sm" className="h-auto text-xs" onClick={() => setStatuses([])}>
						Clear
					</Button>
				)}
			</div>

			{query.isLoading ? (
				<CardGridSkeleton view="list" />
			) : query.isError ? (
				<ErrorState error={query.error} onRetry={() => query.refetch()} />
			) : query.data!.length === 0 ? (
				statuses.length || q ? (
					<EmptyState icon={<Search />} title="No tracked events match" description="Try a different status or search." action={<Button variant="outline" onClick={() => { setStatuses([]); setSearch(""); }}>Clear filters</Button>} />
				) : (
					<EmptyState
						icon={<ListChecks />}
						title="Your tracker is empty"
						description="Use “Track” on any hackathon to follow it from shortlisting to submission."
						action={
							<Button asChild>
								<Link to="/discover">Discover hackathons</Link>
							</Button>
						}
					/>
				)
			) : (
				<div className="overflow-x-auto rounded-lg border">
					<table className="w-full min-w-[56rem] text-sm">
						<thead className="bg-muted/40 text-left text-xs text-muted-foreground">
							<tr>
								<th className="px-3 py-2 font-medium">Hackathon</th>
								<th className="px-3 py-2 font-medium">Registration deadline</th>
								<th className="px-3 py-2 font-medium">Event dates</th>
								<th className="px-3 py-2 font-medium">Status</th>
								<th className="px-3 py-2 font-medium">Priority</th>
								<th className="px-3 py-2 font-medium">Team / notes</th>
								<th className="px-3 py-2 font-medium sr-only">Actions</th>
							</tr>
						</thead>
						<tbody className="divide-y">
							{query.data!.map((r) => (
								<tr key={r.id} className="align-top">
									<td className="max-w-64 px-3 py-2.5">
										<Link to={`/hackathons/${r.hackathonId}`} className="line-clamp-2 font-medium hover:text-primary">
											{r.hackathon.title}
										</Link>
										<div className="mt-1 flex items-center gap-1.5">
											<PlatformBadge platform={r.hackathon.platform} />
											{r.hackathon.isDemo && <DemoBadge />}
										</div>
									</td>
									<td className="px-3 py-2.5">
										<DeadlineCountdown deadline={r.hackathon.registrationDeadlineAt} now={now} />
									</td>
									<td className="px-3 py-2.5 text-muted-foreground">{formatDateRange(r.hackathon.eventStartAt, r.hackathon.eventEndAt)}</td>
									<td className="px-3 py-2.5">
										<Select value={r.status} onValueChange={(v) => update.mutate({ id: r.id, status: v as TrackingStatus })}>
											<SelectTrigger size="sm" className="w-40" aria-label={`Status for ${r.hackathon.title}`}>
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												{TRACKING_STATUSES.map((s) => (
													<SelectItem key={s} value={s}>
														{TRACKING_STATUS_LABELS[s]}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</td>
									<td className="px-3 py-2.5">
										<Select value={r.priority} onValueChange={(v) => update.mutate({ id: r.id, priority: v as Priority })}>
											<SelectTrigger size="sm" className="w-28" aria-label={`Priority for ${r.hackathon.title}`}>
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
									</td>
									<td className="max-w-56 px-3 py-2.5">
										<button type="button" onClick={() => setNotesFor(r)} className="group flex w-full items-start gap-1.5 text-left">
											<NotebookPen className="mt-0.5 size-3.5 shrink-0 text-muted-foreground group-hover:text-primary" />
											<span className="min-w-0">
												{r.teamName && <span className="block truncate font-medium">{r.teamName}</span>}
												<span className="line-clamp-2 text-xs text-muted-foreground">{r.personalNotes || "Add notes"}</span>
											</span>
										</button>
									</td>
									<td className="px-3 py-2.5">
										<div className="flex justify-end gap-1">
											<OfficialLink url={r.hackathon.registrationUrl ?? r.hackathon.canonicalUrl} label="Open" variant="outline" />
											<Button variant="ghost" size="icon-sm" aria-label={`Remove ${r.hackathon.title} from tracker`} onClick={() => remove.mutate(r.id)} disabled={remove.isPending}>
												<Trash2 />
											</Button>
										</div>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
			{notesFor && <NotesDialog record={notesFor} onClose={() => setNotesFor(null)} />}
		</div>
	);
}
