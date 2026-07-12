import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.BASE_URL ?? "http://localhost:8098";
const isCI = !!process.env.CI;

export default defineConfig({
	testDir: "./specs",
	// CI: one worker per job; --shard=N/M on GH splits the suite automatically.
	fullyParallel: !isCI,
	forbidOnly: isCI,
	retries: isCI ? 2 : 0,
	workers: isCI ? 1 : undefined,
	maxFailures: isCI ? 3 : undefined,
	timeout: isCI ? 90_000 : 60_000,
	expect: {
		timeout: 10_000,
	},
	reporter: isCI
		? [
				["list"],
				["github"],
				["html", { open: "never" }],
				["junit", { outputFile: "results.xml" }],
			]
		: [["list"], ["html", { open: "never" }]],
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
				channel: "chrome",
				launchOptions: {
					args: [
						"--use-fake-ui-for-media-stream",
						"--use-fake-device-for-media-stream",
						"--allow-insecure-localhost",
						"--autoplay-policy=no-user-gesture-required",
						`--unsafely-treat-insecure-origin-as-secure=${baseURL}`,
					],
				},
				permissions: ["camera", "microphone"],
			},
		},
	],
	globalSetup: "./global-setup.ts",
});
