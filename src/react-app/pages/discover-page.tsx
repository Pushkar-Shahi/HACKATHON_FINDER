import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, LayoutGrid, List, Plus, Search, SearchX, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CardGridSkeleton, EmptyState, ErrorState, PageHeader } from "@/components/common/states";
import { FilterPanel } from "@/components/filters/filter-panel";
import { activeChips, EMPTY_FILTERS, readFilters, toApiQuery, writeFilters, type DiscoverFilters } from "@/components/filters/discover-params";
import { HackathonCard, HackathonRow } from "@/components/hackathons/hackathon-card";
import { DemoNotice } from "@/components/dashboard/demo-notice";
import { listHackathons } from "@/services/hackathons";
import { useDebouncedValue, useNow } from "@/hooks/use-utils";
import { useMe } from "@/hooks/use-me";
import { SORT_LABELS, SORT_OPTIONS, type SortOption } from "@shared/constants";
import { pluralize } from "@/lib/format";

const PAGE_SIZE = 18;
const VIEW_KEY = "hackradar.discover.view";

function readView(params: URLSearchParams): "grid" | "list" {
	const v = params.get("view");
	if (v === "grid" || v === "list") return v;
	try {
		return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid";
	} catch {
		return "grid";
	}
}

export function DiscoverPage() {
	const [params, setParams] = useSearchParams();
	const filters = useMemo(() => readFilters(params), [params]);
	const view = readView(params);
	const { user } = useMe();
	const now = useNow();
	const [search, setSearch] = useState(filters.q);
	const debouncedSearch = useDebouncedValue(search, 350);

	const update = (next: DiscoverFilters, replace = false) => setParams(writeFilters(next, params), { replace });

	useEffect(() => setSearch(filters.q), [filters.q]);
	useEffect(() => {
		if (debouncedSearch !== filters.q) update({ ...filters, q: debouncedSearch, page: 1 }, true);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [debouncedSearch]);

	const apiQuery = toApiQuery(filters, PAGE_SIZE);
	const query = useQuery({
		queryKey: ["hackathons", apiQuery],
		queryFn: ({ signal }) => listHackathons(apiQuery, signal),
		placeholderData: keepPreviousData,
	});
	const chips = activeChips(filters);
	const total = query.data?.meta?.total ?? 0;
	const totalPages = query.data?.meta?.totalPages ?? 1;

	const setView = (v: string) => {
		if (v !== "grid" && v !== "list") return;
		try {
			localStorage.setItem(VIEW_KEY, v);
		} catch {
			/* storage unavailable — still works for this page */
		}
		const p = new URLSearchParams(params);
		p.set("view", v);
		setParams(p, { replace: true });
	};

	const panel = <FilterPanel filters={filters} onChange={(f) => update(f)} signedIn={Boolean(user)} />;

	return (
		<div>
			<PageHeader
				title="Discover hackathons"
				description="Every event in HackRadar, from all sources, in one searchable feed. Registration always happens on the official event page."
				actions={
					<Button asChild size="sm" variant="outline">
						<Link to="/events/new">
							<Plus /> Add hackathon
						</Link>
					</Button>
				}
			/>
			<DemoNotice className="mb-4" />

			<div className="flex gap-6">
				<aside className="hidden w-60 shrink-0 lg:block" aria-label="Filters">
					<div className="sticky top-20">
						<ScrollArea className="h-[calc(100svh-6rem)] pr-3">{panel}</ScrollArea>
					</div>
				</aside>

				<section className="min-w-0 flex-1" aria-label="Results">
					<div className="mb-3 flex flex-wrap items-center gap-2">
						<div className="relative min-w-48 flex-1">
							<Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
							<Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter by keyword…" aria-label="Search within results" className="h-9 pl-8" />
						</div>
						<Sheet>
							<SheetTrigger asChild>
								<Button variant="outline" size="sm" className="lg:hidden">
									<SlidersHorizontal /> Filters{chips.length ? ` (${chips.length})` : ""}
								</Button>
							</SheetTrigger>
							<SheetContent side="left" className="w-80 p-0">
								<SheetHeader>
									<SheetTitle>Filters</SheetTitle>
								</SheetHeader>
								<ScrollArea className="h-[calc(100svh-4rem)] px-4 pb-6">{panel}</ScrollArea>
							</SheetContent>
						</Sheet>
						<Select value={filters.sort} onValueChange={(v) => update({ ...filters, sort: v as SortOption, page: 1 })}>
							<SelectTrigger size="sm" className="w-48" aria-label="Sort by">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{SORT_OPTIONS.map((s) => (
									<SelectItem key={s} value={s}>
										{SORT_LABELS[s]}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<ToggleGroup type="single" variant="outline" size="sm" value={view} onValueChange={setView} aria-label="Layout">
							<ToggleGroupItem value="grid" aria-label="Grid view">
								<LayoutGrid />
							</ToggleGroupItem>
							<ToggleGroupItem value="list" aria-label="Compact list view">
								<List />
							</ToggleGroupItem>
						</ToggleGroup>
					</div>

					<div className="mb-4 flex min-h-7 flex-wrap items-center gap-1.5" aria-live="polite">
						<span className="mr-1 text-sm text-muted-foreground tabular">
							{query.isLoading ? "Loading…" : `${pluralize(total, "event")}${chips.length ? " match" : ""}`}
						</span>
						{chips.map((c) => (
							<button
								key={c.key}
								type="button"
								onClick={() => update({ ...c.clear(filters), page: 1 })}
								className="inline-flex items-center gap-1 rounded-full border bg-secondary px-2 py-0.5 text-xs hover:bg-accent"
								aria-label={`Remove filter ${c.label}`}
							>
								{c.label} <X className="size-3" />
							</button>
						))}
						{chips.length > 0 && (
							<Button variant="link" size="sm" className="h-auto px-1 text-xs" onClick={() => update({ ...EMPTY_FILTERS, sort: filters.sort })}>
								Clear all filters
							</Button>
						)}
					</div>

					{filters.sort === "prize" && (
						<p className="mb-3 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
							Ranking prizes in {query.data?.meta?.prizeSortCurrency ?? (filters.prizeCurrency || "USD")} only. Events with prizes in other currencies or no stated prize are listed after,
							by deadline — currencies are never compared as if equivalent. Change the currency under Filters → Prize.
						</p>
					)}

					{query.isLoading ? (
						<CardGridSkeleton view={view} />
					) : query.isError ? (
						<ErrorState error={query.error} onRetry={() => query.refetch()} />
					) : query.data && query.data.data.length === 0 ? (
						chips.length ? (
							<EmptyState
								icon={<SearchX />}
								title="No hackathons match these filters"
								description="Try removing a filter or widening the deadline window."
								action={<Button variant="outline" onClick={() => update({ ...EMPTY_FILTERS, sort: filters.sort })}>Clear all filters</Button>}
							/>
						) : (
							<EmptyState
								icon={<Search />}
								title="No hackathons yet"
								description="HackRadar doesn't scrape platforms that forbid it, so events arrive through manual entry, CSV import or an authorized integration."
								action={
									<>
										<Button asChild>
											<Link to="/events/new">Add a hackathon</Link>
										</Button>
										<Button asChild variant="outline">
											<Link to="/my-events?tab=import">Import CSV</Link>
										</Button>
										<Button asChild variant="ghost">
											<Link to="/sources">See source status</Link>
										</Button>
									</>
								}
							/>
						)
					) : (
						<div className={query.isPlaceholderData ? "opacity-60 transition-opacity" : ""}>
							{view === "grid" ? (
								<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
									{query.data!.data.map((h) => (
										<HackathonCard key={h.id} h={h} now={now} />
									))}
								</div>
							) : (
								<div className="space-y-2">
									{query.data!.data.map((h) => (
										<HackathonRow key={h.id} h={h} now={now} />
									))}
								</div>
							)}
							{totalPages > 1 && (
								<nav className="mt-6 flex items-center justify-between" aria-label="Pagination">
									<Button variant="outline" size="sm" disabled={filters.page <= 1} onClick={() => update({ ...filters, page: filters.page - 1 })}>
										<ChevronLeft /> Previous
									</Button>
									<span className="text-sm text-muted-foreground tabular">
										Page {filters.page} of {totalPages}
									</span>
									<Button variant="outline" size="sm" disabled={filters.page >= totalPages} onClick={() => update({ ...filters, page: filters.page + 1 })}>
										Next <ChevronRight />
									</Button>
								</nav>
							)}
						</div>
					)}
				</section>
			</div>
		</div>
	);
}
