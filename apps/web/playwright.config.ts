import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./src/test/smoke",
  timeout: 30_000,
  workers: 1,
  webServer: {
    command: "pnpm --dir ../.. dev",
    url: "http://127.0.0.1:5173/library",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      REPO_BOOKS_DB_PATH: ":memory:"
    }
  },
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "on-first-retry",
    channel: process.env.PLAYWRIGHT_CHANNEL
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } },
    {
      name: "mobile",
      use: {
        ...devices["Pixel 7"],
        browserName: "chromium"
      }
    }
  ]
});
