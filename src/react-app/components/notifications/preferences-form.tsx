import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Mail, MailWarning } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/common/states";
import { getPreferences, savePreferences } from "@/services/personal";
import { errorMessage } from "@/lib/api";
import { invalidatePersonal } from "@/lib/query-client";
import { localTimeZone } from "@/lib/format";
import { listTimeZones } from "@shared/time";
import { isValidTimeZone } from "@shared/schemas";
import { NOTIFICATION_CHANNELS, REMINDER_INTERVALS, REMINDER_INTERVAL_LABELS, type NotificationChannel } from "@shared/constants";
import type { NotificationPreferences } from "@shared/types";

const CHANNEL_LABEL: Record<NotificationChannel, string> = { in_app: "In-app", email: "Email" };

export function PreferencesForm() {
	const q = useQuery({ queryKey: ["preferences"], queryFn: getPreferences });
	if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
	if (!q.data) return <Skeleton className="h-64" />;
	// Remount the form whenever the server copy changes (no state syncing in effects).
	return <PreferencesFormInner key={q.dataUpdatedAt} initial={q.data} />;
}

function PreferencesFormInner({ initial }: { initial: NotificationPreferences }) {
	const qc = useQueryClient();
	const tzList = useId();
	const [draft, setDraft] = useState<NotificationPreferences>(initial);
	const [browserPerm, setBrowserPerm] = useState<NotificationPermission | "unsupported">(() => (typeof Notification === "undefined" ? "unsupported" : Notification.permission));
	const save = useMutation({
		mutationFn: (p: NotificationPreferences) => savePreferences({ deliveryTime: p.deliveryTime, timezone: p.timezone, reminders: p.reminders, deadlineChanged: p.deadlineChanged }),
		onSuccess: (p) => {
			qc.setQueryData(["preferences"], p);
			invalidatePersonal(qc);
			toast.success("Notification preferences saved");
		},
		onError: (e) => toast.error(errorMessage(e)),
	});

	const enabled = (interval: string, channel: NotificationChannel) => draft.reminders.find((r) => r.interval === interval && r.channel === channel)?.enabled ?? false;
	const setEnabled = (interval: string, channel: NotificationChannel, on: boolean) =>
		setDraft({ ...draft, reminders: draft.reminders.map((r) => (r.interval === interval && r.channel === channel ? { ...r, enabled: on } : r)) });
	const tzValid = isValidTimeZone(draft.timezone);

	return (
		<form
			className="space-y-5"
			onSubmit={(e) => {
				e.preventDefault();
				if (tzValid) save.mutate(draft);
			}}
		>
			{!draft.emailConfigured && (
				<p className="flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
					<MailWarning className="mt-0.5 size-4 shrink-0" />
					Email delivery isn't configured on this deployment, so email reminders will not be sent. In-app reminders work normally.
				</p>
			)}
			{draft.emailConfigured && (
				<p className="flex items-center gap-2 text-xs text-success">
					<Mail className="size-4" /> Email delivery is configured.
				</p>
			)}
			<div className="overflow-x-auto">
				<table className="w-full max-w-lg text-sm">
					<thead>
						<tr className="text-left text-xs text-muted-foreground">
							<th className="py-1.5 font-medium">Deadline reminders for saved & tracked events</th>
							{NOTIFICATION_CHANNELS.map((c) => (
								<th key={c} className="w-20 py-1.5 text-center font-medium">
									{CHANNEL_LABEL[c]}
								</th>
							))}
						</tr>
					</thead>
					<tbody className="divide-y">
						{REMINDER_INTERVALS.map((i) => (
							<tr key={i}>
								<td className="py-2">{REMINDER_INTERVAL_LABELS[i]}</td>
								{NOTIFICATION_CHANNELS.map((c) => (
									<td key={c} className="text-center">
										<Checkbox checked={enabled(i, c)} onCheckedChange={(v) => setEnabled(i, c, v === true)} disabled={c === "email" && !draft.emailConfigured} aria-label={`${REMINDER_INTERVAL_LABELS[i]} by ${CHANNEL_LABEL[c]}`} />
									</td>
								))}
							</tr>
						))}
						<tr>
							<td className="py-2">When a verified deadline changes</td>
							{NOTIFICATION_CHANNELS.map((c) => (
								<td key={c} className="text-center">
									<Checkbox
										checked={draft.deadlineChanged[c]}
										onCheckedChange={(v) => setDraft({ ...draft, deadlineChanged: { ...draft.deadlineChanged, [c]: v === true } })}
										disabled={c === "email" && !draft.emailConfigured}
										aria-label={`Deadline changes by ${CHANNEL_LABEL[c]}`}
									/>
								</td>
							))}
						</tr>
					</tbody>
				</table>
			</div>
			<div className="grid max-w-lg gap-4 sm:grid-cols-2">
				<div>
					<Label htmlFor="deliveryTime">Preferred delivery time</Label>
					<Input id="deliveryTime" type="time" value={draft.deliveryTime} onChange={(e) => setDraft({ ...draft, deliveryTime: e.target.value })} required />
					<p className="mt-1 text-xs text-muted-foreground">Used for day-based reminders (7 days, 3 days, deadline day).</p>
				</div>
				<div>
					<Label htmlFor="prefTz">Reminder timezone</Label>
					<Input id="prefTz" list={tzList} value={draft.timezone} onChange={(e) => setDraft({ ...draft, timezone: e.target.value })} aria-invalid={!tzValid} />
					<datalist id={tzList}>
						{listTimeZones().map((z) => (
							<option key={z} value={z} />
						))}
					</datalist>
					{!tzValid ? (
						<p className="mt-1 text-xs text-destructive">Unknown timezone</p>
					) : (
						draft.timezone !== localTimeZone && (
							<button type="button" className="mt-1 text-xs underline" onClick={() => setDraft({ ...draft, timezone: localTimeZone })}>
								Use this device's timezone ({localTimeZone})
							</button>
						)
					)}
				</div>
			</div>
			<div className="flex flex-wrap items-center gap-3">
				<Button type="submit" disabled={save.isPending || !tzValid}>
					Save preferences
				</Button>
				{browserPerm !== "unsupported" && browserPerm !== "granted" && (
					<Button
						type="button"
						variant="outline"
						onClick={async () => {
							const p = await Notification.requestPermission();
							setBrowserPerm(p);
							if (p === "granted") new Notification("HackRadar", { body: "Browser notifications are enabled for new in-app reminders while HackRadar is open." });
						}}
					>
						Enable browser notifications
					</Button>
				)}
				{browserPerm === "granted" && <span className="text-xs text-muted-foreground">Browser notifications allowed (shown while HackRadar is open).</span>}
			</div>
		</form>
	);
}
