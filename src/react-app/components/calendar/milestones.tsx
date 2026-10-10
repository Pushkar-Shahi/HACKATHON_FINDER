import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createMilestone, deleteMilestone, listMilestones, updateMilestone } from "@/services/personal";
import { errorMessage } from "@/lib/api";
import { invalidatePersonal } from "@/lib/query-client";
import { formatDateTime, localTimeZone } from "@/lib/format";
import { utcToWallTime, wallTimeToUtc } from "@shared/time";
import type { MilestoneRecord } from "@shared/types";
import { cn } from "@/lib/utils";

export function MilestoneDialog({
	open,
	onOpenChange,
	hackathonId,
	milestone,
	defaultDate,
}: {
	open: boolean;
	onOpenChange: (o: boolean) => void;
	hackathonId?: string | null;
	milestone?: MilestoneRecord | null;
	defaultDate?: Date;
}) {
	const qc = useQueryClient();
	const initialDue = milestone ? utcToWallTime(milestone.dueAt, localTimeZone) : defaultDate ? utcToWallTime(defaultDate, localTimeZone) : "";
	const [title, setTitle] = useState(milestone?.title ?? "");
	const [due, setDue] = useState(initialDue);
	const [notes, setNotes] = useState(milestone?.notes ?? "");
	const [error, setError] = useState<string | null>(null);
	const save = useMutation({
		mutationFn: async () => {
			const dueAt = wallTimeToUtc(due, localTimeZone);
			if (!title.trim()) throw new Error("Give the milestone a title");
			if (!dueAt) throw new Error("Choose a valid due date and time");
			return milestone
				? updateMilestone(milestone.id, { title: title.trim(), dueAt: dueAt.toISOString(), notes: notes.trim() || null })
				: createMilestone({ title: title.trim(), dueAt: dueAt.toISOString(), hackathonId: hackathonId ?? null, notes: notes.trim() || null });
		},
		onSuccess: () => {
			toast.success(milestone ? "Milestone updated" : "Milestone added");
			invalidatePersonal(qc);
			onOpenChange(false);
		},
		onError: (e) => setError(errorMessage(e)),
	});
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{milestone ? "Edit milestone" : "Add preparation milestone"}</DialogTitle>
					<DialogDescription>Personal checkpoints like "form team" or "submit idea". Times are in {localTimeZone}.</DialogDescription>
				</DialogHeader>
				<form
					className="space-y-3"
					onSubmit={(e) => {
						e.preventDefault();
						setError(null);
						save.mutate();
					}}
				>
					<div>
						<Label htmlFor="ms-title">Title</Label>
						<Input id="ms-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required />
					</div>
					<div>
						<Label htmlFor="ms-due">Due</Label>
						<Input id="ms-due" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} required />
					</div>
					<div>
						<Label htmlFor="ms-notes">Notes</Label>
						<Textarea id="ms-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} rows={3} />
					</div>
					{error && (
						<p role="alert" className="text-sm text-destructive">
							{error}
						</p>
					)}
					<DialogFooter>
						<Button type="submit" disabled={save.isPending}>
							{milestone ? "Save" : "Add milestone"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

export function MilestoneList({ hackathonId }: { hackathonId: string }) {
	const qc = useQueryClient();
	const q = useQuery({ queryKey: ["milestones", hackathonId], queryFn: () => listMilestones(hackathonId) });
	// Default due date is captured when the dialog opens (not during render).
	const [openWith, setOpenWith] = useState<Date | null>(null);
	const toggle = useMutation({
		mutationFn: (m: MilestoneRecord) => updateMilestone(m.id, { completed: !m.completedAt }),
		onSuccess: () => invalidatePersonal(qc),
		onError: (e) => toast.error(errorMessage(e)),
	});
	const remove = useMutation({
		mutationFn: (id: string) => deleteMilestone(id),
		onSuccess: () => {
			toast.success("Milestone removed");
			invalidatePersonal(qc);
		},
		onError: (e) => toast.error(errorMessage(e)),
	});
	return (
		<div>
			{q.data && q.data.length > 0 ? (
				<ul className="mb-2 space-y-1.5">
					{q.data.map((m) => (
						<li key={m.id} className="flex items-start gap-2 text-sm">
							<Checkbox checked={Boolean(m.completedAt)} onCheckedChange={() => toggle.mutate(m)} aria-label={`Mark ${m.title} ${m.completedAt ? "not done" : "done"}`} className="mt-0.5" />
							<div className="min-w-0 flex-1">
								<p className={cn("truncate", m.completedAt && "text-muted-foreground line-through")}>{m.title}</p>
								<p className="text-xs text-muted-foreground">{formatDateTime(m.dueAt)}</p>
							</div>
							<Button variant="ghost" size="icon-xs" aria-label={`Delete ${m.title}`} onClick={() => remove.mutate(m.id)}>
								<Trash2 />
							</Button>
						</li>
					))}
				</ul>
			) : (
				!q.isLoading && <p className="mb-2 text-xs text-muted-foreground">No milestones yet.</p>
			)}
			<Button size="xs" variant="outline" onClick={() => setOpenWith(new Date(Date.now() + 86_400_000))}>
				<Plus /> Add milestone
			</Button>
			{openWith && <MilestoneDialog open onOpenChange={(o) => !o && setOpenWith(null)} hackathonId={hackathonId} defaultDate={openWith} />}
		</div>
	);
}
