import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";

// The Cloudflare Vite plugin runs the Worker (src/worker/index.ts) inside the
// real workerd runtime during `npm run dev`, and `vite build` emits both the
// client bundle and a deployable Worker into dist/.
export default defineConfig({
	plugins: [react(), tailwindcss(), cloudflare()],
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "src/react-app"),
			"@shared": path.resolve(__dirname, "src/shared"),
		},
	},
});
