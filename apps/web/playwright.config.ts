import { defineConfig, devices } from "@playwright/test";

const webPort = Number(process.env.PLAYWRIGHT_WEB_PORT ?? 5173);
const apiPort = Number(process.env.PLAYWRIGHT_API_PORT ?? 3001);

export default defineConfig({
  testDir: "./src/test/smoke",
  timeout: 30_000,
  workers: 1,
  webServer: {
    command: "pnpm --dir ../.. dev",
    url: `http://127.0.0.1:${webPort}/library`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PORT: String(apiPort),
      REPO_BOOKS_DB_PATH: ":memory:",
      VITE_API_TARGET: `http://127.0.0.1:${apiPort}`,
      VITE_PORT: String(webPort)
    }
  },
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
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
