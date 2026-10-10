import { Bookmark, BookmarkCheck, Check, ChevronDown, ExternalLink, ListPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useBookmarkToggle, useRequireSignIn, useTrackingStatus } from "@/hooks/use-hackathon-actions";
import type { HackathonSummary } from "@shared/types";
import { TRACKING_STATUSES, TRACKING_STATUS_LABELS } from "@shared/constants";
import { cn } from "@/lib/utils";

type Target = Pick<HackathonSummary, "id" | "viewer" | "title">;

export function BookmarkButton({ h, size = "icon-sm", withLabel = false }: { h: Target; size?: "icon-sm" | "sm"; withLabel?: boolean }) {
	const toggle = useBookmarkToggle();
	const requireSignIn = useRequireSignIn();
	const saved = Boolean(h.viewer?.bookmarked);
	const label = saved ? `Remove ${h.title} from saved` : `Save ${h.title}`;
	return (
		<Button
			variant={saved ? "secondary" : "outline"}
			size={withLabel ? "sm" : size}
			aria-label={label}
			aria-pressed={saved}
			title={saved ? "Saved — click to remove" : "Save"}
			disabled={toggle.isPending}
			onClick={() => requireSignIn() && toggle.mutate(h)}
		>
			{saved ? <BookmarkCheck className="text-primary" /> : <Bookmark />}
			{withLabel && (saved ? "Saved" : "Save")}
		</Button>
	);
}

export function TrackerMenu({ h, size = "sm" }: { h: Target; size?: "sm" | "default" }) {
	const mutation = useTrackingStatus();
	const requireSignIn = useRequireSignIn();
	const current = h.viewer?.tracking?.status ?? null;
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant={current ? "secondary" : "outline"}
					size={size}
					disabled={mutation.isPending}
					onClick={(e) => {
						if (!requireSignIn()) e.preventDefault();
					}}
				>
					{current ? <Check className="text-primary" /> : <ListPlus />}
					<span className="max-w-28 truncate">{current ? TRACKING_STATUS_LABELS[current] : "Track"}</span>
					<ChevronDown className="opacity-60" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-52">
				<DropdownMenuLabel>Tracker status</DropdownMenuLabel>
				{TRACKING_STATUSES.map((s) => (
					<DropdownMenuItem key={s} onSelect={() => mutation.mutate({ h, status: s })} className={cn(current === s && "font-medium")}>
						<Check className={cn("size-4", current === s ? "opacity-100" : "opacity-0")} />
						{TRACKING_STATUS_LABELS[s]}
					</DropdownMenuItem>
				))}
				{current && (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuItem variant="destructive" onSelect={() => mutation.mutate({ h, status: null })}>
							Remove from tracker
						</DropdownMenuItem>
					</>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/** Registration always happens on the source platform. */
export function OfficialLink({ url, label = "Official page", size = "sm", variant = "default" }: { url: string; label?: string; size?: "sm" | "default"; variant?: "default" | "outline" }) {
	const safe = /^https?:\/\//i.test(url);
	if (!safe) return null;
	return (
		<Button asChild size={size} variant={variant}>
			<a href={url} target="_blank" rel="noopener noreferrer nofollow">
				{label} <ExternalLink />
			</a>
		</Button>
	);
}
