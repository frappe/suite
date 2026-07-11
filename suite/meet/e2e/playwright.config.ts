import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.BASE_URL ?? "http://localhost:8098";
const isCI = !!process.env.CI;

const chromiumUse = {
	...devices["Desktop Chrome"],
	channel: "chrome" as const,
	launchOptions: {
		args: [
			"--use-fake-ui-for-media-stream",
			// Chrome's built-in fake camera/mic (do NOT override getUserMedia).
			"--use-fake-device-for-media-stream",
			"--disable-background-timer-throttling",
			"--disable-backgrounding-occluded-windows",
			"--disable-renderer-backgrounding",
			"--disable-audio-track-processing",
			"--disable-webrtc-apm-in-audio-service",
			"--allow-insecure-localhost",
			"--autoplay-policy=no-user-gesture-required",
			`--unsafely-treat-insecure-origin-as-secure=${baseURL}`,
		],
	},
	permissions: ["camera", "microphone"],
};

export default defineConfig({
	testDir: "./specs",
	// CI: one worker per job; parallelize across GH Actions with --shard=N/M
	// so every specs/*.ts file is always included (no hardcoded allow-list).
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
			use: chromiumUse,
		},
	],
	globalSetup: "./global-setup.ts",
});
