import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

const baseURL = process.env.BASE_URL ?? "http://localhost:8098";
const isCI = !!process.env.CI;
const meetGroup = process.env.MEET_E2E_GROUP;

if (meetGroup && !["1", "2", "3"].includes(meetGroup)) {
	throw new Error(`Invalid MEET_E2E_GROUP: ${meetGroup}`);
}

export default defineConfig({
	testDir: "./specs",
	fullyParallel: true,
	forbidOnly: isCI,
	grep:
		meetGroup === "1"
			? /@meet-group-1/
			: meetGroup === "2"
				? /@meet-group-2/
				: undefined,
	grepInvert: meetGroup === "3" ? /@meet-group-[12]/ : undefined,
	outputDir: resolve(__dirname, "test-results"),
	retries: isCI ? 2 : 0,
	workers: 1,
	maxFailures: isCI ? 3 : undefined,
	timeout: isCI ? 90_000 : 60_000,
	expect: {
		timeout: 10_000,
	},
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
		trace: "retain-on-failure",
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
		...(!isCI
			? [
					{
						name: "firefox",
						use: {
							...devices["Desktop Firefox"],
							launchOptions: {
								firefoxUserPrefs: {
									"media.peerconnection.ice.obfuscate_host_addresses": false,
									"media.navigator.permission.disabled": true,
									"media.navigator.streams.fake": true,
									"media.autoplay.default": 0,
								},
							},
						},
					},
				]
			: []),
	],
	globalSetup: "./global-setup.ts",
});
