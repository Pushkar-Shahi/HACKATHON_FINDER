import type { ReactNode } from "react";
import { Link } from "react-router";
import { AlertTriangle, Lock, LogIn, RefreshCw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
	return (
		<div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
			<div className="min-w-0">
				<h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
				{description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
			</div>
			{actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
		</div>
	);
}

export function EmptyState({
	icon,
	title,
	description,
	action,
	className,
}: {
	icon?: ReactNode;
	title: string;
	description?: ReactNode;
	action?: ReactNode;
	className?: string;
}) {
	return (
		<div className={cn("flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-12 text-center", className)}>
			{icon && <div className="mb-3 text-muted-foreground [&_svg]:size-8">{icon}</div>}
			<h3 className="font-medium">{title}</h3>
			{description && <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>}
			{action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
		</div>
	);
}

/** Error state with a sensible next action for network, auth and permission errors. */
export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
	const api = error instanceof ApiError ? error : null;
	if (api?.status === 401) {
		return (
			<EmptyState
				className={className}
				icon={<LogIn />}
				title="Your session has ended"
				description="Sign in again to continue."
				action={
					<Button asChild>
						<Link to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`}>Sign in</Link>
					</Button>
				}
			/>
		);
	}
	if (api?.status === 403) {
		return <EmptyState className={className} icon={<Lock />} title="Permission denied" description={api.message} action={<Button asChild variant="outline"><Link to="/">Go to dashboard</Link></Button>} />;
	}
	return (
		<EmptyState
			className={className}
			icon={api?.isNetwork ? <WifiOff /> : <AlertTriangle />}
			title={api?.isNetwork ? "You appear to be offline" : api?.status === 404 ? "Not found" : "Couldn't load this"}
			description={errorMessage(error)}
			action={
				onRetry && (
					<Button variant="outline" onClick={onRetry}>
						<RefreshCw /> Try again
					</Button>
				)
			}
		/>
	);
}

export function CardGridSkeleton({ count = 6, view = "grid" }: { count?: number; view?: "grid" | "list" }) {
	return (
		<div className={view === "grid" ? "grid gap-4 sm:grid-cols-2 xl:grid-cols-3" : "space-y-2"} aria-busy="true" aria-label="Loading">
			{Array.from({ length: count }).map((_, i) =>
				view === "grid" ? (
					<div key={i} className="space-y-3 rounded-lg border bg-card p-4">
						<Skeleton className="h-4 w-1/3" />
						<Skeleton className="h-5 w-4/5" />
						<Skeleton className="h-3 w-full" />
						<Skeleton className="h-3 w-2/3" />
						<div className="flex gap-2 pt-2">
							<Skeleton className="h-8 w-20" />
							<Skeleton className="h-8 w-24" />
						</div>
					</div>
				) : (
					<Skeleton key={i} className="h-14 w-full" />
				),
			)}
		</div>
	);
}

export function InlineSpinner({ className }: { className?: string }) {
	return <RefreshCw className={cn("size-4 animate-spin", className)} aria-hidden />;
}
