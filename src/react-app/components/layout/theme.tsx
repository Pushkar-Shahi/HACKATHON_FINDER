// Light / dark / system theme. The class on <html> is applied before React
// loads by /theme-init.js (a same-origin file, so the CSP needs no inline
// scripts); this provider keeps it in sync afterwards.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export type Theme = "light" | "dark" | "system";
const KEY = "hackradar.theme";

interface ThemeState {
	theme: Theme;
	resolvedTheme: "light" | "dark";
	setTheme: (t: string) => void;
}

const ThemeContext = createContext<ThemeState>({ theme: "system", resolvedTheme: "light", setTheme: () => {} });

function readStored(): Theme {
	try {
		const v = localStorage.getItem(KEY);
		return v === "light" || v === "dark" ? v : "system";
	} catch {
		return "system";
	}
}

const systemDark = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches;

export function ThemeProvider({ children }: { children: ReactNode }) {
	const [theme, setThemeState] = useState<Theme>(readStored);
	const [system, setSystem] = useState<"light" | "dark">(() => (systemDark() ? "dark" : "light"));
	const resolvedTheme = theme === "system" ? system : theme;

	useEffect(() => {
		const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
		if (!mq) return;
		const onChange = () => setSystem(mq.matches ? "dark" : "light");
		mq.addEventListener("change", onChange);
		return () => mq.removeEventListener("change", onChange);
	}, []);

	useEffect(() => {
		document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
	}, [resolvedTheme]);

	const setTheme = useCallback((t: string) => {
		const next: Theme = t === "light" || t === "dark" ? t : "system";
		setThemeState(next);
		try {
			if (next === "system") localStorage.removeItem(KEY);
			else localStorage.setItem(KEY, next);
		} catch {
			/* storage unavailable: theme still applies for this visit */
		}
	}, []);

	return <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
	return useContext(ThemeContext);
}
