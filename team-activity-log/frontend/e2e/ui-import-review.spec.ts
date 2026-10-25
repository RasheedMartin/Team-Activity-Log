import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { openScenario } from "./helpers";

// Owner feedback: reviewing imported drafts one by one lost the way back to the import, and
// publishing several drafts needed a select-all.

const FIXTURE = readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures", "Lab_Notes_2021.pptx"));

async function importPerSlide(page: Page) {
  await page.getByRole("complementary").getByRole("link", { name: "Import slides" }).click();
  await page.getByLabel("PowerPoint file").setInputFiles({ name: "Lab_Notes_2021.pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", buffer: FIXTURE });
  await page.getByRole("radio", { name: /One post per slide/ }).click();
  await page.getByRole("button", { name: "Start import" }).click();
  await page.getByRole("button", { name: /^Create \d+ drafts$/ }).click({ timeout: 20_000 });
  await expect(page.getByText(/Created 8 drafts/)).toBeVisible();
}

test("review imported drafts one by one, and always find the way back", async ({ page }) => {
  await openScenario(page, "small");
  await importPerSlide(page);
  const list = page.getByRole("list", { name: "Drafts" });
  await expect(list.getByRole("listitem")).toHaveCount(8);
  await list.getByRole("listitem").first().locator(".MuiListItemButton-root").click(); // open slide 1's draft
  const trail = page.getByRole("navigation", { name: "Import" });
  await expect(trail).toContainText("slide 1 of 8");
  await expect(trail).toContainText("8 drafts to review");
  await expect(trail.getByRole("button", { name: "Previous imported draft" })).toBeDisabled();
  await trail.getByRole("link", { name: "Next imported draft" }).click();
  await expect(trail).toContainText("slide 2 of 8");
  await trail.getByRole("link", { name: "Previous imported draft" }).click();
  await expect(trail).toContainText("slide 1 of 8");
  await trail.getByRole("link", { name: "Back to import" }).click();
  await expect(page.getByText(/Created 8 drafts/)).toBeVisible(); // the import's own page, where we left it

  // The composer's own back arrow and Publish also return to the import, not to Activity.
  await list.getByRole("listitem").first().locator(".MuiListItemButton-root").click();
  await page.getByRole("button", { name: "Back", exact: true }).click(); // opened from the import: back to it
  await expect(page.getByRole("tab", { name: "To review (8)" })).toBeVisible();
  await list.getByRole("listitem").first().locator(".MuiListItemButton-root").click();
  await page.getByRole("button", { name: /^Publish/ }).click();
  await expect(page.getByRole("tab", { name: "To review (7)" })).toBeVisible();
  await page.getByRole("tab", { name: "Published (1)" }).click();
  await expect(page.getByRole("list", { name: "Published from this import" }).getByText("Cooldown overview")).toBeVisible();
  await page.getByRole("tab", { name: "To review (7)" }).click();

  // All of the import's slides open in Present (where they can be downloaded as .pptx).
  await expect(page.getByRole("link", { name: "Present or download" })).toHaveAttribute("href", /\/present\?collection=/);

  // Select all → publish.
  await page.getByRole("checkbox", { name: "Select all drafts" }).check();
  await expect(page.getByText("7 selected")).toBeVisible();
  await page.getByRole("button", { name: "Publish 7" }).click();
  await expect(page.getByText(/Published 7 posts/)).toBeVisible();
  await expect(page.getByRole("tab", { name: "Published (8)" })).toBeVisible();
  await expect(page.getByText(/Nothing left to review/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Open the deck" })).toBeVisible();
});

test("drafts: select some, publish them; one that can't publish says why", async ({ page }) => {
  await openScenario(page, "small");
  await importPerSlide(page);
  // Make one draft unpublishable (no title).
  await page.getByRole("list", { name: "Drafts" }).getByRole("listitem").nth(1).locator(".MuiListItemButton-root").click();
  await page.getByLabel("Title").fill("");
  await page.getByLabel("Title").blur();
  await expect(page.getByRole("status")).toContainText("Saved", { timeout: 10_000 });
  await page.goto(page.url().replace(/\/p\/.*$/, "/activity/drafts"));
  const list = page.getByRole("list", { name: "Drafts" });
  await expect(list.getByText(/Lab_Notes_2021\.pptx · slide/).first()).toBeVisible(); // where each came from
  await page.getByRole("checkbox", { name: "Select all drafts" }).check();
  await page.getByRole("button", { name: /^Publish \d+$/ }).click();
  await expect(page.getByText(/Published \d+\. 1 needs attention/)).toBeVisible(); // the scenario has drafts of its own too
  await expect(list.getByText(/Can't publish yet: Add a title/)).toBeVisible();
  await expect(page.getByText("1 selected")).toBeVisible(); // still selected, ready to retry once fixed
  await expect(page.getByRole("link", { name: "Lab_Notes_2021.pptx" })).toBeVisible(); // back to the import
});

test("the import review fits a phone", async ({ page }) => {
  await openScenario(page, "small");
  await importPerSlide(page);
  await page.setViewportSize({ width: 390, height: 844 });
  // The layout switches to the phone menu a frame after resizing.
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "test-results/import-review-phone.png", fullPage: true });
  await page.getByRole("list", { name: "Drafts" }).getByRole("listitem").first().locator(".MuiListItemButton-root").click();
  await expect(page.getByRole("navigation", { name: "Import" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "test-results/import-trail-phone.png" });
});

test("an unfinished import is easy to get back to", async ({ page }) => {
  await openScenario(page, "small");
  // Uploaded and parsed, but left at review without creating anything.
  await page.getByRole("complementary").getByRole("link", { name: "Import slides" }).click();
  await page.getByLabel("PowerPoint file").setInputFiles({ name: "Left_halfway.pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", buffer: FIXTURE });
  await page.getByRole("button", { name: "Start import" }).click();
  await expect(page.getByRole("button", { name: /^Create \d+ drafts$/ })).toBeVisible({ timeout: 20_000 });
  // And one committed with drafts still to review.
  await page.goto(page.url().replace(/\?.*$/, ""));
  await importPerSlide(page);
  await page.goto(page.url().replace(/\?.*$/, ""));

  const yours = page.getByRole("list", { name: "Your imports" });
  await expect(yours.getByRole("listitem")).toHaveCount(2);
  await expect(yours.getByRole("listitem").filter({ hasText: "Lab_Notes_2021.pptx" })).toContainText("0 of 8 published · 8 left to review");
  await yours.getByRole("listitem").filter({ hasText: "Left_halfway.pptx" }).getByText(/Ready to review/).click();
  await expect(page.getByRole("button", { name: /^Create \d+ drafts$/ })).toBeVisible(); // back in review, where it was left
});

test("an imported deck has its own page, like a notebook", async ({ page }) => {
  await openScenario(page, "small");
  await importPerSlide(page);
  await page.getByRole("button", { name: "Publish all" }).click();
  await page.getByRole("link", { name: "Open the deck" }).click();
  await expect(page).toHaveURL(/\/collections\//);
  await expect(page.getByText("Imported slides")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Lab_Notes_2021"); // the collection is named after the file
  const cards = page.getByRole("list", { name: "Posts in this collection" }).getByRole("link");
  await expect(cards).toHaveCount(8);
  await expect(cards.nth(1)).toContainText("Cooldown curve");
  await expect(page.getByRole("link", { name: "Open import" })).toHaveAttribute("href", /\/import\?job=/);
  await expect(page.getByRole("link", { name: "Search within" })).toHaveAttribute("href", /\/search\?/);
  // A draft opened from here comes back here (not to the import).
  await cards.nth(1).click(); // open a post from the deck page…
  await page.getByRole("button", { name: /Back to Lab_Notes_2021/ }).click();
  await expect(page).toHaveURL(/\/collections\//);
  // The rail's Collections page lists it, and opens it here too, not in Search.
  await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Collections" }).click();
  await page.getByRole("main").getByRole("link", { name: /Lab_Notes_2021/ }).first().click();
  await expect(page).toHaveURL(/\/collections\//);
  // Present from here returns here.
  await page.getByRole("link", { name: "Present" }).click();
  await expect(page.getByText(/^1 \/ \d+$/)).toBeVisible();
  await page.getByRole("button", { name: "Exit presentation" }).click();
  await expect(page).toHaveURL(/\/collections\//);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "test-results/deck-page-phone.png" });
});

test("drafts stay in sync: discard from the collection, and Activity and the import agree", async ({ page }) => {
  await openScenario(page, "small");
  await importPerSlide(page);
  await expect(page.getByRole("tab", { name: "To review (8)" })).toBeVisible();
  await page.getByRole("link", { name: "Open the deck" }).click();
  const grid = page.getByRole("list", { name: "Posts in this collection" });
  const cards = grid.locator(":scope > li");
  const deck = new URL(page.url()).pathname; // (slide previews have bullet lists of their own)
  await expect(cards).toHaveCount(8);

  // Pick two drafts and discard them from the collection page.
  await grid.getByRole("checkbox").nth(0).check();
  await grid.getByRole("checkbox").nth(1).check();
  await expect(page.getByText("2 selected")).toBeVisible();
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(page.getByText(/Discarded 2 posts/)).toBeVisible();
  await expect(cards).toHaveCount(6);
  await expect(page.getByText("6 posts · 6 still drafts")).toBeVisible();

  // Undo puts them back in place.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(cards).toHaveCount(8);

  // Discard again, then the import and Activity show the same 6.
  await page.getByRole("checkbox", { name: "Select all posts" }).check();
  await grid.getByRole("checkbox").nth(2).uncheck();
  await grid.getByRole("checkbox").nth(3).uncheck();
  await grid.getByRole("checkbox").nth(4).uncheck();
  await grid.getByRole("checkbox").nth(5).uncheck();
  await grid.getByRole("checkbox").nth(6).uncheck();
  await grid.getByRole("checkbox").nth(7).uncheck();
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(cards).toHaveCount(6);
  await page.getByRole("link", { name: "Open import" }).click();
  await expect(page.getByRole("tab", { name: "To review (6)" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Drafts" }).getByRole("listitem")).toHaveCount(6);
  await page.getByRole("link", { name: "Activity" }).click();
  await page.getByRole("tab", { name: /Drafts/ }).click();
  await expect(page.getByRole("tabpanel", { name: "Drafts" }).getByRole("list", { name: "Drafts" }).getByRole("listitem").filter({ hasText: "Lab_Notes_2021" })).toHaveCount(6);

  // Publish from the collection: the import moves it to Published.
  await page.evaluate((p) => (history.pushState({}, "", p), dispatchEvent(new PopStateEvent("popstate"))), deck); // in-app, keeps the mock data
  await grid.getByRole("checkbox").nth(0).check();
  await page.getByRole("button", { name: "Publish 1" }).click();
  await expect(page.getByText(/Published 1 post/)).toBeVisible();
  await page.getByRole("link", { name: "Open import" }).click();
  await expect(page.getByRole("tab", { name: "To review (5)" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Published (1)" })).toBeVisible();
});
