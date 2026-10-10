import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { addDays, addMonths, addWeeks, format, parseISO } from "date-fns";
import { toast } from "sonner";
import { CalendarDays, ChevronLeft, ChevronRight, Download, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState, PageHeader } from "@/components/common/states";
import { AgendaView, KIND_STYLE, monthRange, MonthView, weekRange, WeekView } from "@/components/calendar/views";
import { MilestoneDialog } from "@/components/calendar/milestones";
import { exportCalendar, listCalendar, listMilestones } from "@/services/personal";
import { useMe } from "@/hooks/use-me";
import { errorMessage } from "@/lib/api";
import { localTimeZone } from "@/lib/format";
import type { CalendarEntry, MilestoneRecord } from "@shared/types";
import { CALENDAR_ENTRY_KINDS, CALENDAR_ENTRY_LABELS } from "@shared/constants";
import { cn } from "@/lib/utils";

type View = "month" | "week" | "agenda";

const ICS_KIND: Record<string, string> = {
	registration_open: "registration_open",
	registration_deadline: "registration_deadline",
	event_start: "event",
	event_end: "event",
};

export function CalendarPage() {
	const [params, setParams] = useSearchParams();
	const navigate = useNavigate();
	const { user } = useMe();
	const view = (["month", "week", "agenda"].includes(params.get("view") ?? "") ? params.get("view") : "month") as View;
	const cursor = params.get("d") ? parseISO(params.get("d")!) : new Date();
	const scope = (params.get("scope") as "mine" | "all") ?? (user ? "mine" : "all");
	const effectiveScope = user ? scope : "all";
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [milestoneOpen, setMilestoneOpen] = useState(false);
	const [editing, setEditing] = useState<MilestoneRecord | null>(null);

	const range = useMemo(() => {
		if (view === "month") return monthRange(cursor);
		if (view === "week") return weekRange(cursor);
		return { from: new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate()), to: addDays(cursor, 45) };
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [view, params.get("d")]);

	const q = useQuery({
		queryKey: ["calendar", range.from.toISOString(), range.to.toISOString(), effectiveScope],
		queryFn: () => listCalendar(range.from.toISOString(), range.to.toISOString(), effectiveScope),
	});
	const milestones = useQuery({ queryKey: ["milestones", "all"], queryFn: () => listMilestones(), enabled: Boolean(user) });

	const setParam = (patch: Record<string, string | null>) => {
		const p = new URLSearchParams(params);
		for (const [k, v] of Object.entries(patch)) {
			if (v === null) p.delete(k);
			else p.set(k, v);
		}
		setParams(p, { replace: true });
	};
	const move = (dir: 1 | -1) => {
		const next = view === "month" ? addMonths(cursor, dir) : view === "week" ? addWeeks(cursor, dir) : addDays(cursor, 45 * dir);
		setParam({ d: format(next, "yyyy-MM-dd") });
	};

	const open = (e: CalendarEntry) => {
		if (e.milestoneId) {
			const m = milestones.data?.find((x) => x.id === e.milestoneId);
			if (m) setEditing(m);
		} else if (e.hackathonId) {
			navigate(`/hackathons/${e.hackathonId}`);
		}
	};

	const doExport = useMutation({
		mutationFn: async (entries: CalendarEntry[]) => {
			const byEvent = new Map<string, Set<string>>();
			const milestoneIds: string[] = [];
			for (const e of entries) {
				if (e.milestoneId) milestoneIds.push(e.milestoneId);
				else if (e.hackathonId) byEvent.set(e.hackathonId, new Set([...(byEvent.get(e.hackathonId) ?? []), ICS_KIND[e.kind]]));
			}
			await exportCalendar([...byEvent.entries()].map(([hackathonId, kinds]) => ({ hackathonId, kinds: [...kinds] })), milestoneIds);
			return entries.length;
		},
		onSuccess: (n) => toast.success(`Exported ${n} ${n === 1 ? "entry" : "entries"} to .ics`),
		onError: (e) => toast.error(errorMessage(e)),
	});

	const entries = q.data ?? [];
	const title = view === "month" ? format(cursor, "MMMM yyyy") : view === "week" ? `Week of ${format(range.from, "MMM d, yyyy")}` : `From ${format(range.from, "MMM d, yyyy")}`;

	return (
		<div>
			<PageHeader
				title="Calendar"
				description={<>Registration deadlines, event dates and your milestones. Shown in {localTimeZone}.</>}
				actions={
					user && (
						<Button size="sm" variant="outline" onClick={() => setMilestoneOpen(true)}>
							<Plus /> Add milestone
						</Button>
					)
				}
			/>
			<div className="mb-4 flex flex-wrap items-center gap-2">
				<div className="flex items-center gap-1">
					<Button variant="outline" size="icon-sm" onClick={() => move(-1)} aria-label="Previous">
						<ChevronLeft />
					</Button>
					<Button variant="outline" size="sm" onClick={() => setParam({ d: null })}>
						Today
					</Button>
					<Button variant="outline" size="icon-sm" onClick={() => move(1)} aria-label="Next">
						<ChevronRight />
					</Button>
				</div>
				<h2 className="mr-auto text-lg font-semibold">{title}</h2>
				{user && (
					<ToggleGroup type="single" variant="outline" size="sm" value={effectiveScope} onValueChange={(v) => v && setParam({ scope: v })} aria-label="Scope">
						<ToggleGroupItem value="mine">My events</ToggleGroupItem>
						<ToggleGroupItem value="all">All events</ToggleGroupItem>
					</ToggleGroup>
				)}
				<ToggleGroup type="single" variant="outline" size="sm" value={view} onValueChange={(v) => v && setParam({ view: v })} aria-label="Calendar view">
					<ToggleGroupItem value="month">Month</ToggleGroupItem>
					<ToggleGroupItem value="week">Week</ToggleGroupItem>
					<ToggleGroupItem value="agenda">Agenda</ToggleGroupItem>
				</ToggleGroup>
			</div>

			<div className="mb-3 flex flex-wrap items-center gap-3 text-xs">
				{CALENDAR_ENTRY_KINDS.map((k) => (
					<span key={k} className="inline-flex items-center gap-1.5">
						<span className={cn("h-3 w-1.5 rounded-sm border-l-2", KIND_STYLE[k])} aria-hidden />
						{CALENDAR_ENTRY_LABELS[k]}
					</span>
				))}
				<div className="ml-auto flex gap-2">
					{view === "agenda" && selected.size > 0 && (
						<Button size="xs" onClick={() => doExport.mutate(entries.filter((e) => selected.has(e.id)))} disabled={doExport.isPending}>
							<Download /> Export {selected.size} selected
						</Button>
					)}
					<Button size="xs" variant="outline" disabled={!entries.some((e) => e.kind === "registration_deadline") || doExport.isPending} onClick={() => doExport.mutate(entries.filter((e) => e.kind === "registration_deadline"))}>
						<Download /> Export deadlines in view
					</Button>
				</div>
			</div>

			{q.isLoading ? (
				<Skeleton className="h-[32rem]" />
			) : q.isError ? (
				<ErrorState error={q.error} onRetry={() => q.refetch()} />
			) : entries.length === 0 && view === "agenda" ? (
				<EmptyState
					icon={<CalendarDays />}
					title="Nothing scheduled in this range"
					description={effectiveScope === "mine" ? "Save or track hackathons to see their deadlines here." : "No events with verified dates in this range."}
					action={
						<Button asChild variant="outline">
							<Link to="/discover">Discover hackathons</Link>
						</Button>
					}
				/>
			) : view === "month" ? (
				<MonthView cursor={cursor} entries={entries} onOpen={open} />
			) : view === "week" ? (
				<WeekView cursor={cursor} entries={entries} onOpen={open} />
			) : (
				<AgendaView
					entries={entries}
					onOpen={open}
					selected={selected}
					onToggle={(id, on) =>
						setSelected((s) => {
							const n = new Set(s);
							if (on) n.add(id);
							else n.delete(id);
							return n;
						})
					}
				/>
			)}
			{entries.length === 0 && view !== "agenda" && !q.isLoading && (
				<p className="mt-3 text-center text-sm text-muted-foreground">
					No dated entries in this range{effectiveScope === "mine" ? " — save or track hackathons to see them here" : ""}.
				</p>
			)}
			{milestoneOpen && <MilestoneDialog open={milestoneOpen} onOpenChange={setMilestoneOpen} defaultDate={addDays(new Date(), 1)} />}
			{editing && <MilestoneDialog open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)} milestone={editing} />}
		</div>
	);
}
