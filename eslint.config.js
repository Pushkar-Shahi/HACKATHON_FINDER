import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
	{ ignores: ["dist", ".wrangler", "worker-configuration.d.ts", "drizzle/migrations/meta", "public/theme-init.js"] },
	{
		extends: [js.configs.recommended, ...tseslint.configs.recommended],
		files: ["**/*.{ts,tsx}"],
		languageOptions: {
			ecmaVersion: 2022,
			globals: { ...globals.browser, ...globals.serviceworker },
		},
		plugins: {
			"react-hooks": reactHooks,
			"react-refresh": reactRefresh,
		},
		rules: {
			...reactHooks.configs.recommended.rules,
			"react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
			"@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
		},
	},
	{
		// Generated shadcn/ui primitives export variants alongside components.
		files: ["src/react-app/components/ui/**/*.tsx"],
		rules: { "react-refresh/only-export-components": "off" },
	},
	{
		// Tests read loosely-typed JSON response bodies.
		files: ["tests/**/*.{ts,tsx}"],
		rules: { "@typescript-eslint/no-explicit-any": "off" },
	},
	{
		files: ["scripts/**/*.mjs"],
		languageOptions: { globals: globals.node },
	},
);
