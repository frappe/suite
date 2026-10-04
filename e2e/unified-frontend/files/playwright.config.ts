import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

const baseURL = process.env.BASE_URL ?? "http://slides.localhost:8086";
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
		storageState: resolve(__dirname, "../.state/admin.json"),
		trace: "on-first-retry",
		video: "on-first-retry",
		screenshot: "only-on-failure",
		viewport: { width: 1440, height: 900 },
		actionTimeout: 15_000,
		navigationTimeout: 30_000,
	},
	projects: [
		// Empty trash deletes the admin's whole personal Trash, which other
		// journeys read. As a teardown it runs once they have all finished.
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
			testIgnore: /empty-trash\.spec\.ts/,
			teardown: "empty-trash",
		},
		{ name: "empty-trash", use: { ...devices["Desktop Chrome"] }, testMatch: /empty-trash\.spec\.ts/ },
	],
	globalSetup: "../global-setup.ts",
});
