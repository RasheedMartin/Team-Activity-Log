import { expect, test } from "@playwright/test";
import { openScenario } from "./helpers";

test("shell renders the feed on mock data", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openScenario(page, "small");
  await expect(page).toHaveURL(/\/o\/halvorsen-lab\/w\/detector/);
  await expect(page.getByRole("link", { name: "Search", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.locator("[data-post-id]").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("empty org shows an empty state, not a blank page", async ({ page }) => {
  await openScenario(page, "empty");
  await expect(page.getByText(/write the first post|nothing here yet|no posts/i).first()).toBeVisible();
});

test("signing out leads home; sign-in has the persona picker and a way back", async ({ page }) => {
  await openScenario(page, "small");
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole("banner").getByRole("link", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByRole("link", { name: "Home" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Find it in seconds");
  await page.getByRole("banner").getByRole("link", { name: "Sign in" }).click();
  await page.getByText("Marcus Lindqvist").click();
  await expect(page.getByRole("button", { name: "Account menu" })).toContainText("Marcus");
});

test("a workspace opens on Home, which leads into Search", async ({ page }) => {
  await openScenario(page, "small", "home");
  await expect(page.getByRole("link", { name: "Home", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("region", { name: "Latest posts" })).toBeVisible();
  await expect(page.getByRole("main").getByRole("textbox")).toHaveCount(0); // Home browses; Search searches
  await page.getByRole("link", { name: "See all in Search" }).click();
  await expect(page.getByRole("heading", { name: /All posts/ })).toBeVisible();
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.getByRole("region", { name: "Latest posts" })).toBeVisible();
  await page.keyboard.press("/");
  await expect(page).toHaveURL(/\/search$/);
  await expect(page.getByRole("combobox", { name: "Search" })).toBeFocused();
});

test("visitors get the landing page; signed-in people go straight to their workspace", async ({ page }) => {
  await openScenario(page, "small");
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Find it in seconds");
  // A feature card plays that feature in the demo beside the cards (the hero keeps the search demo).
  await expect(page.getByRole("img", { name: /^Preview of Search/ })).toBeVisible();
  const importCard = page.getByRole("button", { name: /^Import slides/ });
  await importCard.click();
  await expect(importCard).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("img", { name: /^Preview of importing slides/ })).toBeInViewport();
  await expect(importCard).toBeInViewport();
  await expect(page.getByRole("img", { name: /^Preview of Search/ })).toBeAttached();
  await page.getByRole("banner").getByRole("link", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByText("Dana Okafor").click();
  await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible();
  await page.goto("/");
  await expect(page).toHaveURL(/\/o\/[^/]+\/w\/[^/]+$/);
  // Signed in, the public home page is one click away in the account menu.
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: /^About / }).click();
  await expect(page).toHaveURL(/\/about$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Find it in seconds");
  await page.getByRole("link", { name: "Open your workspace" }).first().click();
  await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible();
});
