import { useId, useState, type ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Button } from "@/components/ui/button";
import {
	DEADLINE_WINDOWS,
	DEADLINE_WINDOW_LABELS,
	EVENT_STATUSES,
	EVENT_STATUS_LABELS,
	PARTICIPATION_MODES,
	PARTICIPATION_MODE_LABELS,
	PLATFORM_IDS,
	PLATFORM_LABELS,
	REGISTRATION_STATUSES,
	REGISTRATION_STATUS_LABELS,
	TOPICS,
} from "@shared/constants";
import type { DiscoverFilters } from "./discover-params";

function Section({ title, children, hint }: { title: string; children: ReactNode; hint?: string }) {
	return (
		<fieldset className="space-y-2 border-b pb-4 last:border-0">
			<legend className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</legend>
			{hint && <p className="-mt-1 text-[11px] text-muted-foreground">{hint}</p>}
			{children}
		</fieldset>
	);
}

function CheckRow({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
	const id = useId();
	return (
		<div className="flex items-center gap-2">
			<Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} />
			<Label htmlFor={id} className="cursor-pointer text-sm font-normal">
				{label}
			</Label>
		</div>
	);
}

function toggle<T>(list: T[], value: T, on: boolean): T[] {
	return on ? [...new Set([...list, value])] : list.filter((v) => v !== value);
}

/** Text input that commits on blur / Enter rather than on every keystroke. */
function CommitInput({ value, onCommit, ...props }: { value: string; onCommit: (v: string) => void } & Omit<React.ComponentProps<typeof Input>, "value" | "onChange">) {
	const [draft, setDraft] = useState(value);
	// Reset the draft when the committed value changes from outside (e.g. "Clear all").
	const [committed, setCommitted] = useState(value);
	if (committed !== value) {
		setCommitted(value);
		setDraft(value);
	}
	return (
		<Input
			{...props}
			value={draft}
			onChange={(e) => setDraft(e.target.value)}
			onBlur={() => draft !== value && onCommit(draft)}
			onKeyDown={(e) => {
				if (e.key === "Enter") onCommit(draft);
			}}
		/>
	);
}

export function FilterPanel({ filters: f, onChange, signedIn }: { filters: DiscoverFilters; onChange: (f: DiscoverFilters) => void; signedIn: boolean }) {
	const [showAllTopics, setShowAllTopics] = useState(false);
	const set = (patch: Partial<DiscoverFilters>) => onChange({ ...f, ...patch, page: 1 });
	const topics = showAllTopics ? TOPICS : TOPICS.slice(0, 8);
	const deadlineId = useId();

	return (
		<div className="space-y-4 text-sm">
			{signedIn && (
				<Section title="Personal">
					<CheckRow label="Saved only" checked={f.saved} onChange={(v) => set({ saved: v })} />
					<CheckRow label="In my tracker" checked={f.tracked} onChange={(v) => set({ tracked: v })} />
					<CheckRow label="Added by me" checked={f.mine} onChange={(v) => set({ mine: v })} />
				</Section>
			)}

			<Section title="Platform">
				{PLATFORM_IDS.map((p) => (
					<CheckRow key={p} label={PLATFORM_LABELS[p]} checked={f.platforms.includes(p)} onChange={(v) => set({ platforms: toggle(f.platforms, p, v) })} />
				))}
			</Section>

			<Section title="Registration" hint="Estimated from stored dates. “Open” includes closing soon.">
				{REGISTRATION_STATUSES.map((s) => (
					<CheckRow key={s} label={REGISTRATION_STATUS_LABELS[s]} checked={f.registration.includes(s)} onChange={(v) => set({ registration: toggle(f.registration, s, v) })} />
				))}
			</Section>

			<Section title="Deadline">
				<RadioGroup value={f.deadline || "any"} onValueChange={(v) => set({ deadline: v === "any" ? "" : (v as DiscoverFilters["deadline"]) })} aria-label="Deadline window">
					{(["any", ...DEADLINE_WINDOWS] as const).map((w) => (
						<div key={w} className="flex items-center gap-2">
							<RadioGroupItem id={`${deadlineId}-${w}`} value={w} />
							<Label htmlFor={`${deadlineId}-${w}`} className="cursor-pointer text-sm font-normal">
								{w === "any" ? "Any time" : DEADLINE_WINDOW_LABELS[w]}
							</Label>
						</div>
					))}
				</RadioGroup>
				{f.deadline === "custom" && (
					<div className="grid grid-cols-2 gap-2 pt-1">
						<div>
							<Label htmlFor={`${deadlineId}-from`} className="text-xs text-muted-foreground">
								From
							</Label>
							<Input id={`${deadlineId}-from`} type="date" value={f.deadlineFrom} onChange={(e) => set({ deadlineFrom: e.target.value })} className="h-8" />
						</div>
						<div>
							<Label htmlFor={`${deadlineId}-to`} className="text-xs text-muted-foreground">
								To
							</Label>
							<Input id={`${deadlineId}-to`} type="date" value={f.deadlineTo} onChange={(e) => set({ deadlineTo: e.target.value })} className="h-8" />
						</div>
					</div>
				)}
			</Section>

			<Section title="Event status">
				{EVENT_STATUSES.map((s) => (
					<CheckRow key={s} label={EVENT_STATUS_LABELS[s]} checked={f.status.includes(s)} onChange={(v) => set({ status: toggle(f.status, s, v) })} />
				))}
			</Section>

			<Section title="Participation">
				{PARTICIPATION_MODES.map((m) => (
					<CheckRow key={m} label={PARTICIPATION_MODE_LABELS[m]} checked={f.modes.includes(m)} onChange={(v) => set({ modes: toggle(f.modes, m, v) })} />
				))}
			</Section>

			<Section title="Topics">
				{topics.map((t) => (
					<CheckRow key={t.id} label={t.label} checked={f.topics.includes(t.id)} onChange={(v) => set({ topics: toggle(f.topics, t.id, v) })} />
				))}
				<Button variant="link" size="sm" className="h-auto px-0" onClick={() => setShowAllTopics((s) => !s)}>
					{showAllTopics ? "Show fewer topics" : `Show all ${TOPICS.length} topics`}
				</Button>
			</Section>

			<Section title="Eligibility & cost" hint="Matches only events that explicitly state this — unknown is never treated as yes.">
				<CheckRow label="Beginner-friendly" checked={f.beginner} onChange={(v) => set({ beginner: v })} />
				<CheckRow label="Open to students" checked={f.students} onChange={(v) => set({ students: v })} />
				<CheckRow label="Open internationally" checked={f.international} onChange={(v) => set({ international: v })} />
				<CheckRow label="Free to participate" checked={f.free} onChange={(v) => set({ free: v })} />
			</Section>

			<Section title="Prize & team" hint="Prize amounts are compared within one currency only.">
				<div className="grid grid-cols-[1fr_5rem] gap-2">
					<div>
						<Label htmlFor="minPrize" className="text-xs text-muted-foreground">
							Minimum prize
						</Label>
						<CommitInput id="minPrize" type="number" min={0} inputMode="numeric" placeholder="e.g. 1000" className="h-8" value={f.minPrize} onCommit={(v) => set({ minPrize: v })} />
					</div>
					<div>
						<Label htmlFor="prizeCurrency" className="text-xs text-muted-foreground">
							Currency
						</Label>
						<CommitInput
							id="prizeCurrency"
							maxLength={3}
							placeholder="USD"
							className="h-8 uppercase"
							value={f.prizeCurrency}
							onCommit={(v) => set({ prizeCurrency: v.toUpperCase().slice(0, 3) })}
						/>
					</div>
				</div>
				<div>
					<Label htmlFor="teamSize" className="text-xs text-muted-foreground">
						My team size
					</Label>
					<CommitInput id="teamSize" type="number" min={1} max={100} inputMode="numeric" placeholder="e.g. 3" className="h-8" value={f.teamSize} onCommit={(v) => set({ teamSize: v })} />
				</div>
			</Section>

			<Section title="Location & organizer">
				<div>
					<Label htmlFor="country" className="text-xs text-muted-foreground">
						Country or city
					</Label>
					<CommitInput id="country" placeholder="e.g. India" className="h-8" value={f.country} onCommit={(v) => set({ country: v })} />
				</div>
				<div>
					<Label htmlFor="organizer" className="text-xs text-muted-foreground">
						Organizer
					</Label>
					<CommitInput id="organizer" placeholder="Organizer name" className="h-8" value={f.organizer} onCommit={(v) => set({ organizer: v })} />
				</div>
			</Section>
		</div>
	);
}
