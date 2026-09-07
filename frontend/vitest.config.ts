import path from "node:path"

import vue from "@vitejs/plugin-vue"
import { defineConfig } from "vitest/config"

export default defineConfig({
	plugins: [vue()],
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "src"),
			"frappe-ui": path.resolve(__dirname, "recorder/frappeUi.ts"),
			"~icons/lucide/scan": path.resolve(__dirname, "src/test/icon-stub.ts"),
			"~icons/lucide/chevron-down": path.resolve(__dirname, "src/test/icon-stub.ts"),
			"~icons/lucide/clock": path.resolve(__dirname, "src/test/icon-stub.ts"),
			"~icons/lucide/download": path.resolve(__dirname, "src/test/icon-stub.ts"),
			"~icons/lucide/external-link": path.resolve(__dirname, "src/test/icon-stub.ts"),
			"~icons/lucide/square-arrow-out-up-right": path.resolve(__dirname, "src/test/icon-stub.ts"),
			"~icons/lucide/eye": path.resolve(__dirname, "src/test/icon-stub.ts"),
			"~icons/lucide/info": path.resolve(__dirname, "src/test/icon-stub.ts"),
			"~icons/lucide/link-2": path.resolve(__dirname, "src/test/icon-stub.ts"),
			"~icons/lucide/arrow-left-right": path.resolve(__dirname, "src/test/icon-stub.ts"),
			"~icons/lucide/rotate-ccw": path.resolve(__dirname, "src/test/icon-stub.ts"),
			"~icons/lucide/share-2": path.resolve(__dirname, "src/test/icon-stub.ts"),
			"~icons/lucide/square-pen": path.resolve(__dirname, "src/test/icon-stub.ts"),
			"~icons/lucide/corner-left-up": path.resolve(__dirname, "src/test/icon-stub.ts"),
			"~icons/lucide/monitor-cog": path.resolve(__dirname, "src/test/icon-stub.ts"),
			"~icons/lucide/star": path.resolve(__dirname, "src/test/icon-stub.ts"),
			"~icons/lucide/trash": path.resolve(__dirname, "src/test/icon-stub.ts"),
		},
	},
	test: {
		environment: "jsdom",
		include: ["src/**/*.test.{js,ts}", "recorder/**/*.test.{js,ts}"],
		setupFiles: ["fake-indexeddb/auto"],
		retry: process.env.CI ? 2 : 0,
		silent: true,
		coverage: {
			provider: "v8",
			include: ["src/**/*.{js,ts,vue}", "recorder/**/*.{ts,vue}"],
			exclude: [
				"**/*.test.{js,ts}",
				"**/test-utils.{js,ts}",
				"src/apps/sheets/engine/difftest/**",
				"src/test/**",
			],
			reporter: ["text", "json-summary", "lcov", "cobertura"],
			reportsDirectory: "test-results/coverage",
		},
	},
});
