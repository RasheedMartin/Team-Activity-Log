import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { openScenario } from "./helpers";

// Slides step 4: themes for text slides — chosen in Present, saved with the post, and an imported
// deck's own look used for its text slides.

const FIXTURE = readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures", "Formatting_2024.pptx"));
const surface = (page: import("@playwright/test").Page) => page.locator("[data-slide-surface]").first();

test("pick a theme in Present; it's saved with the post", async ({ page }) => {
  await openScenario(page, "small");
  await page.getByRole("button", { name: "New post" }).click();
  await page.getByLabel("Title").fill("Theme me");
  await page.getByLabel("Text block 1").click();
  await page.keyboard.type("Some findings.");
  await page.getByRole("button", { name: /Publish/ }).click();
  await page.getByRole("button", { name: "Present" }).click();
  await expect(surface(page)).toHaveCSS("background-color", "rgb(255, 255, 255)"); // Classic
  await page.getByRole("button", { name: "Slide theme" }).click();
  await expect(page.getByText("Saved with this post.")).toBeVisible();
  await page.getByRole("button", { name: "Theme Midnight" }).click();
  await expect(surface(page)).toHaveCSS("background-color", "rgb(15, 23, 42)");
  await page.reload();
  await expect(surface(page)).toHaveCSS("background-color", "rgb(15, 23, 42)");
  await expect(page.getByText("Theme me", { exact: true })).toHaveCSS("color", "rgb(255, 255, 255)");
});

test("an imported deck's text slides present in the deck's look", async ({ page }) => {
  await openScenario(page, "small");
  await page.getByRole("complementary").getByRole("link", { name: "Import slides" }).click();
  await page.getByLabel("PowerPoint file").setInputFiles({ name: "Formatting_2024.pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", buffer: FIXTURE });
  await page.getByRole("radio", { name: /One post for the deck/ }).click();
  await page.getByRole("radio", { name: /^Text only/ }).click();
  await page.getByRole("button", { name: "Start import" }).click();
  await page.getByRole("button", { name: /^Create 1 draft$/ }).click({ timeout: 20_000 });
  await page.getByRole("button", { name: "Publish all" }).click();
  await page.getByRole("link", { name: "Search these slides" }).click();
  await page.locator("[data-post-id]").first().getByRole("heading").click();
  await page.getByRole("button", { name: "Present" }).click();
  await expect(surface(page)).toHaveCSS("background-color", "rgb(247, 249, 252)"); // the deck's #f7f9fc
  await page.getByRole("button", { name: "Slide theme" }).click();
  await expect(page.getByRole("button", { name: "Theme From the deck" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Theme Paper" }).click();
  await expect(surface(page)).toHaveCSS("background-color", "rgb(251, 248, 241)");
  await page.getByRole("button", { name: "Slide theme" }).click();
  await page.getByRole("button", { name: "Theme From the deck" }).click(); // the deck's look can be chosen again
  await expect(surface(page)).toHaveCSS("background-color", "rgb(247, 249, 252)");
});

test("Present's controls and theme picker fit a phone", async ({ page }) => {
  await openScenario(page, "small");
  await page.locator("[data-post-id]").first().click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Present" }).click();
  await expect(surface(page)).toBeVisible();
  const exitBox = (await page.getByRole("button", { name: "Exit presentation" }).boundingBox())!;
  expect(exitBox.x + exitBox.width).toBeLessThanOrEqual(390); // every control reachable
  await page.getByRole("button", { name: "Slide theme" }).click();
  await page.waitForTimeout(300); // the picker fades in
  const last = page.getByRole("button", { name: "Theme Mono" });
  const b = (await last.boundingBox())!;
  expect(b.x + b.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "test-results/themes-phone.png" });
});
