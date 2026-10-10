import { BadgeCheck, CircleHelp, Clock, FlaskConical, History } from "lucide-react";
import { cn } from "@/lib/utils";
import {
	EVENT_STATUS_LABELS,
	PLATFORM_LABELS,
	REGISTRATION_STATUS_LABELS,
	type EventStatus,
	type PlatformId,
	type RegistrationStatus,
} from "@shared/constants";
import { verificationState } from "@shared/status";
import { formatRelative } from "@/lib/format";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const pill = "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap";

const PLATFORM_DOT: Record<PlatformId, string> = {
	devpost: "bg-[var(--platform-devpost)]",
	machinehack: "bg-[var(--platform-machinehack)]",
	mlh: "bg-[var(--platform-mlh)]",
	unstop: "bg-[var(--platform-unstop)]",
	other: "bg-[var(--platform-other)]",
};

/** Source attribution. A neutral pill with a colour dot — no platform logos or branding. */
export function PlatformBadge({ platform, className }: { platform: PlatformId; className?: string }) {
	return (
		<span className={cn(pill, "bg-background text-foreground/80", className)}>
			<span className={cn("size-1.5 rounded-full", PLATFORM_DOT[platform])} aria-hidden />
			{PLATFORM_LABELS[platform]}
		</span>
	);
}

const REG_STYLE: Record<RegistrationStatus, string> = {
	open: "border-success/30 bg-success-soft text-success",
	closing_soon: "border-warning/30 bg-warning-soft text-warning",
	opening_soon: "border-info/30 bg-info-soft text-info",
	closed: "bg-muted text-muted-foreground",
	unknown: "border-dashed bg-background text-muted-foreground",
};

export function RegistrationBadge({ status }: { status: RegistrationStatus }) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span className={cn(pill, REG_STYLE[status])}>
					{status === "unknown" && <CircleHelp className="size-3" />}
					{REGISTRATION_STATUS_LABELS[status]}
				</span>
			</TooltipTrigger>
			<TooltipContent>HackRadar's estimate from stored dates — confirm on the official page.</TooltipContent>
		</Tooltip>
	);
}

export function EventStatusBadge({ status }: { status: EventStatus }) {
	const style =
		status === "ongoing"
			? "border-info/30 bg-info-soft text-info"
			: status === "cancelled"
				? "border-urgent/30 bg-urgent-soft text-urgent"
				: status === "needs_verification"
					? "border-dashed text-muted-foreground"
					: "bg-background text-muted-foreground";
	return <span className={cn(pill, style)}>{EVENT_STATUS_LABELS[status]}</span>;
}

export function DemoBadge({ className }: { className?: string }) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span className={cn(pill, "border-demo/30 bg-demo-soft text-demo uppercase tracking-wide", className)}>
					<FlaskConical className="size-3" /> Demo
				</span>
			</TooltipTrigger>
			<TooltipContent>Fictional sample data — not a real event.</TooltipContent>
		</Tooltip>
	);
}

export function VerificationLabel({ lastVerifiedAt, isOwner, now }: { lastVerifiedAt: string | null; isOwner?: boolean; now: number }) {
	const state = verificationState(lastVerifiedAt ? Date.parse(lastVerifiedAt) : null, now);
	if (state === "verified") {
		return (
			<span className="inline-flex items-center gap-1 text-xs text-success">
				<BadgeCheck className="size-3.5" /> Verified {formatRelative(lastVerifiedAt, now)}
			</span>
		);
	}
	if (state === "stale") {
		return (
			<span className="inline-flex items-center gap-1 text-xs text-warning">
				<History className="size-3.5" /> Last verified {formatRelative(lastVerifiedAt, now)} — may be outdated
			</span>
		);
	}
	return (
		<span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
			<Clock className="size-3.5" /> {isOwner ? "Added by you · not verified" : "Not verified by HackRadar"}
		</span>
	);
}
