import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bookmark, Download, FolderInput, FolderPlus, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CardGridSkeleton, EmptyState, ErrorState, PageHeader } from "@/components/common/states";
import { HackathonRow } from "@/components/hackathons/hackathon-card";
import {
	addToCollection,
	createCollection,
	deleteCollection,
	listBookmarks,
	listCollections,
	moveBetweenCollections,
	removeFromCollection,
	updateBookmark,
	updateCollection,
} from "@/services/personal";
import { exportCsv } from "@/services/hackathons";
import { useNow } from "@/hooks/use-utils";
import { errorMessage } from "@/lib/api";
import { invalidatePersonal } from "@/lib/query-client";
import { cn } from "@/lib/utils";
import type { BookmarkRecord, CollectionRecord } from "@shared/types";

const SUGGESTED = ["AI and ML", "High Priority", "College Hackathons", "Online Events", "Winter Hackathons"];

function CollectionDialog({ collection, onClose }: { collection?: CollectionRecord; onClose: () => void }) {
	const qc = useQueryClient();
	const [name, setName] = useState(collection?.name ?? "");
	const [error, setError] = useState<string | null>(null);
	const save = useMutation({
		mutationFn: () => (collection ? updateCollection(collection.id, { name: name.trim() }) : createCollection(name.trim())),
		onSuccess: () => {
			toast.success(collection ? "Collection renamed" : "Collection created");
			invalidatePersonal(qc);
			onClose();
		},
		onError: (e) => setError(errorMessage(e)),
	});
	return (
		<Dialog open onOpenChange={(o) => !o && onClose()}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{collection ? "Rename collection" : "New collection"}</DialogTitle>
				</DialogHeader>
				<form
					className="space-y-3"
					onSubmit={(e) => {
						e.preventDefault();
						setError(null);
						if (name.trim()) save.mutate();
					}}
				>
					<Label htmlFor="col-name">Name</Label>
					<Input id="col-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus required />
					{!collection && (
						<div className="flex flex-wrap gap-1">
							{SUGGESTED.map((s) => (
								<button key={s} type="button" className="rounded-full border px-2 py-0.5 text-xs hover:bg-accent" onClick={() => setName(s)}>
									{s}
								</button>
							))}
						</div>
					)}
					{error && (
						<p role="alert" className="text-sm text-destructive">
							{error}
						</p>
					)}
					<DialogFooter>
						<Button type="submit" disabled={save.isPending || !name.trim()}>
							Save
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function BookmarkItem({ b, collections, activeCollection, now }: { b: BookmarkRecord; collections: CollectionRecord[]; activeCollection: string | null; now: number }) {
	const qc = useQueryClient();
	const [note, setNote] = useState(b.note ?? "");
	const [editing, setEditing] = useState(false);
	const run = useMutation({
		mutationFn: (fn: () => Promise<unknown>) => fn(),
		onSuccess: () => invalidatePersonal(qc),
		onError: (e) => toast.error(errorMessage(e)),
	});
	const toggleCollection = (c: CollectionRecord, on: boolean) =>
		run.mutate(() => (on ? addToCollection(c.id, b.hackathonId) : removeFromCollection(c.id, b.hackathonId)).then(() => toast.success(on ? `Added to ${c.name}` : `Removed from ${c.name}`)));
	return (
		<div className="space-y-1.5">
			<HackathonRow h={b.hackathon} now={now} />
			<div className="flex flex-wrap items-center gap-2 px-1 text-xs">
				{editing ? (
					<form
						className="flex flex-1 gap-2"
						onSubmit={(e) => {
							e.preventDefault();
							run.mutate(() =>
								updateBookmark(b.id, note.trim() || null).then(() => {
									toast.success("Note saved");
									setEditing(false);
								}),
							);
						}}
					>
						<Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} className="h-7 text-xs" placeholder="Note" autoFocus aria-label="Saved note" />
						<Button size="xs" type="submit">
							Save
						</Button>
						<Button size="xs" variant="ghost" type="button" onClick={() => setEditing(false)}>
							Cancel
						</Button>
					</form>
				) : (
					<button type="button" onClick={() => setEditing(true)} className="text-muted-foreground hover:text-foreground">
						{b.note ? <>📝 {b.note}</> : "+ Add note"}
					</button>
				)}
				<div className="ml-auto flex gap-1">
					{collections.length > 0 && (
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button size="xs" variant="outline">
									<FolderInput /> Collections{b.collectionIds.length ? ` (${b.collectionIds.length})` : ""}
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								<DropdownMenuLabel>In collections</DropdownMenuLabel>
								{collections.map((c) => (
									<DropdownMenuCheckboxItem key={c.id} checked={b.collectionIds.includes(c.id)} onCheckedChange={(v) => toggleCollection(c, v === true)}>
										{c.name}
									</DropdownMenuCheckboxItem>
								))}
								{activeCollection && (
									<>
										<DropdownMenuSeparator />
										<DropdownMenuLabel>Move to…</DropdownMenuLabel>
										{collections
											.filter((c) => c.id !== activeCollection)
											.map((c) => (
												<DropdownMenuItem key={c.id} onSelect={() => run.mutate(() => moveBetweenCollections(b.hackathonId, activeCollection, c.id).then(() => toast.success(`Moved to ${c.name}`)))}>
													{c.name}
												</DropdownMenuItem>
											))}
									</>
								)}
							</DropdownMenuContent>
						</DropdownMenu>
					)}
				</div>
			</div>
		</div>
	);
}

export function SavedPage() {
	const [params, setParams] = useSearchParams();
	const qc = useQueryClient();
	const now = useNow();
	const active = params.get("collection");
	const sort = params.get("sort") ?? "deadline";
	const [dialog, setDialog] = useState<{ collection?: CollectionRecord } | null>(null);
	const collections = useQuery({ queryKey: ["collections"], queryFn: listCollections });
	const bookmarks = useQuery({ queryKey: ["bookmarks", { active, sort }], queryFn: () => listBookmarks({ collectionId: active ?? undefined, sort }) });
	const removeCol = useMutation({
		mutationFn: (id: string) => deleteCollection(id),
		onSuccess: () => {
			toast.success("Collection deleted (saved events kept)");
			setParams({});
			invalidatePersonal(qc);
		},
		onError: (e) => toast.error(errorMessage(e)),
	});
	const exportMut = useMutation({ mutationFn: () => exportCsv("saved"), onError: (e) => toast.error(errorMessage(e)) });
	const cols = collections.data ?? [];
	const activeCol = cols.find((c) => c.id === active);
	const set = (k: string, v: string | null) => {
		const p = new URLSearchParams(params);
		if (v) p.set(k, v);
		else p.delete(k);
		setParams(p, { replace: true });
	};

	return (
		<div>
			<PageHeader
				title="Saved hackathons"
				description="Bookmarks, organised into your own collections."
				actions={
					<>
						<Button size="sm" variant="outline" onClick={() => exportMut.mutate()} disabled={exportMut.isPending}>
							<Download /> Export CSV
						</Button>
						<Button size="sm" onClick={() => setDialog({})}>
							<FolderPlus /> New collection
						</Button>
					</>
				}
			/>
			<div className="grid gap-6 md:grid-cols-[14rem_minmax(0,1fr)]">
				<nav aria-label="Collections" className="space-y-0.5">
					<button type="button" onClick={() => set("collection", null)} className={cn("flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-sm hover:bg-accent", !active && "bg-accent font-medium")}>
						All saved
					</button>
					{cols.map((c) => (
						<div key={c.id} className={cn("group flex items-center rounded-md hover:bg-accent", active === c.id && "bg-accent font-medium")}>
							<button type="button" onClick={() => set("collection", c.id)} className="flex min-w-0 flex-1 items-center justify-between px-2.5 py-1.5 text-left text-sm">
								<span className="truncate">{c.name}</span>
								<span className="text-xs text-muted-foreground tabular">{c.itemCount}</span>
							</button>
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button variant="ghost" size="icon-xs" className="mr-1 opacity-60 group-hover:opacity-100" aria-label={`Manage ${c.name}`}>
										<MoreHorizontal />
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end">
									<DropdownMenuItem onSelect={() => setDialog({ collection: c })}>
										<Pencil /> Rename
									</DropdownMenuItem>
									<DropdownMenuItem variant="destructive" onSelect={() => removeCol.mutate(c.id)}>
										<Trash2 /> Delete collection
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						</div>
					))}
					{collections.isSuccess && cols.length === 0 && <p className="px-2.5 py-2 text-xs text-muted-foreground">No collections yet.</p>}
				</nav>

				<section className="min-w-0">
					<div className="mb-3 flex items-center justify-between gap-2">
						<h2 className="font-medium">{activeCol ? activeCol.name : "All saved"}</h2>
						<Select value={sort} onValueChange={(v) => set("sort", v)}>
							<SelectTrigger size="sm" className="w-48" aria-label="Sort saved">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="deadline">Registration deadline</SelectItem>
								<SelectItem value="start">Event date</SelectItem>
								<SelectItem value="added">Recently saved</SelectItem>
							</SelectContent>
						</Select>
					</div>
					{bookmarks.isLoading ? (
						<CardGridSkeleton view="list" />
					) : bookmarks.isError ? (
						<ErrorState error={bookmarks.error} onRetry={() => bookmarks.refetch()} />
					) : bookmarks.data!.length === 0 ? (
						<EmptyState
							icon={<Bookmark />}
							title={activeCol ? "This collection is empty" : "No saved hackathons yet"}
							description={activeCol ? "Use the Collections menu on any saved event to add it here." : "Tap the bookmark icon on any hackathon to save it."}
							action={
								<Button asChild>
									<Link to="/discover">Discover hackathons</Link>
								</Button>
							}
						/>
					) : (
						<div className="space-y-4">
							{bookmarks.data!.map((b) => (
								<BookmarkItem key={b.id} b={b} collections={cols} activeCollection={active} now={now} />
							))}
						</div>
					)}
				</section>
			</div>
			{dialog && <CollectionDialog collection={dialog.collection} onClose={() => setDialog(null)} />}
		</div>
	);
}
