// Admin console. Every action here is authorized server-side (requireAdmin);
// hiding this page from non-admins is only a convenience, not the protection.
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, BadgeCheck, Check, FlaskConical, GitMerge, Pencil, RefreshCw, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState, ErrorState, PageHeader } from "@/components/common/states";
import { DemoBadge, PlatformBadge, RegistrationBadge } from "@/components/hackathons/badges";
import { detailToFormValues, HackathonForm } from "@/components/hackathons/hackathon-form";
import { useMe } from "@/hooks/use-me";
import {
	adminDecide,
	adminDelete,
	adminDemoCount,
	adminDuplicates,
	adminGetHackathon,
	adminImportFailures,
	adminLoadDemo,
	adminOverview,
	adminRemoveDemo,
	adminResolveDuplicate,
	adminSetAutoSync,
	adminSources,
	adminSubmissions,
	adminSync,
	adminSyncLogs,
	adminUpdateHackathon,
	adminVerificationQueue,
	adminVerify,
} from "@/services/system";
import { ApiError, errorMessage } from "@/lib/api";
import { formatDateRange, formatDateTime, formatRelative, localTimeZone } from "@/lib/format";
import { INTEGRATION_STATUS_LABELS } from "@shared/constants";
import type { HackathonSummary } from "@shared/types";
import { cn } from "@/lib/utils";

function useAdminMutation<T>(fn: (arg: T) => Promise<unknown>, success: string | ((r: unknown) => string)) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: fn,
		onSuccess: (r) => {
			toast.success(typeof success === "string" ? success : success(r));
			void qc.invalidateQueries();
		},
		onError: (e) => toast.error(errorMessage(e)),
	});
}

function Loading() {
	return <Skeleton className="h-48" />;
}

function Overview() {
	const q = useQuery({ queryKey: ["admin", "overview"], queryFn: adminOverview });
	if (q.isLoading) return <Loading />;
	if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
	const d = q.data!;
	const items: [string, number][] = [
		["Public events (real)", d.publicEvents],
		["Demo events", d.demoEvents],
		["Private user events", d.privateEvents],
		["Needs review", d.needsReview],
		["Never verified", d.unverified],
		["Verification stale (>7d)", d.stale],
		["Missing deadline", d.missingDeadline],
		["Pending publication", d.pendingPublication],
		["Open duplicate candidates", d.openDuplicates],
		["Problem sync runs (7d)", d.problemSyncRuns7d],
	];
	return (
		<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
			{items.map(([label, n]) => (
				<div key={label} className="rounded-lg border bg-card p-3">
					<p className="text-xs text-muted-foreground">{label}</p>
					<p className="mt-1 text-xl font-semibold tabular">{n.toLocaleString()}</p>
				</div>
			))}
		</div>
	);
}

function Sources() {
	const q = useQuery({ queryKey: ["admin", "sources"], queryFn: adminSources });
	const sync = useAdminMutation((id: string) => adminSync(id), (r) => {
		const s = r as { status: string; added: number; updated: number; skipped: number; error: string | null };
		return s.status === "skipped" ? `Not synced: ${s.error ?? "manual mode"}` : `Sync ${s.status}: ${s.added} added, ${s.updated} updated, ${s.skipped} skipped`;
	});
	const auto = useAdminMutation(({ id, on }: { id: string; on: boolean }) => adminSetAutoSync(id, on), "Auto-sync setting saved");
	if (q.isLoading) return <Loading />;
	if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
	return (
		<div className="space-y-3">
			<p className="text-sm text-muted-foreground">
				Feed URLs, tokens and authorization references are Cloudflare secrets (see README). They are never shown or editable here. Sync only contacts a provider when a valid authorized feed is configured.
			</p>
			{q.data!.map((s) => (
				<div key={s.platform} className="flex flex-col gap-3 rounded-lg border bg-card p-4 md:flex-row md:items-center">
					<div className="min-w-0 flex-1">
						<div className="flex items-center gap-2">
							<h3 className="font-medium">{s.name}</h3>
							<span className="rounded border px-1.5 text-xs">{INTEGRATION_STATUS_LABELS[s.status]}</span>
						</div>
						<p className="mt-1 text-xs text-muted-foreground">{s.statusDetail}</p>
						<p className="mt-1 text-xs text-muted-foreground">
							Feed host: {s.config.feedHost ?? "—"} · Token: {s.config.hasToken ? "set" : "none"} · Authorization: {s.config.authorizationRef ?? "—"}
						</p>
						{s.config.problem && <p className="mt-1 text-xs text-urgent">{s.config.problem}</p>}
						{s.lastError && <p className="mt-1 text-xs text-urgent">Last error: {s.lastError}</p>}
					</div>
					<label className="flex items-center gap-2 text-sm">
						<Switch checked={s.autoSyncEnabled} onCheckedChange={(on) => auto.mutate({ id: s.platform, on })} disabled={auto.isPending} /> Auto-sync
					</label>
					<Button size="sm" variant="outline" onClick={() => sync.mutate(s.platform)} disabled={sync.isPending}>
						<RefreshCw className={cn(sync.isPending && sync.variables === s.platform && "animate-spin")} /> Sync now
					</Button>
				</div>
			))}
		</div>
	);
}

function SyncLogs() {
	const [page, setPage] = useState(1);
	const q = useQuery({ queryKey: ["admin", "sync-logs", page], queryFn: () => adminSyncLogs(page) });
	if (q.isLoading) return <Loading />;
	if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
	if (!q.data!.length) return <EmptyState title="No sync runs yet" description="Runs appear here when a sync is triggered by the scheduler or an administrator." />;
	return (
		<div>
			<div className="overflow-x-auto rounded-lg border">
				<table className="w-full min-w-[48rem] text-sm">
					<thead className="bg-muted/40 text-left text-xs text-muted-foreground">
						<tr>
							{["Started", "Platform", "Trigger", "Status", "Fetched", "Added", "Updated", "Skipped", "Error"].map((h) => (
								<th key={h} className="px-3 py-2 font-medium">
									{h}
								</th>
							))}
						</tr>
					</thead>
					<tbody className="divide-y">
						{q.data!.map((r) => (
							<tr key={r.id}>
								<td className="px-3 py-2 whitespace-nowrap">{formatDateTime(r.startedAt)}</td>
								<td className="px-3 py-2">{r.platform}</td>
								<td className="px-3 py-2">{r.trigger}</td>
								<td className={cn("px-3 py-2 font-medium", r.status === "success" ? "text-success" : r.status === "skipped" ? "text-muted-foreground" : "text-urgent")}>{r.status}</td>
								<td className="px-3 py-2 tabular">{r.fetched}</td>
								<td className="px-3 py-2 tabular">{r.added}</td>
								<td className="px-3 py-2 tabular">{r.updated}</td>
								<td className="px-3 py-2 tabular">{r.skipped}</td>
								<td className="max-w-72 truncate px-3 py-2 text-xs text-muted-foreground" title={r.error ?? ""}>
									{r.error ?? "—"}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
			<div className="mt-3 flex gap-2">
				<Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
					Newer
				</Button>
				<Button size="sm" variant="outline" disabled={q.data!.length < 25} onClick={() => setPage(page + 1)}>
					Older
				</Button>
			</div>
		</div>
	);
}

function EventLine({ h, children }: { h: HackathonSummary; children?: React.ReactNode }) {
	return (
		<div className="flex flex-col gap-2 rounded-lg border bg-card p-3 md:flex-row md:items-center">
			<div className="min-w-0 flex-1">
				<div className="flex flex-wrap items-center gap-1.5">
					<Link to={`/hackathons/${h.id}`} className="font-medium hover:text-primary">
						{h.title}
					</Link>
					{h.isDemo && <DemoBadge />}
				</div>
				<div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
					<PlatformBadge platform={h.platform} />
					<RegistrationBadge status={h.registrationStatus} />
					<span>{formatDateRange(h.eventStartAt, h.eventEndAt)}</span>
					<span>Verified: {h.lastVerifiedAt ? formatRelative(h.lastVerifiedAt) : "never"}</span>
				</div>
				{children}
			</div>
		</div>
	);
}

function Verification() {
	const q = useQuery({ queryKey: ["admin", "verification"], queryFn: () => adminVerificationQueue(1) });
	const verify = useAdminMutation((id: string) => adminVerify(id), (r) => ((r as { verified: boolean }).verified ? "Marked verified" : "Still has contradictions — flagged for review"));
	const del = useAdminMutation((id: string) => adminDelete(id), "Event deleted");
	if (q.isLoading) return <Loading />;
	if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
	if (!q.data!.data.length) return <EmptyState icon={<BadgeCheck />} title="Verification queue is empty" description="All shared events are verified and recent." />;
	return (
		<div className="space-y-2">
			<p className="text-sm text-muted-foreground">Check each record against its official page before marking it verified.</p>
			{q.data!.data.map(({ hackathon: h, contradictions }) => (
				<div key={h.id} className="flex flex-col gap-2 md:flex-row md:items-start">
					<div className="min-w-0 flex-1">
						<EventLine h={h}>
							{contradictions.length > 0 && <p className="mt-1 text-xs text-warning">{contradictions.join(" · ")}</p>}
						</EventLine>
					</div>
					<div className="flex gap-1.5">
						<Button size="sm" variant="outline" asChild>
							<a href={h.canonicalUrl} target="_blank" rel="noopener noreferrer nofollow">
								Source
							</a>
						</Button>
						<Button size="sm" variant="outline" asChild>
							<Link to={`/admin/hackathons/${h.id}/edit`}>
								<Pencil /> Edit
							</Link>
						</Button>
						<Button size="sm" onClick={() => verify.mutate(h.id)} disabled={verify.isPending}>
							<BadgeCheck /> Verify
						</Button>
						<Button size="icon-sm" variant="ghost" aria-label={`Delete ${h.title}`} onClick={() => confirm(`Delete “${h.title}” for everyone?`) && del.mutate(h.id)}>
							<Trash2 />
						</Button>
					</div>
				</div>
			))}
		</div>
	);
}

function Submissions() {
	const q = useQuery({ queryKey: ["admin", "submissions"], queryFn: adminSubmissions });
	const [notes, setNotes] = useState<Record<string, string>>({});
	const decide = useAdminMutation(({ id, approve }: { id: string; approve: boolean }) => adminDecide(id, approve, notes[id] || null), "Decision saved");
	if (q.isLoading) return <Loading />;
	if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
	if (!q.data!.length) return <EmptyState title="No pending submissions" description="Users can submit their private events for publication into the shared feed." />;
	return (
		<div className="space-y-2">
			{q.data!.map((h) => (
				<EventLine key={h.id} h={h}>
					<div className="mt-2 flex flex-wrap gap-2">
						<Input className="h-8 max-w-sm" placeholder="Review note (shown to the submitter)" value={notes[h.id] ?? ""} onChange={(e) => setNotes({ ...notes, [h.id]: e.target.value })} />
						<Button size="sm" onClick={() => decide.mutate({ id: h.id, approve: true })} disabled={decide.isPending}>
							<Check /> Approve & publish
						</Button>
						<Button size="sm" variant="outline" onClick={() => decide.mutate({ id: h.id, approve: false })} disabled={decide.isPending}>
							<X /> Reject
						</Button>
					</div>
				</EventLine>
			))}
		</div>
	);
}

function Duplicates() {
	const q = useQuery({ queryKey: ["admin", "duplicates"], queryFn: adminDuplicates });
	const resolve = useAdminMutation(({ id, action, keepId }: { id: string; action: "merge" | "dismiss"; keepId?: string }) => adminResolveDuplicate(id, action, keepId), "Resolved");
	if (q.isLoading) return <Loading />;
	if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
	if (!q.data!.length) return <EmptyState icon={<GitMerge />} title="No duplicate candidates" description="Possible duplicates found by title/organizer/date matching appear here. Records are never merged on title alone automatically." />;
	return (
		<div className="space-y-4">
			{q.data!.map((d) => (
				<div key={d.id} className="rounded-lg border p-3">
					<p className="mb-2 text-xs text-muted-foreground">
						Confidence: <strong>{d.confidence}</strong> — {d.reasons.join(", ")}
					</p>
					<div className="grid gap-2 md:grid-cols-2">
						{[d.a, d.b].map((h) => (
							<div key={h.id} className="space-y-2">
								<EventLine h={h} />
								<Button size="sm" variant="outline" onClick={() => confirm(`Keep “${h.title}” and merge the other record into it? Bookmarks, tracker entries and sources move to the kept record.`) && resolve.mutate({ id: d.id, action: "merge", keepId: h.id })}>
									<GitMerge /> Keep this one
								</Button>
							</div>
						))}
					</div>
					<Button size="sm" variant="ghost" className="mt-2" onClick={() => resolve.mutate({ id: d.id, action: "dismiss" })}>
						Not duplicates — dismiss
					</Button>
				</div>
			))}
		</div>
	);
}

function Failures() {
	const q = useQuery({ queryKey: ["admin", "failures"], queryFn: adminImportFailures });
	if (q.isLoading) return <Loading />;
	if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
	if (!q.data!.length) return <EmptyState title="No failed imports" description="Records rejected during provider syncs (failed validation, bad URLs…) are listed here." />;
	return (
		<ul className="divide-y rounded-lg border bg-card text-sm">
			{q.data!.map((f) => (
				<li key={f.id} className="p-3">
					<p className="font-medium">
						{f.platform} · {f.externalEventId ?? "(no id)"}
					</p>
					<p className="text-xs text-muted-foreground">{f.reason}</p>
					<p className="text-[11px] text-muted-foreground">Run started {formatDateTime(f.runStartedAt)}</p>
				</li>
			))}
		</ul>
	);
}

function DemoData() {
	const q = useQuery({ queryKey: ["admin", "demo"], queryFn: adminDemoCount });
	const load = useAdminMutation(() => adminLoadDemo(), (r) => `Loaded ${(r as { created: number }).created} demo events`);
	const remove = useAdminMutation(() => adminRemoveDemo(), (r) => `Removed ${(r as { removed: number }).removed} demo events`);
	return (
		<div className="max-w-xl space-y-3 rounded-lg border bg-card p-4">
			<p className="flex items-center gap-2 font-medium">
				<FlaskConical className="size-4 text-demo" /> Demo data
			</p>
			<p className="text-sm text-muted-foreground">
				Loads a handful of clearly fictional events (titles prefixed “[Demo]”, example.com links, platform “Other”, <code>is_demo = 1</code>) so the interface can be explored before real
				data exists. They are labelled DEMO everywhere and excluded from source counts.
			</p>
			<p className="text-sm">Currently loaded: {q.isLoading ? "…" : (q.data?.count ?? 0)}</p>
			<div className="flex gap-2">
				<Button size="sm" onClick={() => load.mutate(undefined)} disabled={load.isPending || (q.data?.count ?? 0) > 0}>
					Load demo data
				</Button>
				<Button size="sm" variant="outline" onClick={() => confirm("Remove all demo events? Bookmarks and tracker entries pointing at them are removed too.") && remove.mutate(undefined)} disabled={remove.isPending || !q.data?.count}>
					Remove demo data
				</Button>
			</div>
		</div>
	);
}

export function AdminPage() {
	const { isAdmin, isLoading } = useMe();
	const [params, setParams] = useSearchParams();
	const tab = params.get("tab") ?? "overview";
	if (isLoading) return <Loading />;
	if (!isAdmin) {
		return <ErrorState error={new ApiError(403, "forbidden", "Administrator access is required. See the README for how the first administrator is granted.")} />;
	}
	return (
		<div>
			<PageHeader title="Admin" description="Source management and data quality. All actions are authorized and logged server-side." />
			<Tabs value={tab} onValueChange={(v) => setParams({ tab: v }, { replace: true })}>
				<TabsList className="flex h-auto flex-wrap">
					<TabsTrigger value="overview">Overview</TabsTrigger>
					<TabsTrigger value="sources">Sources & sync</TabsTrigger>
					<TabsTrigger value="logs">Sync logs</TabsTrigger>
					<TabsTrigger value="verify">Verification</TabsTrigger>
					<TabsTrigger value="submissions">Submissions</TabsTrigger>
					<TabsTrigger value="duplicates">Duplicates</TabsTrigger>
					<TabsTrigger value="failures">Failed imports</TabsTrigger>
					<TabsTrigger value="demo">Demo data</TabsTrigger>
				</TabsList>
				<div className="mt-4">
					<TabsContent value="overview">
						<Overview />
					</TabsContent>
					<TabsContent value="sources">
						<Sources />
					</TabsContent>
					<TabsContent value="logs">
						<SyncLogs />
					</TabsContent>
					<TabsContent value="verify">
						<Verification />
					</TabsContent>
					<TabsContent value="submissions">
						<Submissions />
					</TabsContent>
					<TabsContent value="duplicates">
						<Duplicates />
					</TabsContent>
					<TabsContent value="failures">
						<Failures />
					</TabsContent>
					<TabsContent value="demo">
						<DemoData />
					</TabsContent>
				</div>
			</Tabs>
		</div>
	);
}

export function AdminEditPage() {
	const { id = "" } = useParams();
	const navigate = useNavigate();
	const qc = useQueryClient();
	const { isAdmin } = useMe();
	const [markVerified, setMarkVerified] = useState(true);
	const q = useQuery({ queryKey: ["admin", "hackathon", id], queryFn: () => adminGetHackathon(id), enabled: isAdmin });
	if (!isAdmin) return <ErrorState error={new ApiError(403, "forbidden", "Administrator access required.")} />;
	if (q.isLoading) return <Loading />;
	if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
	const h = q.data!;
	return (
		<div className="max-w-3xl">
			<Button asChild variant="ghost" size="sm" className="mb-3 -ml-2">
				<Link to="/admin?tab=verify">
					<ArrowLeft /> Admin
				</Link>
			</Button>
			<PageHeader title="Edit shared event" description={`${h.title} — changes to the registration deadline notify everyone who saved or tracks it.`} />
			<HackathonForm
				initial={detailToFormValues(h, localTimeZone)}
				excludeId={h.id}
				submitLabel="Save shared event"
				extra={
					<label className="flex items-center gap-2 text-sm">
						<Checkbox checked={markVerified} onCheckedChange={(v) => setMarkVerified(v === true)} />I checked these details against the official source (mark verified now)
					</label>
				}
				onSubmit={async (input) => {
					await adminUpdateHackathon(h.id, input, markVerified);
					toast.success("Shared event updated");
					void qc.invalidateQueries();
					navigate(`/hackathons/${h.id}`);
				}}
			/>
		</div>
	);
}
