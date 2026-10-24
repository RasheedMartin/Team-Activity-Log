import { expect, type Page } from "@playwright/test";

/** Seed a scenario through the dev settings and land in the app signed in as its default persona. */
export async function openScenario(page: Page, scenario: "empty" | "small" | "busy" | "multiOrg" | "viewer" = "small", at: "search" | "home" = "search") {
  await page.goto("/dev");
  // Let the mock finish its own first boot (it seeds a default scenario) before choosing ours,
  // or that boot can finish late and overwrite the choice.
  await expect(page.getByRole("heading", { name: "Mock controls" })).toBeVisible({ timeout: 30_000 });
  await page.evaluate((s) => {
    localStorage.setItem("tal.dev", JSON.stringify({ scenario: s, slowNetwork: false, randomErrors: false, indexLag: false, liveActivity: false }));
    localStorage.removeItem("tal.seeded");
  }, scenario);
  await page.goto("/");
  await expect(page.getByRole("button", { name: /new post|account menu/i }).first()).toBeVisible({ timeout: 30_000 });
  if (at === "search") {
    await page.getByRole("link", { name: "Search", exact: true }).click();
    await expect(page).toHaveURL(/\/search/);
    await expect(page.getByRole("combobox", { name: "Search" })).toBeVisible();
  }
}
