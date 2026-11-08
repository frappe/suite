import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

/**
 * Captures every Drive UI state as a screenshot, walking the machines under
 * `flows/`. Not a test suite: one run per flow, no retries, one browser.
 *
 * Needs the same `suite.drive.e2e_api` server as `drive-backed-apps`: set
 * `BASE_URL`, `E2E_TEST_API_URL` (a `DEV_SERVER=1` frappe serve on another
 * port) and `E2E_BENCH_PATH` (the bench that serves the site).
 */
const baseURL = process.env.BASE_URL ?? "http://dev-suite-drive-ui-states.localhost:8021";
const defaultTestApiUrl = new URL(baseURL);
defaultTestApiUrl.port = "8095";
const testApiUrl = process.env.E2E_TEST_API_URL ?? defaultTestApiUrl.origin;
process.env.E2E_TEST_API_URL = testApiUrl;
const benchPath = process.env.E2E_BENCH_PATH;
if (!benchPath) throw new Error("E2E_BENCH_PATH must name the bench that serves BASE_URL");

export const OUT_DIR = resolve(__dirname, "out");

export default defineConfig({
	testDir: __dirname,
	testMatch: /capture\.spec\.ts/,
	outputDir: resolve(__dirname, ".runs"),
	// One spec file without fullyParallel: flows run one after another, since they share the users' Trash and Recent.
	fullyParallel: false,
	retries: 0,
	// Global setup provisions two users per configured worker: actor, peer, fresh, spare.
	workers: 2,
	timeout: 15 * 60_000,
	expect: { timeout: 10_000 },
	reporter: [["list"]],
	use: {
		baseURL,
		viewport: { width: 1440, height: 900 },
		actionTimeout: 15_000,
		navigationTimeout: 30_000,
		launchOptions: { args: ["--unsafely-treat-insecure-origin-as-secure=" + baseURL] },
	},
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
	webServer: {
		url: new URL("/api/method/suite.drive.e2e_api.provision_users", testApiUrl).href,
		command: `${resolve(benchPath, "env/bin/python")} -m frappe.utils.bench_helper frappe serve --port ${new URL(testApiUrl).port || "80"} --noreload`,
		cwd: resolve(benchPath, "sites"),
		env: { DEV_SERVER: "1" },
		reuseExistingServer: true,
		timeout: 120_000,
		gracefulShutdown: { signal: "SIGTERM" as const, timeout: 5_000 },
	},
	globalSetup: "./global-setup.ts",
	globalTeardown: "../drive-backed-apps/global-teardown.ts",
});
