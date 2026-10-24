import { expect, type Page } from "@playwright/test";

/** Seed a scenario through the dev settings and land in the app signed in as its default persona. */
export async function openScenario(page: Page, scenario: "empty" | "small" | "busy" | "multiOrg" | "viewer" = "small") {
  await page.goto("/dev");
  await page.evaluate((s) => {
    localStorage.setItem("tal.dev", JSON.stringify({ scenario: s, slowNetwork: false, randomErrors: false, indexLag: false, liveActivity: false }));
    localStorage.removeItem("tal.seeded");
  }, scenario);
  await page.goto("/");
  await expect(page.getByRole("button", { name: /new post|account menu/i }).first()).toBeVisible({ timeout: 30_000 });
}
