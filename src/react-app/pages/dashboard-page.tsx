import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Plus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/common/states";
import { ClosingSoon, QuickViews, RecentActivity, Recommendations, StatCards } from "@/components/dashboard/widgets";
import { DemoNotice } from "@/components/dashboard/demo-notice";
import { getStats } from "@/services/personal";
import { useMe } from "@/hooks/use-me";
import { useNow } from "@/hooks/use-utils";
import { localTimeZone } from "@/lib/format";

export function DashboardPage() {
	const { user } = useMe();
	const now = useNow();
	const stats = useQuery({ queryKey: ["stats"], queryFn: getStats });
	const [quick, setQuick] = useState("upcoming");
	const name = user?.displayName || user?.name;
	return (
		<div className="space-y-5">
			<PageHeader
				title={name ? `Welcome back, ${name.split(" ")[0]}` : "Your hackathon radar"}
				description={
					<>
						Discover hackathons in one place, track every deadline, and manage participation. Times shown in <span className="font-medium">{localTimeZone}</span>.
					</>
				}
				actions={
					<>
						<Button asChild size="sm" variant="outline">
							<Link to="/my-events?tab=import">
								<Upload /> Import CSV
							</Link>
						</Button>
						<Button asChild size="sm">
							<Link to="/events/new">
								<Plus /> Add hackathon
							</Link>
						</Button>
					</>
				}
			/>
			<DemoNotice />
			<StatCards stats={stats.data} loading={stats.isLoading} signedIn={Boolean(user)} />
			<div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
				<div className="min-w-0 space-y-5">
					<ClosingSoon now={now} />
					<QuickViews now={now} active={quick} onChange={setQuick} />
				</div>
				<div className="space-y-5">
					{user ? (
						<>
							<Recommendations now={now} />
							<RecentActivity />
						</>
					) : (
						<section className="rounded-lg border bg-card p-4 text-sm">
							<h2 className="font-semibold">Track deadlines across platforms</h2>
							<p className="mt-1 text-muted-foreground">Create a free account to save events, organise collections, track your participation and get deadline reminders.</p>
							<div className="mt-3 flex gap-2">
								<Button asChild size="sm">
									<Link to="/signup">Create account</Link>
								</Button>
								<Button asChild size="sm" variant="outline">
									<Link to="/login">Sign in</Link>
								</Button>
							</div>
						</section>
					)}
				</div>
			</div>
		</div>
	);
}
