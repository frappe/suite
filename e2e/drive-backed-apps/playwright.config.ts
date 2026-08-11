import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

const baseURL = process.env.BASE_URL ?? "http://suite.local:8098";
const isCI = !!process.env.CI;

export default defineConfig({
	testDir: "./specs",
	fullyParallel: true,
	forbidOnly: isCI,
	outputDir: resolve(__dirname, "test-results"),
	retries: isCI ? 2 : 0,
	workers: 2,
	timeout: isCI ? 90_000 : 60_000,
	expect: { timeout: 10_000 },
	reporter: isCI
		? [
				["list"],
				["github"],
				["html", { open: "never", outputFolder: resolve(__dirname, "playwright-report") }],
				["junit", { outputFile: resolve(__dirname, "results.xml") }],
			]
		: [
				["list"],
				["html", { open: "never", outputFolder: resolve(__dirname, "playwright-report") }],
			],
	use: {
		baseURL,
		trace: "on-first-retry",
		video: "on-first-retry",
		screenshot: "only-on-failure",
		viewport: { width: 1440, height: 900 },
		actionTimeout: 15_000,
		navigationTimeout: 30_000,
	},
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"], channel: "chrome" },
		},
	],
	globalSetup: "./global-setup.ts",
	globalTeardown: "./global-teardown.ts",
});
