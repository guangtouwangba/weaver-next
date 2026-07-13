import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e", outputDir: "test-results/playwright", timeout: 45_000, fullyParallel: false, workers: 1, retries: 0,
  reporter: [["list"], ["html", { outputFolder: "test-results/playwright-report", open: "never" }]],
  use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, trace: "retain-on-failure", screenshot: "only-on-failure", video: "retain-on-failure" },
});
