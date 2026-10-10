import type { ReactNode } from "react";
import { createBrowserRouter, isRouteErrorResponse, Link, Navigate, useLocation, useRouteError } from "react-router";
import { AppLayout } from "@/components/layout/app-layout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/states";
import { useMe } from "@/hooks/use-me";
import { DashboardPage } from "@/pages/dashboard-page";
import { DiscoverPage } from "@/pages/discover-page";
import { ForgotPasswordPage, LoginPage, ResetPasswordPage, SignupPage } from "@/pages/auth-pages";

/** Client-side guard for pages that need an account. The API enforces auth independently. */
export function RequireAuth({ children }: { children: ReactNode }) {
	const { user, isLoading } = useMe();
	const location = useLocation();
	if (isLoading) return <Skeleton className="h-64" />;
	if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
	return <>{children}</>;
}

export function NotFoundPage() {
	return (
		<EmptyState
			title="Page not found"
			description="That page doesn't exist."
			action={
				<Button asChild>
					<Link to="/">Go to dashboard</Link>
				</Button>
			}
		/>
	);
}

function RouteError() {
	const error = useRouteError();
	return (
		<div className="p-8">
			<EmptyState
				title={isRouteErrorResponse(error) ? `${error.status} ${error.statusText}` : "Something went wrong"}
				description="An unexpected error occurred while showing this page. Reloading usually helps."
				action={<Button onClick={() => window.location.reload()}>Reload</Button>}
			/>
		</div>
	);
}

/** Lazily load a page module; optionally wrap it in the sign-in guard. */
function page<M extends Record<string, unknown>>(load: () => Promise<M>, name: keyof M, requireAuth = false) {
	return async () => {
		const Page = (await load())[name] as unknown as () => ReactNode;
		return { Component: requireAuth ? () => <RequireAuth><Page /></RequireAuth> : Page };
	};
}

export const routes = [
	{ path: "/login", element: <LoginPage />, errorElement: <RouteError /> },
	{ path: "/signup", element: <SignupPage />, errorElement: <RouteError /> },
	{ path: "/forgot-password", element: <ForgotPasswordPage />, errorElement: <RouteError /> },
	{ path: "/reset-password", element: <ResetPasswordPage />, errorElement: <RouteError /> },
	{
		path: "/",
		element: <AppLayout />,
		errorElement: <RouteError />,
		children: [
			{ index: true, element: <DashboardPage /> },
			{ path: "discover", element: <DiscoverPage /> },
			{ path: "hackathons/:id", lazy: page(() => import("@/pages/hackathon-detail-page"), "HackathonDetailPage") },
			{ path: "calendar", lazy: page(() => import("@/pages/calendar-page"), "CalendarPage") },
			{ path: "sources", lazy: page(() => import("@/pages/sources-page"), "SourcesPage") },
			{ path: "tracker", lazy: page(() => import("@/pages/tracker-page"), "TrackerPage", true) },
			{ path: "saved", lazy: page(() => import("@/pages/saved-page"), "SavedPage", true) },
			{ path: "notifications", lazy: page(() => import("@/pages/notifications-page"), "NotificationsPage", true) },
			{ path: "settings", lazy: page(() => import("@/pages/settings-page"), "SettingsPage", true) },
			{ path: "my-events", lazy: page(() => import("@/pages/my-events-page"), "MyEventsPage", true) },
			{ path: "events/new", lazy: page(() => import("@/pages/event-form-page"), "NewEventPage", true) },
			{ path: "events/:id/edit", lazy: page(() => import("@/pages/event-form-page"), "EditEventPage", true) },
			{ path: "admin", lazy: page(() => import("@/pages/admin-page"), "AdminPage", true) },
			{ path: "admin/hackathons/:id/edit", lazy: page(() => import("@/pages/admin-page"), "AdminEditPage", true) },
			{ path: "*", element: <NotFoundPage /> },
		],
	},
];

export function createAppRouter() {
	return createBrowserRouter(routes);
}
