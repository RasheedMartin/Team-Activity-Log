import { defineConfig, devices } from "@playwright/test";

// E2E runs against the app in mock mode on its own port (doesn't collide with `npm run dev`).
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["html", { open: "never" }], ["list"]] : "list",
  use: { baseURL: "http://localhost:4174", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: { command: "npx vite --port 4174 --strictPort", url: "http://localhost:4174", reuseExistingServer: !process.env.CI, timeout: 60_000 },
});
