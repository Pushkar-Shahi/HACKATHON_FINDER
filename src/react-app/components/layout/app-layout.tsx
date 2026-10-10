import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "@/components/layout/theme";
import { toast } from "sonner";
import {
	Bell,
	Bookmark,
	CalendarDays,
	CircleUser,
	Compass,
	FileStack,
	LayoutDashboard,
	ListChecks,
	Lock,
	LogOut,
	Menu,
	Monitor,
	Moon,
	Plus,
	Radar,
	Search,
	Settings,
	ShieldCheck,
	Sun,
	Unplug,
	WifiOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMe } from "@/hooks/use-me";
import { useOnlineStatus } from "@/hooks/use-utils";
import { unreadCount } from "@/services/personal";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

interface NavItem {
	to: string;
	label: string;
	icon: typeof Compass;
	auth?: boolean;
	admin?: boolean;
	end?: boolean;
}

const NAV: NavItem[] = [
	{ to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
	{ to: "/discover", label: "Discover Hackathons", icon: Compass },
	{ to: "/calendar", label: "Calendar", icon: CalendarDays },
	{ to: "/tracker", label: "My Tracker", icon: ListChecks, auth: true },
	{ to: "/saved", label: "Saved Hackathons", icon: Bookmark, auth: true },
	{ to: "/my-events", label: "My Events & Import", icon: FileStack, auth: true },
	{ to: "/sources", label: "Sources & Integrations", icon: Unplug },
	{ to: "/notifications", label: "Notifications", icon: Bell, auth: true },
	{ to: "/settings", label: "Settings", icon: Settings, auth: true },
	{ to: "/admin", label: "Admin", icon: ShieldCheck, auth: true, admin: true },
];

function Brand() {
	return (
		<Link to="/" className="flex items-center gap-2 px-2 font-semibold tracking-tight">
			<span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
				<Radar className="size-4" />
			</span>
			HackRadar
		</Link>
	);
}

function NavList({ onNavigate, unread }: { onNavigate?: () => void; unread: number }) {
	const { user, isAdmin } = useMe();
	return (
		<nav aria-label="Main" className="space-y-0.5">
			{NAV.filter((n) => !n.admin || isAdmin).map((n) => (
				<NavLink
					key={n.to}
					to={n.to}
					end={n.end}
					onClick={onNavigate}
					className={({ isActive }) =>
						cn(
							"flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
							isActive && "bg-accent font-medium text-accent-foreground",
						)
					}
				>
					<n.icon className="size-4 shrink-0" />
					<span className="truncate">{n.label}</span>
					{n.to === "/notifications" && unread > 0 && (
						<span className="ml-auto rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground tabular">{unread > 99 ? "99+" : unread}</span>
					)}
					{n.auth && !user && !n.admin && <Lock className="ml-auto size-3 shrink-0 opacity-50" aria-label="Requires sign-in" />}
				</NavLink>
			))}
		</nav>
	);
}

function GlobalSearch({ className }: { className?: string }) {
	const navigate = useNavigate();
	const location = useLocation();
	const [params] = useSearchParams();
	const urlQuery = location.pathname === "/discover" ? (params.get("q") ?? "") : null;
	const [value, setValue] = useState(urlQuery ?? "");
	const ref = useRef<HTMLInputElement>(null);
	// Mirror the Discover page's ?q= when it changes (derived state, no effect needed).
	const [lastUrlQuery, setLastUrlQuery] = useState(urlQuery);
	if (urlQuery !== lastUrlQuery) {
		setLastUrlQuery(urlQuery);
		if (urlQuery !== null) setValue(urlQuery);
	}
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const target = e.target as HTMLElement;
			if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) && !target.isContentEditable) {
				e.preventDefault();
				ref.current?.focus();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);
	const submit = (e: FormEvent) => {
		e.preventDefault();
		const next = new URLSearchParams(location.pathname === "/discover" ? params : undefined);
		if (value.trim()) next.set("q", value.trim());
		else next.delete("q");
		next.delete("page");
		navigate(`/discover?${next.toString()}`);
	};
	return (
		<form role="search" onSubmit={submit} className={cn("relative", className)}>
			<Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
			<Input
				ref={ref}
				value={value}
				onChange={(e) => setValue(e.target.value)}
				placeholder="Search hackathons, organizers, topics…"
				aria-label="Search hackathons"
				className="h-9 pl-8 pr-10"
			/>
			<kbd className="pointer-events-none absolute top-1/2 right-2 hidden -translate-y-1/2 rounded border bg-muted px-1.5 text-[10px] text-muted-foreground sm:block">/</kbd>
		</form>
	);
}

function ThemeMenu() {
	const { theme, setTheme } = useTheme();
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="ghost" size="icon-sm" aria-label="Change theme">
					<Sun className="dark:hidden" />
					<Moon className="hidden dark:block" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuLabel>Theme</DropdownMenuLabel>
				<DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={setTheme}>
					<DropdownMenuRadioItem value="light">
						<Sun /> Light
					</DropdownMenuRadioItem>
					<DropdownMenuRadioItem value="dark">
						<Moon /> Dark
					</DropdownMenuRadioItem>
					<DropdownMenuRadioItem value="system">
						<Monitor /> System
					</DropdownMenuRadioItem>
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function UserMenu() {
	const { user } = useMe();
	const qc = useQueryClient();
	const navigate = useNavigate();
	if (!user) {
		return (
			<div className="flex items-center gap-1.5">
				<Button asChild variant="ghost" size="sm">
					<Link to="/login">Sign in</Link>
				</Button>
				<Button asChild size="sm" className="hidden sm:inline-flex">
					<Link to="/signup">Create account</Link>
				</Button>
			</div>
		);
	}
	const signOut = async () => {
		const { error } = await authClient.signOut();
		if (error) {
			toast.error(error.message ?? "Could not sign out");
			return;
		}
		qc.clear();
		toast.success("Signed out");
		navigate("/login");
	};
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="ghost" size="icon-sm" aria-label="Account menu">
					<CircleUser />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-56">
				<DropdownMenuLabel className="font-normal">
					<div className="truncate text-sm font-medium">{user.displayName || user.name}</div>
					<div className="truncate text-xs text-muted-foreground">{user.email}</div>
				</DropdownMenuLabel>
				<DropdownMenuSeparator />
				<DropdownMenuItem asChild>
					<Link to="/settings">
						<Settings /> Settings
					</Link>
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={signOut}>
					<LogOut /> Sign out
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function useSessionExpiryWatcher() {
	const qc = useQueryClient();
	const { user } = useMe();
	useEffect(() => {
		const handler = () => {
			if (qc.getQueryData(["me"])) {
				toast.warning("Your session expired. Please sign in again.");
				qc.setQueryData(["me"], null);
			}
		};
		window.addEventListener("hackradar:unauthorized", handler);
		return () => window.removeEventListener("hackradar:unauthorized", handler);
	}, [qc, user]);
}

export function AppLayout() {
	const { user } = useMe();
	const online = useOnlineStatus();
	const [mobileOpen, setMobileOpen] = useState(false);
	const location = useLocation();
	useSessionExpiryWatcher();
	// Close the mobile drawer after any navigation.
	const [lastPath, setLastPath] = useState(location.pathname);
	if (lastPath !== location.pathname) {
		setLastPath(location.pathname);
		setMobileOpen(false);
	}
	const unread = useQuery({ queryKey: ["unread-count"], queryFn: unreadCount, enabled: Boolean(user), refetchInterval: 120_000 });
	const unreadN = unread.data?.unreadCount ?? 0;

	return (
		<div className="flex min-h-svh">
			<a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-background focus:px-3 focus:py-2">
				Skip to content
			</a>
			<aside className="sticky top-0 hidden h-svh w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar px-3 py-4 lg:flex">
				<Brand />
				<Button asChild className="mx-1 mt-5 mb-4" size="sm">
					<Link to="/events/new">
						<Plus /> Add hackathon
					</Link>
				</Button>
				<NavList unread={unreadN} />
				<p className="mt-auto px-2 text-[11px] leading-relaxed text-muted-foreground">
					HackRadar is independent and not affiliated with Devpost, MachineHack, MLH or Unstop. Register on each event's official page.
				</p>
			</aside>

			<div className="flex min-w-0 flex-1 flex-col">
				<header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/90 px-3 backdrop-blur sm:px-5">
					<Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
						<SheetTrigger asChild>
							<Button variant="ghost" size="icon-sm" className="lg:hidden" aria-label="Open navigation">
								<Menu />
							</Button>
						</SheetTrigger>
						<SheetContent side="left" className="w-72 p-4">
							<SheetHeader className="p-0">
								<SheetTitle asChild>
									<div>
										<Brand />
									</div>
								</SheetTitle>
							</SheetHeader>
							<Button asChild className="mt-2" size="sm">
								<Link to="/events/new">
									<Plus /> Add hackathon
								</Link>
							</Button>
							<NavList unread={unreadN} onNavigate={() => setMobileOpen(false)} />
						</SheetContent>
					</Sheet>
					<div className="lg:hidden">
						<Link to="/" aria-label="HackRadar home" className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
							<Radar className="size-4" />
						</Link>
					</div>
					<GlobalSearch className="max-w-xl flex-1" />
					<div className="ml-auto flex items-center gap-1">
						<Button asChild variant="outline" size="sm" className="hidden md:inline-flex lg:hidden">
							<Link to="/events/new">
								<Plus /> Add
							</Link>
						</Button>
						{user && (
							<Button asChild variant="ghost" size="icon-sm" aria-label={`Notifications${unreadN ? `, ${unreadN} unread` : ""}`} className="relative">
								<Link to="/notifications">
									<Bell />
									{unreadN > 0 && <span className="absolute top-1 right-1 size-2 rounded-full bg-primary" aria-hidden />}
								</Link>
							</Button>
						)}
						<ThemeMenu />
						<UserMenu />
					</div>
				</header>
				{!online && (
					<div role="status" className="flex items-center gap-2 border-b bg-warning-soft px-5 py-2 text-sm text-warning">
						<WifiOff className="size-4" /> You're offline. Changes can't be saved until your connection returns.
					</div>
				)}
				<main id="main" className="mx-auto w-full max-w-7xl flex-1 px-3 py-6 sm:px-5 lg:px-8">
					<Outlet />
				</main>
			</div>
		</div>
	);
}
