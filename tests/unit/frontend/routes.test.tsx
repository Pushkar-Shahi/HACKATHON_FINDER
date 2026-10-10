// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/layout/theme";
import { routes } from "@/App";

beforeAll(() => {
	globalThis.ResizeObserver ??= class {
		observe() {}
		unobserve() {}
		disconnect() {}
	} as unknown as typeof ResizeObserver;
	// Anonymous visitor: /api/me → null, lists empty.
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			const body = url.startsWith("/api/me")
				? { data: null }
				: url.startsWith("/api/hackathons")
					? { data: [], meta: { page: 1, pageSize: 18, total: 0, totalPages: 1 } }
					: url.startsWith("/api/dashboard/stats")
						? { data: { upcoming: 0, registrationOpen: 0, deadlinesNext7Days: 0, ongoing: 0, saved: null, registered: null, demoEventCount: 0, totalVisibleEvents: 0, generatedAt: new Date().toISOString() } }
						: { data: null };
			return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
		}),
	);
});
afterEach(cleanup);

function renderAt(path: string) {
	const router = createMemoryRouter(routes, { initialEntries: [path] });
	render(
		<ThemeProvider>
			<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
				<TooltipProvider>
					<RouterProvider router={router} />
				</TooltipProvider>
			</QueryClientProvider>
		</ThemeProvider>,
	);
	return router;
}

describe("frontend routes", () => {
	it("redirects protected pages to sign-in with a return path", async () => {
		const router = renderAt("/tracker");
		expect(await screen.findByRole("heading", { name: "Sign in" })).toBeTruthy();
		expect(router.state.location.pathname).toBe("/login");
		expect(router.state.location.search).toBe("?next=%2Ftracker");
	});

	it("renders a not-found page for unknown routes", async () => {
		renderAt("/definitely/not/a/page");
		expect(await screen.findByText("Page not found")).toBeTruthy();
	});

	it("allows anonymous discovery and shows the honest empty state", async () => {
		renderAt("/discover");
		expect(await screen.findByRole("heading", { name: "Discover hackathons" })).toBeTruthy();
		expect(await screen.findByText("No hackathons yet")).toBeTruthy();
		expect(screen.getByText(/doesn't scrape platforms that forbid it/)).toBeTruthy();
	});
});
