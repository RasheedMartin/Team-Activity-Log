import { expect, type Page } from "@playwright/test";

/** E2E_API=live runs the same suite against the real backend (Postgres + Elasticsearch). */
export const LIVE = process.env.E2E_API === "live";
const SCENARIO_LABEL = { empty: "Empty org", small: "Small team", busy: "Busy org", multiOrg: "Multi-org user", viewer: "Viewer only" } as const;

/** Seed a scenario through the dev settings and land in the app signed in as its default persona. */
export async function openScenario(page: Page, scenario: "empty" | "small" | "busy" | "multiOrg" | "viewer" = "small", at: "search" | "home" = "search") {
  await page.goto("/dev");
  if (LIVE) {
    // The Dev page seeds the backend's Postgres + Elasticsearch through /v1/dev/load.
    await page.getByRole("button", { name: new RegExp(`^${SCENARIO_LABEL[scenario]}`) }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/dev"), { timeout: 120_000 });
  } else {
    // Let the mock finish its own first boot (it seeds a default scenario) before choosing ours,
    // or that boot can finish late and overwrite the choice.
    await expect(page.getByRole("heading", { name: "Mock controls" })).toBeVisible({ timeout: 30_000 });
    await page.evaluate((s) => {
      localStorage.setItem("tal.dev", JSON.stringify({ scenario: s, slowNetwork: false, randomErrors: false, indexLag: false, liveActivity: false }));
      localStorage.removeItem("tal.seeded");
    }, scenario);
    await page.goto("/");
  }
  await expect(page.getByRole("button", { name: /new post|account menu/i }).first()).toBeVisible({ timeout: 30_000 });
  if (at === "search") {
    await page.getByRole("link", { name: "Search", exact: true }).click();
    await expect(page).toHaveURL(/\/search/);
    await expect(page.getByRole("combobox", { name: "Search" })).toBeVisible();
  }
}

/** Import slides starts on the Decks page (rail → Decks → Import slides). */
export async function openImport(page: Page) {
  await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Decks" }).click();
  await page.getByRole("main").getByRole("link", { name: "Import slides" }).click();
}

/** A notebook action under its ⋯ menu (Add posts, Reorder or remove, Share…, Delete notebook…). */
export async function notebookAction(page: Page, item: string | RegExp) {
  await page.getByRole("button", { name: "Notebook actions" }).click();
  await page.getByRole("menuitem", { name: item }).click();
}
