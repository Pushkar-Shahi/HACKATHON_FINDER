import { useId, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "@/components/layout/theme";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { PageHeader } from "@/components/common/states";
import { PreferencesForm } from "@/components/notifications/preferences-form";
import { useMe } from "@/hooks/use-me";
import { deleteMyData, updateProfile } from "@/services/personal";
import { exportCsv } from "@/services/hackathons";
import { authClient } from "@/lib/auth-client";
import { errorMessage } from "@/lib/api";
import { invalidatePersonal } from "@/lib/query-client";
import { localTimeZone } from "@/lib/format";
import { listTimeZones } from "@shared/time";
import { isValidTimeZone } from "@shared/schemas";
import { EXPERIENCE_LEVELS, PARTICIPATION_MODE_LABELS, PREFERRED_MODES, TOPICS, type ExperienceLevel, type PreferredMode, type TopicId } from "@shared/constants";
import type { Profile } from "@shared/types";

function Card({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
	return (
		<section className="rounded-lg border bg-card p-5">
			<h2 className="font-semibold">{title}</h2>
			{description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
			<div className="mt-4">{children}</div>
		</section>
	);
}

const selectClass = "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs dark:bg-input/30";

function ProfileForm({ profile }: { profile: Profile }) {
	const qc = useQueryClient();
	const tzList = useId();
	const [p, setP] = useState(profile);
	const save = useMutation({
		mutationFn: () =>
			updateProfile({
				displayName: p.displayName,
				country: p.country,
				timezone: p.timezone || null,
				experienceLevel: p.experienceLevel,
				preferredMode: p.preferredMode,
				isStudent: p.isStudent,
				interests: p.interests,
				showDemoEvents: p.showDemoEvents,
			}),
		onSuccess: (next) => {
			qc.setQueryData(["me"], next);
			invalidatePersonal(qc);
			void qc.invalidateQueries({ queryKey: ["stats"] });
			toast.success("Profile saved");
		},
		onError: (e) => toast.error(errorMessage(e)),
	});
	const tzOk = !p.timezone || isValidTimeZone(p.timezone);
	const toggleInterest = (id: TopicId, on: boolean) => setP({ ...p, interests: on ? [...p.interests, id] : p.interests.filter((x) => x !== id) });
	return (
		<form
			className="space-y-4"
			onSubmit={(e) => {
				e.preventDefault();
				if (tzOk) save.mutate();
			}}
		>
			<div className="grid gap-4 sm:grid-cols-2">
				<div>
					<Label htmlFor="displayName">Display name</Label>
					<Input id="displayName" value={p.displayName ?? ""} onChange={(e) => setP({ ...p, displayName: e.target.value || null })} maxLength={80} />
				</div>
				<div>
					<Label htmlFor="pcountry">Country</Label>
					<Input id="pcountry" value={p.country ?? ""} onChange={(e) => setP({ ...p, country: e.target.value || null })} maxLength={100} />
				</div>
				<div>
					<Label htmlFor="ptz">Timezone</Label>
					<Input id="ptz" list={tzList} value={p.timezone ?? ""} onChange={(e) => setP({ ...p, timezone: e.target.value || null })} placeholder={localTimeZone} aria-invalid={!tzOk} />
					<datalist id={tzList}>
						{listTimeZones().map((z) => (
							<option key={z} value={z} />
						))}
					</datalist>
					{!tzOk && <p className="mt-1 text-xs text-destructive">Unknown timezone</p>}
					<p className="mt-1 text-xs text-muted-foreground">Default for events you add. Pages always display times in this device's timezone ({localTimeZone}).</p>
				</div>
				<div>
					<Label htmlFor="exp">Experience level</Label>
					<select id="exp" className={selectClass} value={p.experienceLevel ?? ""} onChange={(e) => setP({ ...p, experienceLevel: (e.target.value || null) as ExperienceLevel | null })}>
						<option value="">Prefer not to say</option>
						{EXPERIENCE_LEVELS.map((l) => (
							<option key={l} value={l}>
								{l[0].toUpperCase() + l.slice(1)}
							</option>
						))}
					</select>
				</div>
				<div>
					<Label htmlFor="mode">Preferred participation</Label>
					<select id="mode" className={selectClass} value={p.preferredMode} onChange={(e) => setP({ ...p, preferredMode: e.target.value as PreferredMode })}>
						{PREFERRED_MODES.map((m) => (
							<option key={m} value={m}>
								{m === "any" ? "No preference" : PARTICIPATION_MODE_LABELS[m]}
							</option>
						))}
					</select>
				</div>
				<div>
					<Label htmlFor="student">Are you a student?</Label>
					<select id="student" className={selectClass} value={p.isStudent === null ? "" : p.isStudent ? "yes" : "no"} onChange={(e) => setP({ ...p, isStudent: e.target.value === "" ? null : e.target.value === "yes" })}>
						<option value="">Prefer not to say</option>
						<option value="yes">Yes</option>
						<option value="no">No</option>
					</select>
				</div>
			</div>
			<fieldset>
				<legend className="mb-2 text-sm font-medium">Interests (used for recommendations)</legend>
				<div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
					{TOPICS.map((t) => (
						<label key={t.id} className="flex cursor-pointer items-center gap-2 text-sm">
							<Checkbox checked={p.interests.includes(t.id)} onCheckedChange={(v) => toggleInterest(t.id, v === true)} />
							{t.label}
						</label>
					))}
				</div>
			</fieldset>
			<label className="flex items-center gap-3 text-sm">
				<Switch checked={p.showDemoEvents} onCheckedChange={(v) => setP({ ...p, showDemoEvents: v })} />
				Show demo (fictional sample) events
			</label>
			<Button type="submit" disabled={save.isPending || !tzOk}>
				Save profile
			</Button>
		</form>
	);
}

function PasswordForm() {
	const [current, setCurrent] = useState("");
	const [next, setNext] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	return (
		<form
			className="grid max-w-md gap-3"
			onSubmit={async (e) => {
				e.preventDefault();
				setError(null);
				if (next.length < 10) return setError("New password must be at least 10 characters.");
				setPending(true);
				const res = await authClient.changePassword({ currentPassword: current, newPassword: next, revokeOtherSessions: true });
				setPending(false);
				if (res.error) return setError(res.error.message ?? "Could not change password");
				setCurrent("");
				setNext("");
				toast.success("Password changed. Other sessions were signed out.");
			}}
		>
			<div>
				<Label htmlFor="cur">Current password</Label>
				<Input id="cur" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
			</div>
			<div>
				<Label htmlFor="new">New password</Label>
				<Input id="new" type="password" autoComplete="new-password" minLength={10} value={next} onChange={(e) => setNext(e.target.value)} required />
			</div>
			{error && (
				<p role="alert" className="text-sm text-destructive">
					{error}
				</p>
			)}
			<Button type="submit" variant="outline" disabled={pending} className="justify-self-start">
				Change password
			</Button>
		</form>
	);
}

function DangerZone() {
	const qc = useQueryClient();
	const navigate = useNavigate();
	const [confirm, setConfirm] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const wipe = useMutation({
		mutationFn: deleteMyData,
		onSuccess: () => {
			toast.success("Your tracking data was deleted");
			setConfirm("");
			invalidatePersonal(qc);
		},
		onError: (e) => toast.error(errorMessage(e)),
	});
	const exp = useMutation({ mutationFn: (s: "mine" | "saved" | "tracked") => exportCsv(s), onError: (e) => toast.error(errorMessage(e)) });
	return (
		<div className="space-y-5">
			<div>
				<h3 className="text-sm font-medium">Export your data</h3>
				<div className="mt-2 flex flex-wrap gap-2">
					<Button size="sm" variant="outline" onClick={() => exp.mutate("tracked")}>
						Tracker CSV
					</Button>
					<Button size="sm" variant="outline" onClick={() => exp.mutate("saved")}>
						Saved CSV
					</Button>
					<Button size="sm" variant="outline" onClick={() => exp.mutate("mine")}>
						My events CSV
					</Button>
				</div>
			</div>
			<div>
				<h3 className="text-sm font-medium">Delete tracking data</h3>
				<p className="text-sm text-muted-foreground">Removes your tracker, saved events, collections, notes, milestones, notifications, activity and private events. Your account stays.</p>
				<div className="mt-2 flex max-w-md gap-2">
					<Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder='Type "DELETE" to confirm' aria-label="Confirm deletion" />
					<Button variant="destructive" disabled={confirm !== "DELETE" || wipe.isPending} onClick={() => wipe.mutate()}>
						Delete data
					</Button>
				</div>
			</div>
			<div>
				<h3 className="text-sm font-medium">Delete account</h3>
				<p className="text-sm text-muted-foreground">Permanently deletes your account and all private data. Events you published to the shared feed remain, without your name.</p>
				<AlertDialog>
					<AlertDialogTrigger asChild>
						<Button variant="outline" className="mt-2 border-destructive/40 text-destructive">
							Delete account…
						</Button>
					</AlertDialogTrigger>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>Delete your HackRadar account?</AlertDialogTitle>
							<AlertDialogDescription>This cannot be undone. Enter your password to confirm.</AlertDialogDescription>
						</AlertDialogHeader>
						<Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" aria-label="Password" />
						{error && <p className="text-sm text-destructive">{error}</p>}
						<AlertDialogFooter>
							<AlertDialogCancel>Cancel</AlertDialogCancel>
							<AlertDialogAction
								className="bg-destructive text-white hover:bg-destructive/90"
								onClick={async (e) => {
									e.preventDefault();
									setError(null);
									const res = await authClient.deleteUser({ password });
									if (res.error) return setError(res.error.message ?? "Could not delete account");
									qc.clear();
									toast.success("Account deleted");
									navigate("/");
								}}
							>
								Delete account
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			</div>
		</div>
	);
}

export function SettingsPage() {
	const { user } = useMe();
	const { theme, setTheme } = useTheme();
	if (!user) return null;
	return (
		<div className="max-w-3xl space-y-5">
			<PageHeader title="Settings" description={`Signed in as ${user.email}`} />
			<Card title="Profile & preferences" description="Used to personalise recommendations. Never shared.">
				<ProfileForm key={JSON.stringify(user)} profile={user} />
			</Card>
			<Card title="Notifications" description="Reminders are processed hourly by HackRadar's scheduler and are never sent twice.">
				<PreferencesForm />
			</Card>
			<Card title="Appearance">
				<RadioGroup value={theme ?? "system"} onValueChange={setTheme} className="flex gap-6" aria-label="Theme">
					{["light", "dark", "system"].map((t) => (
						<label key={t} className="flex cursor-pointer items-center gap-2 text-sm capitalize">
							<RadioGroupItem value={t} /> {t}
						</label>
					))}
				</RadioGroup>
			</Card>
			<Card title="Password">
				<PasswordForm />
			</Card>
			<Card title="Your data" description="Export or delete your personal data at any time.">
				<DangerZone />
			</Card>
		</div>
	);
}
