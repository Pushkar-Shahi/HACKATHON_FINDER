import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FlaskConical } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getStats, updateProfile } from "@/services/personal";
import { useMe } from "@/hooks/use-me";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";

/** Visible whenever fictional sample data is present, so it can never be mistaken for real events. */
export function DemoNotice({ className }: { className?: string }) {
	const { user } = useMe();
	const qc = useQueryClient();
	const stats = useQuery({ queryKey: ["stats"], queryFn: getStats });
	const hide = useMutation({
		mutationFn: () => updateProfile({ showDemoEvents: false }),
		onSuccess: () => {
			toast.success("Demo events hidden. Re-enable them in Settings.");
			void qc.invalidateQueries();
		},
		onError: (e) => toast.error(errorMessage(e)),
	});
	const n = stats.data?.demoEventCount ?? 0;
	if (!n) return null;
	return (
		<div role="note" className={cn("flex flex-wrap items-center gap-2 rounded-md border border-demo/30 bg-demo-soft px-3 py-2 text-sm text-demo", className)}>
			<FlaskConical className="size-4 shrink-0" />
			<span className="min-w-0 flex-1">
				{n} demo {n === 1 ? "event is" : "events are"} fictional sample data, marked <strong>DEMO</strong>. They are not real hackathons.
			</span>
			{user && (
				<Button size="xs" variant="outline" onClick={() => hide.mutate()} disabled={hide.isPending}>
					Hide demo events
				</Button>
			)}
		</div>
	);
}
