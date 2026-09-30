import { defineConfig } from "@playwright/test";

const baseURL = process.env.BASE_URL ?? "http://localhost:8098";
export default defineConfig({
  testDir: ".",
  testMatch: "captions.spec.ts",
  workers: 1,
  retries: 0,
  timeout: 180_000,
  reporter: "list",
  globalSetup: "./global-setup.ts",
  use: {
    baseURL,
    browserName: "chromium",
    trace: "off",
    video: "off",
    screenshot: "off",
    launchOptions: { args: [
      "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
      `--unsafely-treat-insecure-origin-as-secure=${baseURL}`,
    ] },
  },
});
