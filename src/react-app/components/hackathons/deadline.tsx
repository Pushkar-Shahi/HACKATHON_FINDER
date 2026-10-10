import { AlarmClock, CalendarX2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { deadlineUrgency, formatTimeRemaining } from "@shared/status";
import { formatDateTime } from "@/lib/format";

/** Deadline with a live countdown. Unknown deadlines never get a fabricated countdown. */
export function DeadlineCountdown({ deadline, now, compact = false }: { deadline: string | null; now: number; compact?: boolean }) {
	const ms = deadline ? Date.parse(deadline) : null;
	const urgency = deadlineUrgency(ms, now);
	if (ms === null) {
		return (
			<span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
				<CalendarX2 className="size-4" /> No verified deadline
			</span>
		);
	}
	const tone =
		urgency.kind === "within_48h"
			? "text-urgent"
			: urgency.kind === "within_7d"
				? "text-warning"
				: urgency.kind === "passed"
					? "text-muted-foreground"
					: "text-foreground";
	return (
		<span className={cn("inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm", tone)}>
			<AlarmClock className="size-4 shrink-0" />
			{urgency.kind === "passed" ? (
				<span>Deadline passed</span>
			) : (
				<span className="font-medium tabular">{formatTimeRemaining(ms - now)} left</span>
			)}
			{!compact && <span className="text-muted-foreground">· {formatDateTime(deadline)}</span>}
		</span>
	);
}

export function UrgencyLabel({ deadline, now }: { deadline: string | null; now: number }) {
	const u = deadlineUrgency(deadline ? Date.parse(deadline) : null, now);
	if (!u.label || u.kind === "unknown") return null;
	const tone =
		u.kind === "within_48h" ? "bg-urgent-soft text-urgent" : u.kind === "within_7d" ? "bg-warning-soft text-warning" : u.kind === "passed" ? "bg-muted text-muted-foreground" : "bg-info-soft text-info";
	return <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", tone)}>{u.label}</span>;
}
