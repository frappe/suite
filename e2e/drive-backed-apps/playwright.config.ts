import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

const baseURL = process.env.BASE_URL ?? "http://drive-layer.localhost:8084";
const isCI = !!process.env.CI;
// Google Chrome on macOS does not exit when Playwright closes it (its updater keeps running), so every
// worker hangs for five minutes at the end of a run. Point this at a Chrome for Testing binary there.
const chromeExecutable = process.env.E2E_CHROME_PATH;

// `suite.drive.e2e_api` is only served by a Frappe server started with DEV_SERVER=1. CI's `bench start`
// is one, so CI needs nothing extra. Locally the bench runs without it, so Playwright starts a second
// `frappe serve` (default port 8094, same sites) and stops it after the run. An already running server
// at E2E_TEST_API_URL is reused. E2E_BENCH_PATH overrides the bench directory, which defaults to the
// one this repo is checked out in (<bench>/apps/suite).
if (!isCI && !process.env.E2E_TEST_API_URL) {
	const url = new URL(baseURL);
	url.port = "8094";
	process.env.E2E_TEST_API_URL = url.origin;
}
const testApiUrl = process.env.E2E_TEST_API_URL;
const benchPath = resolve(process.env.E2E_BENCH_PATH ?? resolve(__dirname, "../../../.."));
const testApiServer =
	testApiUrl && testApiUrl !== baseURL
		? {
				// GET on a POST-only test method answers 403 on a DEV_SERVER server and 417 on any other.
				url: new URL("/api/method/suite.drive.e2e_api.provision_users", testApiUrl).href,
				command: `${resolve(benchPath, "env/bin/python")} -m frappe.utils.bench_helper frappe serve --port ${new URL(testApiUrl).port || "80"} --noreload`,
				cwd: resolve(benchPath, "sites"),
				env: { ...process.env, DEV_SERVER: "1" } as Record<string, string>,
				reuseExistingServer: true,
				timeout: 120_000,
				gracefulShutdown: { signal: "SIGTERM" as const, timeout: 5_000 },
			}
		: undefined;

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
			use: {
				...devices["Desktop Chrome"],
				...(chromeExecutable
					? { launchOptions: { executablePath: chromeExecutable } }
					: { channel: "chrome" }),
			},
		},
	],
	...(testApiServer ? { webServer: testApiServer } : {}),
	globalSetup: "./global-setup.ts",
	globalTeardown: "./global-teardown.ts",
});
