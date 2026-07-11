import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.BASE_URL ?? "http://localhost:8098";
const isCI = !!process.env.CI;

// Weight-balanced shards (not Playwright --shard=N/M). Select with --project=shard-N.
const shardTestMatch: Record<string, RegExp[]> = {
	"shard-1": [
		/chat\.spec\.ts/,
		/engagement\.spec\.ts/,
		/host-controls\.spec\.ts/,
		/join-and-leave\.spec\.ts/,
	],
	"shard-2": [/restricted-meeting\.spec\.ts/, /media-controls\.spec\.ts/],
	"shard-3": [/e2ee\.spec\.ts/, /multi-participant\.spec\.ts/],
};

const chromiumUse = {
	...devices["Desktop Chrome"],
	channel: "chrome" as const,
	launchOptions: {
		args: [
			"--use-fake-ui-for-media-stream",
			// Chrome's built-in fake camera/mic (do NOT override getUserMedia).
			// File-based y4m is optional; the default fake device encodes reliably
			// on headless Linux and produces decoded frames (readyState 4).
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
	projects: isCI
		? Object.entries(shardTestMatch).map(([name, testMatch]) => ({
				name,
				testMatch,
				use: chromiumUse,
			}))
		: [
				{
					name: "chromium",
					use: chromiumUse,
				},
			],
	globalSetup: "./global-setup.ts",
});
