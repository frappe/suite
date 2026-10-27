import { defineConfig } from "@playwright/test";

const baseURL = process.env.BASE_URL ?? "http://localhost:8098";
export default defineConfig({
	testDir: ".",
	testMatch: "pilot.spec.ts",
	workers: 1,
	retries: 0,
	timeout: 20 * 60_000,
	reporter: "list",
	outputDir:
		process.env.MEET_TRANSCRIPTION_OUTPUT ??
		"/tmp/meet-transcription-pilot-results",
	use: {
		baseURL,
		actionTimeout: 15_000,
		navigationTimeout: 30_000,
		trace: "off",
		video: "off",
		screenshot: "off",
		browserName: "chromium",
		permissions: ["camera", "microphone"],
		launchOptions: {
			executablePath: process.env.MEET_PILOT_CHROMIUM,
			args: [
				"--no-sandbox",
				"--use-fake-ui-for-media-stream",
				"--use-fake-device-for-media-stream",
				"--autoplay-policy=no-user-gesture-required",
				`--unsafely-treat-insecure-origin-as-secure=${baseURL}`,
			],
		},
	},
});
