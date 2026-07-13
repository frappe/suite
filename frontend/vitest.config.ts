import path from "node:path"

import vue from "@vitejs/plugin-vue"
import { defineConfig } from "vitest/config"

export default defineConfig({
	plugins: [vue()],
	resolve: {
		alias: [
			{ find: "@", replacement: path.resolve(__dirname, "src") },
			{
				find: /^~icons\/.+$/,
				replacement: path.resolve(__dirname, "src/test/iconStub.ts"),
			},
		],
	},
	test: {
		environment: "jsdom",
		include: ["src/**/*.test.ts"],
		setupFiles: ["fake-indexeddb/auto"],
		silent: true,
	},
});
