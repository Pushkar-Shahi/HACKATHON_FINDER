import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, CircleDashed, ExternalLink, Hand, PauseCircle, Plus, Upload, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState, PageHeader } from "@/components/common/states";
import { PlatformBadge } from "@/components/hackathons/badges";
import { getSources } from "@/services/system";
import { formatDateTime, formatRelative } from "@/lib/format";
import { INTEGRATION_STATUS_LABELS, type IntegrationStatus } from "@shared/constants";
import { cn } from "@/lib/utils";

const STATUS_STYLE: Record<IntegrationStatus, { icon: typeof CheckCircle2; className: string }> = {
	connected: { icon: CheckCircle2, className: "border-success/30 bg-success-soft text-success" },
	manual_mode: { icon: Hand, className: "bg-secondary text-secondary-foreground" },
	setup_required: { icon: CircleDashed, className: "border-info/30 bg-info-soft text-info" },
	sync_failed: { icon: XCircle, className: "border-urgent/30 bg-urgent-soft text-urgent" },
	temporarily_unavailable: { icon: PauseCircle, className: "border-warning/30 bg-warning-soft text-warning" },
};

export function SourcesPage() {
	const q = useQuery({ queryKey: ["sources"], queryFn: getSources });
	return (
		<div>
			<PageHeader
				title="Sources & integrations"
				description="What HackRadar is allowed to collect from each platform, and how fresh that data is. A source is only shown as Connected after a real sync succeeds."
			/>
			{q.isLoading ? (
				<div className="grid gap-4 md:grid-cols-2">
					{[0, 1, 2, 3].map((i) => (
						<Skeleton key={i} className="h-64" />
					))}
				</div>
			) : q.isError ? (
				<ErrorState error={q.error} onRetry={() => q.refetch()} />
			) : (
				<>
					<div className="grid gap-4 md:grid-cols-2">
						{q.data!.map((s) => {
							const style = STATUS_STYLE[s.status];
							return (
								<article key={s.platform} className="flex flex-col rounded-lg border bg-card p-4">
									<div className="flex items-start justify-between gap-2">
										<div>
											<h2 className="font-semibold">{s.name}</h2>
											<a href={s.homepageUrl} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
												{s.homepageUrl.replace(/^https?:\/\//, "")} <ExternalLink className="size-3" />
											</a>
										</div>
										<span className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium", style.className)}>
											<style.icon className="size-3.5" /> {INTEGRATION_STATUS_LABELS[s.status]}
										</span>
									</div>
									<p className="mt-2 text-sm text-muted-foreground">{s.statusDetail}</p>
									<dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
										<dt className="text-muted-foreground">Method</dt>
										<dd>{s.integrationMethod}</dd>
										<dt className="text-muted-foreground">Automatic sync</dt>
										<dd>{s.autoSyncConfigured ? "Configured (every 6 h)" : "Not configured"}</dd>
										<dt className="text-muted-foreground">Last successful sync</dt>
										<dd>{s.lastSuccessfulSyncAt ? <span title={formatDateTime(s.lastSuccessfulSyncAt)}>{formatRelative(s.lastSuccessfulSyncAt)}</span> : "Never"}</dd>
										<dt className="text-muted-foreground">Last attempt</dt>
										<dd>{s.lastAttemptedSyncAt ? <span title={formatDateTime(s.lastAttemptedSyncAt)}>{formatRelative(s.lastAttemptedSyncAt)}</span> : "Never"}</dd>
										<dt className="text-muted-foreground">Last run</dt>
										<dd className="tabular">{s.lastRun ? `${s.lastRun.added} added · ${s.lastRun.updated} updated · ${s.lastRun.skipped} skipped` : "—"}</dd>
										<dt className="text-muted-foreground">Shared events</dt>
										<dd className="tabular">
											<Link to={`/discover?platforms=${s.platform}`} className="hover:text-primary">
												{s.eventCount}
											</Link>
										</dd>
									</dl>
									{s.lastError && (
										<p className="mt-3 flex items-start gap-1.5 rounded-md border border-urgent/30 bg-urgent-soft p-2 text-xs text-urgent">
											<AlertCircle className="mt-0.5 size-3.5 shrink-0" /> {s.lastError}
										</p>
									)}
									<div className="mt-3 rounded-md bg-muted/50 p-3 text-xs">
										<p className="font-medium">Access policy</p>
										<p className="mt-0.5 text-muted-foreground">{s.policySummary}</p>
										{s.integrationMode === "manual" && (
											<>
												<p className="mt-2 font-medium">Manual workflow</p>
												<p className="mt-0.5 text-muted-foreground">{s.manualWorkflow}</p>
											</>
										)}
									</div>
									<div className="mt-auto flex flex-wrap gap-2 pt-4">
										<PlatformBadge platform={s.platform} />
										<Button asChild size="xs" variant="outline" className="ml-auto">
											<Link to="/events/new">
												<Plus /> Add manually
											</Link>
										</Button>
										<Button asChild size="xs" variant="outline">
											<Link to="/my-events?tab=import">
												<Upload /> Import CSV
											</Link>
										</Button>
									</div>
								</article>
							);
						})}
					</div>
					<p className="mt-6 max-w-3xl text-xs text-muted-foreground">
						HackRadar is independent and is not endorsed by these platforms. It never scrapes sites whose terms forbid it. Operators who obtain explicit permission can connect an
						authorized feed (documented in the README); until then, every source runs in Manual Mode and the rest of HackRadar works normally.
					</p>
				</>
			)}
		</div>
	);
}
