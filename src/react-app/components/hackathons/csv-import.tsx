import { useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, Download, FileUp, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { importCsv, previewCsv } from "@/services/hackathons";
import { errorMessage, saveBlob } from "@/lib/api";
import { invalidatePersonal } from "@/lib/query-client";
import { MAX_CSV_BYTES, MAX_CSV_ROWS } from "@shared/constants";
import type { CsvImportResult, CsvPreview } from "@shared/types";
import { cn } from "@/lib/utils";

const TEMPLATE = [
	"title,official_url,platform,organizer,registration_opens,registration_deadline,event_start,event_end,timezone,mode,location,country,topics,technologies,prize_amount,prize_currency,team_size_min,team_size_max,participation_fee,fee_currency,eligibility,student_eligible,beginner_friendly,international,description,notes",
	'Example AI Hackathon,https://example.com/your-event,devpost,Example Org,2026-11-01 09:00,2026-11-20 23:59,2026-11-25 09:00,2026-11-27 18:00,Asia/Kolkata,online,,,AI;Machine learning,Python;PyTorch,"5,000",USD,1,4,0,,Open to students,yes,yes,,"Replace this row with a real event",',
].join("\r\n");

const csvCell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : /^[=+\-@]/.test(v) ? `'${v}` : v);

export function CsvImport() {
	const qc = useQueryClient();
	const fileRef = useRef<HTMLInputElement>(null);
	const [csv, setCsv] = useState<string | null>(null);
	const [fileName, setFileName] = useState("");
	const [preview, setPreview] = useState<CsvPreview | null>(null);
	const [selected, setSelected] = useState<Set<number>>(new Set());
	const [result, setResult] = useState<CsvImportResult | null>(null);
	const [fileError, setFileError] = useState<string | null>(null);

	const previewMut = useMutation({
		mutationFn: (text: string) => previewCsv(text),
		onSuccess: (p) => {
			setPreview(p);
			setSelected(new Set(p.rows.filter((r) => r.status === "valid").map((r) => r.row)));
		},
		onError: (e) => setFileError(errorMessage(e)),
	});
	const importMut = useMutation({
		mutationFn: () => importCsv(csv!, [...selected].sort((a, b) => a - b)),
		onSuccess: (r) => {
			setResult(r);
			toast.success(`Imported ${r.imported} hackathon${r.imported === 1 ? "" : "s"}`);
			invalidatePersonal(qc);
		},
		onError: (e) => toast.error(errorMessage(e)),
	});

	const reset = () => {
		setCsv(null);
		setPreview(null);
		setSelected(new Set());
		setResult(null);
		setFileError(null);
		setFileName("");
		if (fileRef.current) fileRef.current.value = "";
	};

	const onFile = async (file: File | undefined) => {
		setFileError(null);
		setPreview(null);
		setResult(null);
		if (!file) return;
		if (!/\.csv$/i.test(file.name) && !["text/csv", "application/vnd.ms-excel", "text/plain"].includes(file.type)) {
			setFileError("Please choose a .csv file.");
			return;
		}
		if (file.size > MAX_CSV_BYTES) {
			setFileError("CSV files are limited to 1 MB.");
			return;
		}
		const text = await file.text();
		setFileName(file.name);
		setCsv(text);
		previewMut.mutate(text);
	};

	const errorReport = useMemo(() => {
		if (!preview) return null;
		const bad = preview.rows.filter((r) => r.status !== "valid");
		if (!bad.length) return null;
		const lines = ["row,status,title,official_url,problems", ...bad.map((r) => [String(r.row), r.status, r.title ?? "", r.canonicalUrl ?? "", r.errors.concat(r.duplicateOf ? [`${r.duplicateOf.reason}: ${r.duplicateOf.title}`] : []).join(" | ")].map(csvCell).join(","))];
		return lines.join("\r\n") + "\r\n";
	}, [preview]);

	if (result) {
		return (
			<div className="rounded-lg border bg-card p-6 text-center">
				<CheckCircle2 className="mx-auto size-8 text-success" />
				<h3 className="mt-2 font-semibold">Imported {result.imported} hackathons</h3>
				<p className="text-sm text-muted-foreground">{result.skipped} row(s) were not imported. Imported events are private to you.</p>
				<div className="mt-4 flex justify-center gap-2">
					<Button asChild>
						<Link to="/discover?mine=true&sort=recent">View imported events</Link>
					</Button>
					<Button variant="outline" onClick={reset}>
						Import another file
					</Button>
				</div>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			<div className="rounded-lg border bg-card p-4">
				<h3 className="font-medium">1. Choose a CSV file</h3>
				<p className="mt-1 text-sm text-muted-foreground">
					Up to {MAX_CSV_ROWS} rows / 1 MB. Required columns: <code>title</code>, <code>official_url</code>. Dates use ISO 8601 with an offset, or <code>YYYY-MM-DD HH:MM</code> plus a{" "}
					<code>timezone</code> column. Lists use semicolons.
				</p>
				<div className="mt-3 flex flex-wrap items-center gap-2">
					<input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" id="csv-file" onChange={(e) => onFile(e.target.files?.[0])} />
					<Button asChild variant="outline">
						<label htmlFor="csv-file" className="cursor-pointer">
							<FileUp /> {fileName || "Choose file"}
						</label>
					</Button>
					<Button variant="ghost" size="sm" onClick={() => saveBlob(new Blob([TEMPLATE], { type: "text/csv" }), "hackradar-import-template.csv")}>
						<Download /> Download template
					</Button>
					{csv && (
						<Button variant="ghost" size="sm" onClick={reset}>
							<RotateCcw /> Start over
						</Button>
					)}
				</div>
				{fileError && (
					<p role="alert" className="mt-2 text-sm text-destructive">
						{fileError}
					</p>
				)}
				{previewMut.isPending && <p className="mt-2 text-sm text-muted-foreground">Validating…</p>}
			</div>

			{preview && (
				<div className="rounded-lg border bg-card p-4">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<h3 className="font-medium">2. Review rows</h3>
						<div className="flex flex-wrap gap-2 text-xs">
							<span className="rounded bg-success-soft px-2 py-0.5 text-success">{preview.validCount} ready</span>
							<span className="rounded bg-warning-soft px-2 py-0.5 text-warning">{preview.duplicateCount} likely duplicates</span>
							<span className="rounded bg-urgent-soft px-2 py-0.5 text-urgent">{preview.invalidCount} invalid</span>
						</div>
					</div>
					{preview.missingRequiredHeaders.length > 0 && (
						<p role="alert" className="mt-2 text-sm text-destructive">
							Missing required column(s): {preview.missingRequiredHeaders.join(", ")}
						</p>
					)}
					{preview.unknownHeaders.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Ignored columns: {preview.unknownHeaders.join(", ")}</p>}
					<div className="mt-3 max-h-[28rem] overflow-auto rounded-md border">
						<table className="w-full text-sm">
							<thead className="sticky top-0 bg-muted text-left text-xs text-muted-foreground">
								<tr>
									<th className="w-10 px-2 py-1.5">
										<span className="sr-only">Import</span>
									</th>
									<th className="w-12 px-2 py-1.5">Row</th>
									<th className="px-2 py-1.5">Title</th>
									<th className="px-2 py-1.5">Result</th>
								</tr>
							</thead>
							<tbody className="divide-y">
								{preview.rows.map((r) => (
									<tr key={r.row} className={cn(r.status === "invalid" && "bg-urgent-soft/40")}>
										<td className="px-2 py-1.5">
											<Checkbox
												disabled={r.status === "invalid"}
												checked={selected.has(r.row)}
												onCheckedChange={(v) =>
													setSelected((s) => {
														const n = new Set(s);
														if (v === true) n.add(r.row);
														else n.delete(r.row);
														return n;
													})
												}
												aria-label={`Import row ${r.row}`}
											/>
										</td>
										<td className="px-2 py-1.5 text-muted-foreground tabular">{r.row}</td>
										<td className="max-w-64 truncate px-2 py-1.5">{r.title ?? <span className="text-muted-foreground">(no title)</span>}</td>
										<td className="px-2 py-1.5 text-xs">
											{r.status === "valid" && <span className="text-success">Ready to import</span>}
											{r.status === "duplicate" && r.duplicateOf && (
												<span className="text-warning">
													{r.duplicateOf.reason}
													{r.duplicateOf.id ? (
														<>
															{" "}
															—{" "}
															<Link to={`/hackathons/${r.duplicateOf.id}`} target="_blank" className="underline">
																{r.duplicateOf.title}
															</Link>
														</>
													) : (
														` (${r.duplicateOf.title})`
													)}
													. Unchecked by default.
												</span>
											)}
											{r.status === "invalid" && <span className="text-urgent">{r.errors.join("; ")}</span>}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
					<div className="mt-4 flex flex-wrap items-center gap-2">
						<Button onClick={() => importMut.mutate()} disabled={!selected.size || importMut.isPending}>
							{importMut.isPending ? "Importing…" : `3. Import ${selected.size} selected row${selected.size === 1 ? "" : "s"}`}
						</Button>
						{errorReport && (
							<Button variant="outline" onClick={() => saveBlob(new Blob([errorReport], { type: "text/csv" }), "hackradar-import-errors.csv")}>
								<Download /> Download error report
							</Button>
						)}
						<p className="text-xs text-muted-foreground">Imports are all-or-nothing and never modify existing events.</p>
					</div>
				</div>
			)}
		</div>
	);
}
