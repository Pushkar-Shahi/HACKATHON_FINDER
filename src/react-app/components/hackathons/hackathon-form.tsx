// Add / edit hackathon form. Client-side validation uses the same Zod schema
// as the server (hackathonInputSchema); the server re-validates regardless.
import { useEffect, useId, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { useForm, type FieldPath, type UseFormRegisterReturn } from "react-hook-form";
import { z } from "zod";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { zodResolver } from "@/lib/zod-resolver";
import { ApiError } from "@/lib/api";
import { localTimeZone } from "@/lib/format";
import { checkDuplicates, type DuplicateMatch } from "@/services/hackathons";
import { useDebouncedValue } from "@/hooks/use-utils";
import { hackathonInputSchema, isValidTimeZone, type HackathonInput, type HackathonInputRaw } from "@shared/schemas";
import { listTimeZones, utcToWallTime, wallTimeToUtc } from "@shared/time";
import { PARTICIPATION_MODES, PARTICIPATION_MODE_LABELS, PLATFORM_IDS, PLATFORM_LABELS, TOPICS } from "@shared/constants";
import type { HackathonDetail } from "@shared/types";

const tri = z.enum(["unknown", "yes", "no"]);
const DATE_FIELDS = ["registrationOpenAt", "registrationDeadlineAt", "eventStartAt", "eventEndAt"] as const;

const formFields = z.object({
	title: z.string(),
	organizer: z.string(),
	platform: z.enum(PLATFORM_IDS),
	canonicalUrl: z.string(),
	registrationUrl: z.string(),
	description: z.string(),
	registrationOpenAt: z.string(),
	registrationDeadlineAt: z.string(),
	eventStartAt: z.string(),
	eventEndAt: z.string(),
	eventTimezone: z.string(),
	participationMode: z.union([z.enum(PARTICIPATION_MODES), z.literal("")]),
	location: z.string(),
	country: z.string(),
	topics: z.array(z.string()),
	technologies: z.string(),
	prizeAmount: z.string(),
	prizeCurrency: z.string(),
	prizeDetails: z.string(),
	teamSizeMin: z.string(),
	teamSizeMax: z.string(),
	participationFeeAmount: z.string(),
	participationFeeCurrency: z.string(),
	eligibilitySummary: z.string(),
	eligibilityDetails: z.string(),
	isStudentEligible: tri,
	isBeginnerFriendly: tri,
	isInternational: tri,
	additionalNotes: z.string(),
});
export type HackathonFormValues = z.input<typeof formFields>;

const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(/[,\s]/g, "")));
const triToBool = (v: "unknown" | "yes" | "no") => (v === "unknown" ? null : v === "yes");
const boolToTri = (v: boolean | null) => (v === null ? "unknown" : v ? "yes" : "no");

const formSchema = formFields
	.superRefine((v, ctx) => {
		const anyDate = DATE_FIELDS.some((f) => v[f]);
		if (anyDate && !isValidTimeZone(v.eventTimezone)) {
			ctx.addIssue({ code: "custom", path: ["eventTimezone"], message: "Choose the timezone these dates are in (e.g. Asia/Kolkata)" });
		}
		for (const f of DATE_FIELDS) {
			if (v[f] && isValidTimeZone(v.eventTimezone) && !wallTimeToUtc(v[f], v.eventTimezone)) {
				ctx.addIssue({ code: "custom", path: [f], message: "Not a valid date and time" });
			}
		}
	})
	.transform((v): HackathonInputRaw => {
		const toIso = (s: string) => (s && isValidTimeZone(v.eventTimezone) ? (wallTimeToUtc(s, v.eventTimezone)?.toISOString() ?? null) : null);
		const anyDate = DATE_FIELDS.some((f) => v[f]);
		return {
			title: v.title,
			organizer: v.organizer || null,
			platform: v.platform,
			canonicalUrl: v.canonicalUrl.trim(),
			registrationUrl: v.registrationUrl.trim() || null,
			description: v.description || null,
			registrationOpenAt: toIso(v.registrationOpenAt),
			registrationDeadlineAt: toIso(v.registrationDeadlineAt),
			eventStartAt: toIso(v.eventStartAt),
			eventEndAt: toIso(v.eventEndAt),
			eventTimezone: anyDate || v.eventTimezone ? v.eventTimezone || null : null,
			participationMode: v.participationMode || null,
			location: v.location || null,
			country: v.country || null,
			topics: v.topics as HackathonInputRaw["topics"],
			technologies: v.technologies
				.split(",")
				.map((t) => t.trim())
				.filter(Boolean),
			prizeAmount: num(v.prizeAmount),
			prizeCurrency: v.prizeCurrency.trim() || null,
			prizeDetails: v.prizeDetails || null,
			teamSizeMin: num(v.teamSizeMin),
			teamSizeMax: num(v.teamSizeMax),
			participationFeeAmount: num(v.participationFeeAmount),
			participationFeeCurrency: v.participationFeeCurrency.trim() || null,
			eligibilitySummary: v.eligibilitySummary || null,
			eligibilityDetails: v.eligibilityDetails || null,
			isStudentEligible: triToBool(v.isStudentEligible),
			isBeginnerFriendly: triToBool(v.isBeginnerFriendly),
			isInternational: triToBool(v.isInternational),
			sourceStatus: null,
			additionalNotes: v.additionalNotes || null,
		};
	})
	.pipe(hackathonInputSchema);

export function emptyFormValues(timezone: string): HackathonFormValues {
	return {
		title: "",
		organizer: "",
		platform: "other",
		canonicalUrl: "",
		registrationUrl: "",
		description: "",
		registrationOpenAt: "",
		registrationDeadlineAt: "",
		eventStartAt: "",
		eventEndAt: "",
		eventTimezone: timezone,
		participationMode: "",
		location: "",
		country: "",
		topics: [],
		technologies: "",
		prizeAmount: "",
		prizeCurrency: "",
		prizeDetails: "",
		teamSizeMin: "",
		teamSizeMax: "",
		participationFeeAmount: "",
		participationFeeCurrency: "",
		eligibilitySummary: "",
		eligibilityDetails: "",
		isStudentEligible: "unknown",
		isBeginnerFriendly: "unknown",
		isInternational: "unknown",
		additionalNotes: "",
	};
}

export function detailToFormValues(h: HackathonDetail, fallbackTz: string): HackathonFormValues {
	const tz = h.eventTimezone ?? fallbackTz;
	const wall = (iso: string | null) => (iso ? utcToWallTime(iso, tz) : "");
	const s = (v: string | number | null) => (v === null ? "" : String(v));
	return {
		title: h.title,
		organizer: h.organizer ?? "",
		platform: h.platform,
		canonicalUrl: h.canonicalUrl,
		registrationUrl: h.registrationUrl ?? "",
		description: h.description ?? "",
		registrationOpenAt: wall(h.registrationOpenAt),
		registrationDeadlineAt: wall(h.registrationDeadlineAt),
		eventStartAt: wall(h.eventStartAt),
		eventEndAt: wall(h.eventEndAt),
		eventTimezone: tz,
		participationMode: h.participationMode ?? "",
		location: h.location ?? "",
		country: h.country ?? "",
		topics: h.topics,
		technologies: h.technologies.join(", "),
		prizeAmount: s(h.prizeAmount),
		prizeCurrency: h.prizeCurrency ?? "",
		prizeDetails: h.prizeDetails ?? "",
		teamSizeMin: s(h.teamSizeMin),
		teamSizeMax: s(h.teamSizeMax),
		participationFeeAmount: s(h.participationFeeAmount),
		participationFeeCurrency: h.participationFeeCurrency ?? "",
		eligibilitySummary: h.eligibilitySummary ?? "",
		eligibilityDetails: h.eligibilityDetails ?? "",
		isStudentEligible: boolToTri(h.isStudentEligible),
		isBeginnerFriendly: boolToTri(h.isBeginnerFriendly),
		isInternational: boolToTri(h.isInternational),
		additionalNotes: h.additionalNotes ?? "",
	};
}

function Field({ label, error, hint, children, htmlFor, required }: { label: string; error?: string; hint?: ReactNode; children: ReactNode; htmlFor: string; required?: boolean }) {
	return (
		<div className="space-y-1.5">
			<Label htmlFor={htmlFor}>
				{label}
				{required && <span className="text-destructive"> *</span>}
			</Label>
			{children}
			{hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
			{error && (
				<p role="alert" className="text-xs text-destructive">
					{error}
				</p>
			)}
		</div>
	);
}

function Fieldset({ title, children, description }: { title: string; children: ReactNode; description?: string }) {
	return (
		<fieldset className="rounded-lg border bg-card p-4">
			<legend className="px-1 text-sm font-semibold">{title}</legend>
			{description && <p className="mb-3 text-xs text-muted-foreground">{description}</p>}
			<div className="grid gap-4 sm:grid-cols-2">{children}</div>
		</fieldset>
	);
}

function TriSelect({ id, reg }: { id: string; reg: UseFormRegisterReturn }) {
	return (
		<select id={id} {...reg} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none dark:bg-input/30">
			<option value="unknown">Not stated</option>
			<option value="yes">Yes</option>
			<option value="no">No</option>
		</select>
	);
}

const selectClass =
	"h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none dark:bg-input/30";

export function HackathonForm({
	initial,
	excludeId,
	submitLabel,
	onSubmit,
	extra,
}: {
	initial: HackathonFormValues;
	excludeId?: string;
	submitLabel: string;
	onSubmit: (input: HackathonInput) => Promise<void>;
	extra?: ReactNode;
}) {
	const tzListId = useId();
	const [zones] = useState(() => listTimeZones());
	const [formError, setFormError] = useState<string | null>(null);
	const form = useForm<HackathonFormValues, unknown, HackathonInput>({ resolver: zodResolver(formSchema), defaultValues: initial, mode: "onBlur" });
	const { register, handleSubmit, formState, watch, setError, setValue } = form;
	const errors = formState.errors as Record<string, { message?: string } | undefined>;
	const err = (k: FieldPath<HackathonFormValues>) => errors[k]?.message;

	// Duplicate warning (non-blocking): same URL or same title as something you can already see.
	const [title, url] = watch(["title", "canonicalUrl"]);
	const debounced = useDebouncedValue(`${title}\u0000${url}`, 600);
	const [dups, setDups] = useState<DuplicateMatch[]>([]);
	useEffect(() => {
		const [t, u] = debounced.split("\u0000");
		if (t.trim().length < 3 || !/^https?:\/\/.+\..+/.test(u.trim())) {
			setDups([]);
			return;
		}
		let cancelled = false;
		checkDuplicates({ title: t.trim(), canonicalUrl: u.trim(), excludeId })
			.then((m) => !cancelled && setDups(m))
			.catch(() => !cancelled && setDups([]));
		return () => {
			cancelled = true;
		};
	}, [debounced, excludeId]);

	const submit = handleSubmit(async (input) => {
		setFormError(null);
		try {
			await onSubmit(input);
		} catch (e) {
			if (e instanceof ApiError && e.fields) {
				for (const [k, msgs] of Object.entries(e.fields)) {
					setError(k as FieldPath<HackathonFormValues>, { message: msgs[0] });
				}
			}
			setFormError(e instanceof Error ? e.message : "Could not save");
		}
	});

	const topics = watch("topics");
	const tz = watch("eventTimezone");

	return (
		<form onSubmit={submit} className="space-y-5" noValidate>
			<Fieldset title="Basics">
				<div className="sm:col-span-2">
					<Field label="Event title" htmlFor="title" error={err("title")} required>
						<Input id="title" {...register("title")} maxLength={200} aria-invalid={Boolean(err("title"))} />
					</Field>
				</div>
				<Field label="Official event URL" htmlFor="canonicalUrl" error={err("canonicalUrl")} required hint="The event's own page (https://…).">
					<Input id="canonicalUrl" type="url" inputMode="url" {...register("canonicalUrl")} placeholder="https://" aria-invalid={Boolean(err("canonicalUrl"))} />
				</Field>
				<Field label="Registration URL" htmlFor="registrationUrl" error={err("registrationUrl")} hint="Where people actually register, if different.">
					<Input id="registrationUrl" type="url" inputMode="url" {...register("registrationUrl")} placeholder="https://" />
				</Field>
				<Field label="Platform" htmlFor="platform" error={err("platform")} hint="Where the event is listed.">
					<select id="platform" {...register("platform")} className={selectClass}>
						{PLATFORM_IDS.map((p) => (
							<option key={p} value={p}>
								{PLATFORM_LABELS[p]}
							</option>
						))}
					</select>
				</Field>
				<Field label="Organizer" htmlFor="organizer" error={err("organizer")}>
					<Input id="organizer" {...register("organizer")} maxLength={200} />
				</Field>
				<div className="sm:col-span-2">
					<Field label="Description" htmlFor="description" error={err("description")}>
						<Textarea id="description" rows={5} {...register("description")} maxLength={10000} />
					</Field>
				</div>
				{dups.length > 0 && (
					<div role="status" className="rounded-md border border-warning/30 bg-warning-soft p-3 text-sm text-warning sm:col-span-2">
						<p className="flex items-center gap-1.5 font-medium">
							<AlertTriangle className="size-4" /> Possible duplicate{dups.length > 1 ? "s" : ""}
						</p>
						<ul className="mt-1 space-y-0.5 text-xs">
							{dups.map((d) => (
								<li key={d.hackathonId}>
									<Link to={`/hackathons/${d.hackathonId}`} target="_blank" className="font-medium underline">
										{d.title}
									</Link>{" "}
									— {d.reasons.join(", ")} ({d.confidence})
								</li>
							))}
						</ul>
						<p className="mt-1 text-xs">You can still save; consider saving or tracking the existing event instead.</p>
					</div>
				)}
			</Fieldset>

			<Fieldset title="Important dates" description="Enter dates as shown on the official page, and the timezone they are in. HackRadar stores them in UTC and never guesses a timezone.">
				<div className="sm:col-span-2">
					<Field
						label="Timezone of these dates"
						htmlFor="eventTimezone"
						error={err("eventTimezone")}
						hint={
							<>
								IANA name, e.g. Asia/Kolkata or America/New_York.{" "}
								{tz !== localTimeZone && (
									<button type="button" className="underline" onClick={() => setValue("eventTimezone", localTimeZone, { shouldValidate: true })}>
										Use mine ({localTimeZone})
									</button>
								)}
							</>
						}
					>
						<Input id="eventTimezone" list={tzListId} {...register("eventTimezone")} autoComplete="off" />
						<datalist id={tzListId}>
							{zones.map((z) => (
								<option key={z} value={z} />
							))}
						</datalist>
					</Field>
				</div>
				<Field label="Registration opens" htmlFor="registrationOpenAt" error={err("registrationOpenAt")}>
					<Input id="registrationOpenAt" type="datetime-local" {...register("registrationOpenAt")} />
				</Field>
				<Field label="Registration deadline" htmlFor="registrationDeadlineAt" error={err("registrationDeadlineAt")} hint="Leave empty if not announced — it will show as unverified.">
					<Input id="registrationDeadlineAt" type="datetime-local" {...register("registrationDeadlineAt")} />
				</Field>
				<Field label="Event starts" htmlFor="eventStartAt" error={err("eventStartAt")}>
					<Input id="eventStartAt" type="datetime-local" {...register("eventStartAt")} />
				</Field>
				<Field label="Event ends" htmlFor="eventEndAt" error={err("eventEndAt")}>
					<Input id="eventEndAt" type="datetime-local" {...register("eventEndAt")} />
				</Field>
			</Fieldset>

			<Fieldset title="Format & location">
				<Field label="Participation mode" htmlFor="participationMode" error={err("participationMode")}>
					<select id="participationMode" {...register("participationMode")} className={selectClass}>
						<option value="">Not stated</option>
						{PARTICIPATION_MODES.map((m) => (
							<option key={m} value={m}>
								{PARTICIPATION_MODE_LABELS[m]}
							</option>
						))}
					</select>
				</Field>
				<Field label="Location" htmlFor="location" error={err("location")}>
					<Input id="location" {...register("location")} maxLength={200} placeholder="City, venue…" />
				</Field>
				<Field label="Country" htmlFor="country" error={err("country")}>
					<Input id="country" {...register("country")} maxLength={100} />
				</Field>
			</Fieldset>

			<fieldset className="rounded-lg border bg-card p-4">
				<legend className="px-1 text-sm font-semibold">Topics & technologies</legend>
				<div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
					{TOPICS.map((t) => (
						<label key={t.id} className="flex cursor-pointer items-center gap-2 text-sm">
							<Checkbox
								checked={topics.includes(t.id)}
								onCheckedChange={(v) =>
									setValue("topics", v === true ? [...topics, t.id] : topics.filter((x) => x !== t.id), { shouldDirty: true })
								}
							/>
							{t.label}
						</label>
					))}
				</div>
				{err("topics") && <p className="mt-2 text-xs text-destructive">{err("topics")}</p>}
				<div className="mt-4">
					<Field label="Technologies" htmlFor="technologies" error={err("technologies")} hint="Comma-separated, e.g. Python, React, LangChain.">
						<Input id="technologies" {...register("technologies")} />
					</Field>
				</div>
			</fieldset>

			<Fieldset title="Prizes, team & fees" description="Leave anything you don't know empty — it will be shown as not stated, never guessed.">
				<Field label="Prize amount" htmlFor="prizeAmount" error={err("prizeAmount")}>
					<Input id="prizeAmount" inputMode="decimal" {...register("prizeAmount")} placeholder="e.g. 10000" />
				</Field>
				<Field label="Prize currency" htmlFor="prizeCurrency" error={err("prizeCurrency")} hint="ISO code: USD, INR, EUR…">
					<Input id="prizeCurrency" {...register("prizeCurrency")} maxLength={3} className="uppercase" />
				</Field>
				<div className="sm:col-span-2">
					<Field label="Prize details" htmlFor="prizeDetails" error={err("prizeDetails")}>
						<Textarea id="prizeDetails" rows={2} {...register("prizeDetails")} maxLength={2000} />
					</Field>
				</div>
				<Field label="Minimum team size" htmlFor="teamSizeMin" error={err("teamSizeMin")}>
					<Input id="teamSizeMin" inputMode="numeric" {...register("teamSizeMin")} />
				</Field>
				<Field label="Maximum team size" htmlFor="teamSizeMax" error={err("teamSizeMax")}>
					<Input id="teamSizeMax" inputMode="numeric" {...register("teamSizeMax")} />
				</Field>
				<Field label="Participation fee" htmlFor="participationFeeAmount" error={err("participationFeeAmount")} hint="0 = free to enter.">
					<Input id="participationFeeAmount" inputMode="decimal" {...register("participationFeeAmount")} />
				</Field>
				<Field label="Fee currency" htmlFor="participationFeeCurrency" error={err("participationFeeCurrency")}>
					<Input id="participationFeeCurrency" {...register("participationFeeCurrency")} maxLength={3} className="uppercase" />
				</Field>
			</Fieldset>

			<Fieldset title="Eligibility">
				<div className="sm:col-span-2">
					<Field label="Eligibility summary" htmlFor="eligibilitySummary" error={err("eligibilitySummary")}>
						<Input id="eligibilitySummary" {...register("eligibilitySummary")} maxLength={500} placeholder="e.g. Open to university students worldwide" />
					</Field>
				</div>
				<Field label="Open to students?" htmlFor="isStudentEligible">
					<TriSelect id="isStudentEligible" reg={register("isStudentEligible")} />
				</Field>
				<Field label="Beginner-friendly?" htmlFor="isBeginnerFriendly">
					<TriSelect id="isBeginnerFriendly" reg={register("isBeginnerFriendly")} />
				</Field>
				<Field label="Open internationally?" htmlFor="isInternational">
					<TriSelect id="isInternational" reg={register("isInternational")} />
				</Field>
				<div className="sm:col-span-2">
					<Field label="Eligibility details" htmlFor="eligibilityDetails" error={err("eligibilityDetails")}>
						<Textarea id="eligibilityDetails" rows={3} {...register("eligibilityDetails")} maxLength={5000} />
					</Field>
				</div>
				<div className="sm:col-span-2">
					<Field label="Additional notes" htmlFor="additionalNotes" error={err("additionalNotes")} hint="Registration instructions or anything else useful.">
						<Textarea id="additionalNotes" rows={3} {...register("additionalNotes")} maxLength={5000} />
					</Field>
				</div>
			</Fieldset>

			{extra}

			{formError && (
				<p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
					{formError}
				</p>
			)}
			{Object.keys(errors).length > 0 && !formError && <p className="text-sm text-destructive">Please fix the highlighted fields.</p>}
			<div className="flex gap-2">
				<Button type="submit" disabled={formState.isSubmitting}>
					{formState.isSubmitting ? "Saving…" : submitLabel}
				</Button>
			</div>
		</form>
	);
}
