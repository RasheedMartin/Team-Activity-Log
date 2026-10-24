import { defineConfig, devices } from "@playwright/test";

// Default: the app in mock mode on its own port (doesn't collide with `npm run dev`).
// E2E_API=live: the same suite against the real FastAPI backend (Postgres + Elasticsearch from
// backend/.env). Tests reseed the one shared backend, so live runs use a single worker.
const LIVE = process.env.E2E_API === "live";

export default defineConfig({
  testDir: "e2e",
  timeout: LIVE ? 120_000 : 60_000,
  expect: { timeout: 10_000 }, // seeding the 5,000-post scenario in a parallel worker slows everyone down
  fullyParallel: false,
  workers: LIVE ? 1 : 2,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["html", { open: "never" }], ["list"]] : "list",
  use: { baseURL: LIVE ? "http://localhost:4175" : "http://localhost:4174", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: LIVE
    ? [
        {
          command: "../backend/.venv/bin/tal serve --port 8010",
          cwd: "../backend",
          url: "http://localhost:8010/v1/health",
          // Its own database and index, so a test run never touches your local dev data.
          env: { DATABASE_URL: process.env.E2E_DATABASE_URL ?? "postgresql://tal:tal@localhost:5433/tal_e2e", DEV_MODE: "true", DEV_ALLOW_RESET: "true", EMAIL_PROVIDER: "log", ELASTICSEARCH_REFRESH: "wait_for", ELASTICSEARCH_INDEX_PREFIX: "tal_e2e" },
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
        },
        {
          command: "npx vite --port 4175 --strictPort",
          url: "http://localhost:4175",
          env: { VITE_API_MODE: "live", VITE_API_PROXY: "http://localhost:8010" },
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
        },
      ]
    : { command: "npx vite --port 4174 --strictPort", url: "http://localhost:4174", reuseExistingServer: !process.env.CI, timeout: 60_000 },
});
