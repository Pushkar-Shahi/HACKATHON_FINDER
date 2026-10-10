import { Link, useSearchParams } from "react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, FilePlus2, FileStack } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CardGridSkeleton, EmptyState, ErrorState, PageHeader } from "@/components/common/states";
import { HackathonRow } from "@/components/hackathons/hackathon-card";
import { CsvImport } from "@/components/hackathons/csv-import";
import { exportCsv, listHackathons } from "@/services/hackathons";
import { useNow } from "@/hooks/use-utils";
import { errorMessage } from "@/lib/api";

export function MyEventsPage() {
	const [params, setParams] = useSearchParams();
	const tab = params.get("tab") === "import" ? "import" : "events";
	const now = useNow();
	const events = useQuery({ queryKey: ["hackathons", { mine: true }], queryFn: () => listHackathons({ mine: true, sort: "recent", pageSize: 50, includeDemo: true }) });
	const exp = useMutation({ mutationFn: (scope: "mine" | "saved" | "tracked") => exportCsv(scope), onError: (e) => toast.error(errorMessage(e)) });
	return (
		<div>
			<PageHeader
				title="My events & import"
				description="Events you added manually or by CSV. They are private unless you submit them for publication and an administrator approves."
				actions={
					<Button asChild size="sm">
						<Link to="/events/new">
							<FilePlus2 /> Add hackathon
						</Link>
					</Button>
				}
			/>
			<Tabs value={tab} onValueChange={(v) => setParams(v === "import" ? { tab: "import" } : {}, { replace: true })}>
				<TabsList>
					<TabsTrigger value="events">My events</TabsTrigger>
					<TabsTrigger value="import">CSV import & export</TabsTrigger>
				</TabsList>
				<TabsContent value="events" className="mt-4">
					{events.isLoading ? (
						<CardGridSkeleton view="list" />
					) : events.isError ? (
						<ErrorState error={events.error} onRetry={() => events.refetch()} />
					) : events.data!.data.length === 0 ? (
						<EmptyState
							icon={<FileStack />}
							title="You haven't added any events"
							description="Add hackathons from Devpost, MachineHack, MLH, Unstop or anywhere else — HackRadar keeps the official link and tracks the deadline."
							action={
								<>
									<Button asChild>
										<Link to="/events/new">Add hackathon</Link>
									</Button>
									<Button variant="outline" onClick={() => setParams({ tab: "import" })}>
										Import CSV
									</Button>
								</>
							}
						/>
					) : (
						<div className="space-y-2">
							<p className="text-sm text-muted-foreground">{events.data!.meta?.total} event(s)</p>
							{events.data!.data.map((h) => (
								<HackathonRow key={h.id} h={h} now={now} />
							))}
						</div>
					)}
				</TabsContent>
				<TabsContent value="import" className="mt-4 space-y-6">
					<CsvImport />
					<div className="rounded-lg border bg-card p-4">
						<h3 className="font-medium">Export</h3>
						<p className="mt-1 text-sm text-muted-foreground">Download a CSV (compatible with the importer). Text cells are protected against spreadsheet formula injection.</p>
						<div className="mt-3 flex flex-wrap gap-2">
							<Button variant="outline" size="sm" onClick={() => exp.mutate("mine")} disabled={exp.isPending}>
								<Download /> My events
							</Button>
							<Button variant="outline" size="sm" onClick={() => exp.mutate("saved")} disabled={exp.isPending}>
								<Download /> Saved hackathons
							</Button>
							<Button variant="outline" size="sm" onClick={() => exp.mutate("tracked")} disabled={exp.isPending}>
								<Download /> Tracker (with status & notes)
							</Button>
						</div>
					</div>
				</TabsContent>
			</Tabs>
		</div>
	);
}
