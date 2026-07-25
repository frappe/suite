import path from "node:path"

import vue from "@vitejs/plugin-vue"
import { defineConfig } from "vitest/config"

export default defineConfig({
	plugins: [vue()],
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "src"),
			"~icons/lucide/scan": path.resolve(__dirname, "src/test/icon-stub.ts"),
		},
	},
	test: {
		environment: "jsdom",
		include: ["src/**/*.test.ts"],
		setupFiles: ["fake-indexeddb/auto"],
		silent: true,
	},
});
