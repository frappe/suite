import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.BASE_URL ?? "http://localhost:8098";
const isCI = !!process.env.CI;

// Weight-balanced shards (not Playwright --shard=N/M, which splits by test
// index and leaves e2ee/media piled on one runner while another only gets light
// UI tests + skipped heavy e2ee). Select with --project=shard-N.
const shardTestMatch: Record<string, RegExp[]> = {
	// Light UI + signaling (~even wall time with serial workers=1)
	"shard-1": [
		/chat\.spec\.ts/,
		/engagement\.spec\.ts/,
		/host-controls\.spec\.ts/,
		/join-and-leave\.spec\.ts/,
	],
	// Restricted lobby + media controls (one heavy media file)
	"shard-2": [/restricted-meeting\.spec\.ts/, /media-controls\.spec\.ts/],
	// E2EE + multi-participant video (media-heavy; heavy e2ee stays skipped in CI)
	"shard-3": [/e2ee\.spec\.ts/, /multi-participant\.spec\.ts/],
};

const chromiumUse = {
	...devices["Desktop Chrome"],
	channel: "chrome" as const,
	launchOptions: {
		args: [
			"--use-fake-ui-for-media-stream",
			// Real I420 fake camera/mic — encodes on headless Linux unlike canvas stubs.
			"--use-fake-device-for-media-stream",
			// Keep timers alive across multi-page WebRTC tests in CI.
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
	// CI: serial within each GH Actions project-shard (multi-worker → DB deadlocks).
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
