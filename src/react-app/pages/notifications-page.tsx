import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BellOff, CheckCheck, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { CardGridSkeleton, EmptyState, ErrorState, PageHeader } from "@/components/common/states";
import { PreferencesForm } from "@/components/notifications/preferences-form";
import { listNotifications, markAllRead, markNotification } from "@/services/personal";
import { errorMessage } from "@/lib/api";
import { formatDateTime, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

export function NotificationsPage() {
	const qc = useQueryClient();
	const [filter, setFilter] = useState<"all" | "unread">("all");
	const [page, setPage] = useState(1);
	const [showPrefs, setShowPrefs] = useState(false);
	const q = useQuery({ queryKey: ["notifications", filter, page], queryFn: () => listNotifications({ unread: filter === "unread", page }), placeholderData: keepPreviousData });
	const refresh = () => {
		void qc.invalidateQueries({ queryKey: ["notifications"] });
		void qc.invalidateQueries({ queryKey: ["unread-count"] });
	};
	const mark = useMutation({ mutationFn: ({ id, read }: { id: string; read: boolean }) => markNotification(id, read), onSuccess: refresh, onError: (e) => toast.error(errorMessage(e)) });
	const all = useMutation({
		mutationFn: markAllRead,
		onSuccess: (r) => {
			toast.success(r.updated ? `Marked ${r.updated} as read` : "Nothing unread");
			refresh();
		},
		onError: (e) => toast.error(errorMessage(e)),
	});

	// Optional browser notification for newly arrived reminders (only with explicit permission).
	const seen = useRef<Set<string> | null>(null);
	useEffect(() => {
		const items = q.data?.data ?? [];
		if (!seen.current) {
			seen.current = new Set(items.map((n) => n.id));
			return;
		}
		if (typeof Notification !== "undefined" && Notification.permission === "granted") {
			for (const n of items) if (!seen.current.has(n.id) && !n.readAt) new Notification(n.title, { body: n.message });
		}
		for (const n of items) seen.current.add(n.id);
	}, [q.data]);

	const unread = q.data?.meta?.unreadCount ?? 0;
	return (
		<div className="max-w-3xl">
			<PageHeader
				title="Notifications"
				description="Deadline reminders and verified date changes for events you saved or track."
				actions={
					<>
						<Button size="sm" variant="outline" onClick={() => setShowPrefs((s) => !s)}>
							<Settings2 /> Preferences
						</Button>
						<Button size="sm" variant="outline" onClick={() => all.mutate()} disabled={!unread || all.isPending}>
							<CheckCheck /> Mark all read
						</Button>
					</>
				}
			/>
			{showPrefs && (
				<section className="mb-6 rounded-lg border bg-card p-4">
					<h2 className="mb-3 font-semibold">Notification preferences</h2>
					<PreferencesForm />
				</section>
			)}
			<ToggleGroup type="single" variant="outline" size="sm" value={filter} onValueChange={(v) => { if (v) { setFilter(v as "all" | "unread"); setPage(1); } }} className="mb-4">
				<ToggleGroupItem value="all">All</ToggleGroupItem>
				<ToggleGroupItem value="unread">Unread ({unread})</ToggleGroupItem>
			</ToggleGroup>
			{q.isLoading ? (
				<CardGridSkeleton view="list" count={4} />
			) : q.isError ? (
				<ErrorState error={q.error} onRetry={() => q.refetch()} />
			) : q.data!.data.length === 0 ? (
				<EmptyState
					icon={<BellOff />}
					title={filter === "unread" ? "You're all caught up" : "No notifications yet"}
					description="Save or track hackathons with deadlines and HackRadar will remind you based on your preferences."
					action={
						<Button asChild variant="outline">
							<Link to="/discover">Discover hackathons</Link>
						</Button>
					}
				/>
			) : (
				<ul className="divide-y rounded-lg border bg-card">
					{q.data!.data.map((n) => (
						<li key={n.id} className={cn("flex gap-3 p-3", !n.readAt && "bg-accent/40")}>
							<span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-primary")} aria-label={n.readAt ? "Read" : "Unread"} />
							<div className="min-w-0 flex-1">
								<p className="font-medium">{n.title}</p>
								<p className="text-sm text-muted-foreground">{n.message}</p>
								<div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
									<span title={n.deliveredAt ? formatDateTime(n.deliveredAt) : ""}>{formatRelative(n.deliveredAt ?? n.createdAt)}</span>
									{n.hackathonId && (
										<Link to={`/hackathons/${n.hackathonId}`} className="text-primary hover:underline" onClick={() => !n.readAt && mark.mutate({ id: n.id, read: true })}>
											View event
										</Link>
									)}
									<button type="button" className="hover:text-foreground" onClick={() => mark.mutate({ id: n.id, read: !n.readAt })}>
										Mark as {n.readAt ? "unread" : "read"}
									</button>
								</div>
							</div>
						</li>
					))}
				</ul>
			)}
			{(q.data?.meta?.totalPages ?? 1) > 1 && (
				<div className="mt-4 flex justify-between">
					<Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
						Previous
					</Button>
					<Button variant="outline" size="sm" disabled={page >= (q.data?.meta?.totalPages ?? 1)} onClick={() => setPage(page + 1)}>
						Next
					</Button>
				</div>
			)}
		</div>
	);
}
