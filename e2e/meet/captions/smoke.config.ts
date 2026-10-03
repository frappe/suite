import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "smoke.spec.ts",
  workers: 1,
  timeout: 20_000,
  reporter: "list",
  outputDir: "../test-results/captions-smoke",
  use: {
    browserName: "chromium",
    launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
  },
});
