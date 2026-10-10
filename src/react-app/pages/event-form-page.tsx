import { Link, useNavigate, useParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState, PageHeader } from "@/components/common/states";
import { detailToFormValues, emptyFormValues, HackathonForm } from "@/components/hackathons/hackathon-form";
import { createEvent, getHackathon, updateEvent } from "@/services/hackathons";
import { useMe } from "@/hooks/use-me";
import { invalidatePersonal } from "@/lib/query-client";
import { localTimeZone } from "@/lib/format";
import { ApiError } from "@/lib/api";

export function NewEventPage() {
	const navigate = useNavigate();
	const qc = useQueryClient();
	const { user } = useMe();
	const tz = user?.timezone ?? localTimeZone;
	return (
		<div className="max-w-3xl">
			<PageHeader
				title="Add a hackathon"
				description="Manually add an event you found on any platform. It stays private to you unless you submit it for publication."
				actions={
					<Button asChild variant="outline" size="sm">
						<Link to="/my-events?tab=import">
							<Upload /> Import CSV instead
						</Link>
					</Button>
				}
			/>
			<HackathonForm
				initial={emptyFormValues(tz)}
				submitLabel="Save hackathon"
				onSubmit={async (input) => {
					const created = await createEvent(input);
					toast.success("Hackathon saved");
					invalidatePersonal(qc);
					navigate(`/hackathons/${created.id}`);
				}}
			/>
		</div>
	);
}

export function EditEventPage() {
	const { id = "" } = useParams();
	const navigate = useNavigate();
	const qc = useQueryClient();
	const { user } = useMe();
	const q = useQuery({ queryKey: ["hackathon", id], queryFn: () => getHackathon(id) });
	if (q.isLoading) return <Skeleton className="h-96 max-w-3xl" />;
	if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
	const h = q.data!;
	if (!h.isOwner || h.visibility !== "private") {
		return <ErrorState error={new ApiError(403, "forbidden", "Only the creator can edit a private event. Published events are maintained by administrators.")} />;
	}
	return (
		<div className="max-w-3xl">
			<Button asChild variant="ghost" size="sm" className="mb-3 -ml-2">
				<Link to={`/hackathons/${h.id}`}>
					<ArrowLeft /> Back to event
				</Link>
			</Button>
			<PageHeader title="Edit hackathon" description={h.title} />
			<HackathonForm
				initial={detailToFormValues(h, user?.timezone ?? localTimeZone)}
				excludeId={h.id}
				submitLabel="Save changes"
				onSubmit={async (input) => {
					await updateEvent(h.id, input);
					toast.success("Changes saved");
					invalidatePersonal(qc);
					navigate(`/hackathons/${h.id}`);
				}}
			/>
		</div>
	);
}
