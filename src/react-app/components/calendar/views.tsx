import { addDays, differenceInCalendarDays, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, isToday, startOfMonth, startOfWeek } from "date-fns";
import { Checkbox } from "@/components/ui/checkbox";
import type { CalendarEntry } from "@shared/types";
import { CALENDAR_ENTRY_LABELS, type CalendarEntryKind } from "@shared/constants";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export const KIND_STYLE: Record<CalendarEntryKind, string> = {
	registration_deadline: "border-l-urgent bg-urgent-soft text-urgent",
	registration_open: "border-l-info bg-info-soft text-info",
	event_start: "border-l-primary bg-accent text-accent-foreground",
	event_end: "border-l-primary/50 bg-muted text-muted-foreground",
	milestone: "border-l-warning bg-warning-soft text-warning",
};

export const WEEK_OPTS = { weekStartsOn: 1 as const };

export function monthRange(cursor: Date) {
	return { from: startOfWeek(startOfMonth(cursor), WEEK_OPTS), to: endOfWeek(endOfMonth(cursor), WEEK_OPTS) };
}
export function weekRange(cursor: Date) {
	return { from: startOfWeek(cursor, WEEK_OPTS), to: endOfWeek(cursor, WEEK_OPTS) };
}

function byDay(entries: CalendarEntry[], day: Date) {
	return entries.filter((e) => isSameDay(new Date(e.at), day));
}

export function EntryChip({ e, onOpen, showTime = true }: { e: CalendarEntry; onOpen: (e: CalendarEntry) => void; showTime?: boolean }) {
	return (
		<button
			type="button"
			onClick={() => onOpen(e)}
			title={`${CALENDAR_ENTRY_LABELS[e.kind]}: ${e.title}${e.isDemo ? " (demo)" : ""}`}
			className={cn("block w-full truncate rounded-sm border-l-2 px-1 py-0.5 text-left text-[11px] leading-tight hover:brightness-95", KIND_STYLE[e.kind])}
		>
			{showTime && <span className="mr-1 tabular opacity-80">{formatTime(e.at)}</span>}
			{e.isDemo && "[Demo] "}
			{e.title.replace(/^\[Demo\]\s*/, "")}
		</button>
	);
}

export function MonthView({ cursor, entries, onOpen }: { cursor: Date; entries: CalendarEntry[]; onOpen: (e: CalendarEntry) => void }) {
	const { from, to } = monthRange(cursor);
	const days = Array.from({ length: differenceInCalendarDays(to, from) + 1 }, (_, i) => addDays(from, i));
	return (
		<div className="overflow-x-auto">
			<div className="grid min-w-[44rem] grid-cols-7 overflow-hidden rounded-lg border">
				{Array.from({ length: 7 }, (_, i) => (
					<div key={i} className="border-b bg-muted/40 px-2 py-1.5 text-xs font-medium text-muted-foreground">
						{format(addDays(from, i), "EEE")}
					</div>
				))}
				{days.map((d) => {
					const list = byDay(entries, d);
					return (
						<div key={d.toISOString()} className={cn("min-h-28 border-b border-r p-1.5 [&:nth-child(7n)]:border-r-0", !isSameMonth(d, cursor) && "bg-muted/30")}>
							<div className={cn("mb-1 flex size-6 items-center justify-center rounded-full text-xs tabular", isToday(d) && "bg-primary font-semibold text-primary-foreground", !isSameMonth(d, cursor) && "text-muted-foreground")}>
								{format(d, "d")}
							</div>
							<div className="space-y-0.5">
								{list.slice(0, 3).map((e) => (
									<EntryChip key={e.id} e={e} onOpen={onOpen} showTime={false} />
								))}
								{list.length > 3 && <p className="px-1 text-[11px] text-muted-foreground">+{list.length - 3} more</p>}
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}

export function WeekView({ cursor, entries, onOpen }: { cursor: Date; entries: CalendarEntry[]; onOpen: (e: CalendarEntry) => void }) {
	const { from } = weekRange(cursor);
	return (
		<div className="grid gap-2 md:grid-cols-7">
			{Array.from({ length: 7 }, (_, i) => addDays(from, i)).map((d) => {
				const list = byDay(entries, d);
				return (
					<div key={d.toISOString()} className={cn("min-h-40 rounded-lg border p-2", isToday(d) && "border-primary")}>
						<div className="mb-2 text-xs font-medium">
							<span className="text-muted-foreground">{format(d, "EEE")}</span> <span className="tabular">{format(d, "MMM d")}</span>
						</div>
						<div className="space-y-1">
							{list.length ? list.map((e) => <EntryChip key={e.id} e={e} onOpen={onOpen} />) : <p className="text-[11px] text-muted-foreground">—</p>}
						</div>
					</div>
				);
			})}
		</div>
	);
}

export function AgendaView({
	entries,
	onOpen,
	selected,
	onToggle,
}: {
	entries: CalendarEntry[];
	onOpen: (e: CalendarEntry) => void;
	selected: Set<string>;
	onToggle: (id: string, on: boolean) => void;
}) {
	const groups = new Map<string, CalendarEntry[]>();
	for (const e of entries) {
		const key = format(new Date(e.at), "yyyy-MM-dd");
		groups.set(key, [...(groups.get(key) ?? []), e]);
	}
	return (
		<div className="space-y-4">
			{[...groups.entries()].map(([day, list]) => (
				<section key={day}>
					<h3 className="mb-1.5 text-xs font-semibold text-muted-foreground uppercase">{format(new Date(`${day}T12:00:00`), "EEEE, MMM d, yyyy")}</h3>
					<ul className="space-y-1">
						{list.map((e) => (
							<li key={e.id} className="flex items-center gap-2">
								<Checkbox checked={selected.has(e.id)} onCheckedChange={(v) => onToggle(e.id, v === true)} aria-label={`Select ${e.title} for export`} />
								<span className="w-16 shrink-0 text-xs text-muted-foreground tabular">{formatTime(e.at)}</span>
								<span className={cn("w-40 shrink-0 truncate rounded-sm border-l-2 px-1.5 py-0.5 text-[11px]", KIND_STYLE[e.kind])}>{CALENDAR_ENTRY_LABELS[e.kind]}</span>
								<button type="button" onClick={() => onOpen(e)} className="min-w-0 truncate text-left text-sm hover:text-primary">
									{e.title}
								</button>
							</li>
						))}
					</ul>
				</section>
			))}
		</div>
	);
}
