import { expect, test } from "@playwright/test";
import { openScenario } from "./helpers";

test("shell renders the feed on mock data", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openScenario(page, "small");
  await expect(page).toHaveURL(/\/o\/halvorsen-lab\/w\/detector/);
  await expect(page.getByRole("link", { name: "Feed" })).toBeVisible();
  await expect(page.locator("[data-post-id]").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("empty org shows an empty state, not a blank page", async ({ page }) => {
  await openScenario(page, "empty");
  await expect(page.getByText(/write the first post|nothing here yet|no posts/i).first()).toBeVisible();
});

test("signing out leads to sign-in with the persona picker", async ({ page }) => {
  await openScenario(page, "small");
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByText("Marcus Lindqvist").click();
  await expect(page.getByRole("button", { name: "Account menu" })).toContainText("Marcus");
});
