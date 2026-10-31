import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { openImport, openScenario } from "./helpers";

// Owner feedback: reviewing imported drafts lost the way back, publishing several needed a
// select-all, and the import page, Activity, and the deck page each reviewed the same drafts. Now
// the deck is home: the import lands there, Activity links each unfinished import to it, and the
// slide editor returns to it.

const FIXTURE = readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures", "Lab_Notes_2021.pptx"));

async function importPerSlide(page: Page) {
  await openImport(page);
  await page.getByLabel("File to import").setInputFiles({ name: "Lab_Notes_2021.pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", buffer: FIXTURE });
  await page.getByRole("radio", { name: /One post per slide/ }).click();
  await page.getByRole("button", { name: "Start import" }).click();
  await page.getByRole("button", { name: /^Create \d+ drafts$/ }).click({ timeout: 20_000 });
  await expect(page.getByText(/Created 8 drafts/)).toBeVisible();
  await expect(page).toHaveURL(/\/collections\/[^/?]+\?show=review$/); // landed on the deck, on what's left to review
  await expect(grid(page).getByRole("checkbox")).toHaveCount(8); // every card loaded (placeholders have no checkbox)
}
const grid = (page: Page) => page.getByRole("list", { name: "Posts in this collection" });
const cards = (page: Page) => grid(page).locator(":scope > li"); // (slide previews have bullet lists of their own)
const inApp = (page: Page, path: string) => page.evaluate((p) => (history.pushState({}, "", p), dispatchEvent(new PopStateEvent("popstate"))), path); // keeps the mock data

test("review imported slides on the deck, and always find the way back", async ({ page }) => {
  await openScenario(page, "small");
  await importPerSlide(page);
  await expect(page.getByRole("tab", { name: "To review (8)" })).toBeVisible();
  await expect(cards(page)).toHaveCount(8);
  await cards(page).first().getByRole("link").click(); // open slide 1's draft
  const trail = page.getByRole("navigation", { name: "Import" });
  await expect(trail).toContainText("slide 1 of 8");
  await expect(trail).toContainText("8 drafts to review");
  await expect(trail.getByRole("button", { name: "Previous imported draft" })).toBeDisabled();
  await trail.getByRole("link", { name: "Next imported draft" }).click();
  await expect(trail).toContainText("slide 2 of 8");
  await trail.getByRole("link", { name: "Previous imported draft" }).click();
  await expect(trail).toContainText("slide 1 of 8");
  await trail.getByRole("link", { name: "Back to deck" }).click();
  await expect(page.getByRole("tab", { name: "To review (8)" })).toBeVisible();

  // The composer's own back arrow and Publish also return to the deck.
  await cards(page).first().getByRole("link").click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("tab", { name: "To review (8)" })).toBeVisible();
  await cards(page).first().getByRole("link").click();
  await expect(trail).toContainText("slide 1 of 8"); // the composer has settled (a click mid-render can be lost)
  await page.getByRole("button", { name: /^Publish/ }).click();
  await expect(page.getByRole("tab", { name: "To review (7)" })).toBeVisible();
  await page.getByRole("tab", { name: "Published (1)" }).click();
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page).first()).toContainText("Cooldown overview");
  await page.getByRole("tab", { name: "To review (7)" }).click();

  // Select all → publish.
  await page.getByRole("checkbox", { name: "Select all posts" }).check();
  await expect(page.getByText("7 selected")).toBeVisible();
  await page.getByRole("button", { name: "Publish 7" }).click();
  await expect(page.getByText(/Published 7 posts/)).toBeVisible();
  await expect(page.getByRole("tab", { name: "Published (8)" })).toBeVisible();
  await expect(page.getByText(/Nothing left to review/)).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Select all posts" })).toHaveCount(0); // nothing to select
  await expect(page.getByRole("link", { name: "Present" })).toHaveAttribute("href", /\/present\?collection=/);
});

test("Activity lists each unfinished import once, and leads to its deck", async ({ page }) => {
  await openScenario(page, "small");
  await importPerSlide(page);
  // Make one draft unpublishable (no title).
  await cards(page).nth(1).getByRole("link").click();
  await expect(page.getByRole("navigation", { name: "Import" })).toBeVisible(); // in the editor
  await page.getByLabel("Title", { exact: true }).fill("");
  await page.getByLabel("Title", { exact: true }).blur();
  await expect(page.getByRole("status")).toContainText("Saved", { timeout: 10_000 });
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("checkbox", { name: "Select all posts" }).check();
  await page.getByRole("button", { name: "Publish 8" }).click();
  await expect(page.getByText(/Published 7\. 1 needs attention/)).toBeVisible();
  await expect(page.getByText("1 selected")).toBeVisible(); // still selected, ready to retry once fixed

  await page.getByRole("link", { name: "Activity" }).click();
  await page.getByRole("tab", { name: /Drafts/ }).click();
  const panel = page.getByRole("tabpanel", { name: "Drafts" });
  await expect(panel.getByRole("list", { name: "Drafts" }).getByText(/Lab_Notes_2021/)).toHaveCount(0); // not one by one
  const row = panel.getByRole("list", { name: "Unfinished imports" }).getByRole("link", { name: /Lab_Notes_2021\.pptx/ });
  await expect(row).toContainText("1 of 8 slides to review");
  await row.click();
  await expect(page.getByRole("tab", { name: "To review (1)", selected: true })).toBeVisible();
});

test("the deck review fits a phone", async ({ page }) => {
  await openScenario(page, "small");
  await importPerSlide(page);
  await page.setViewportSize({ width: 390, height: 844 });
  // The layout switches to the phone menu a frame after resizing.
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "test-results/import-review-phone.png", fullPage: true });
  await cards(page).first().getByRole("link").click();
  await expect(page.getByRole("navigation", { name: "Import" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "test-results/import-trail-phone.png" });
});

test("an unfinished import is easy to get back to", async ({ page }) => {
  await openScenario(page, "small");
  // Uploaded and parsed, but left at review without creating anything.
  await openImport(page);
  await page.getByLabel("File to import").setInputFiles({ name: "Left_halfway.pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", buffer: FIXTURE });
  await page.getByRole("button", { name: "Start import" }).click();
  await expect(page.getByRole("button", { name: /^Create \d+ drafts$/ })).toBeVisible({ timeout: 20_000 });
  // And one committed with drafts still to review.
  await inApp(page, new URL(page.url()).pathname);
  await importPerSlide(page);
  await openImport(page);

  const yours = page.getByRole("list", { name: "Your imports" });
  await expect(yours.getByRole("listitem")).toHaveCount(2);
  await expect(yours.getByRole("listitem").filter({ hasText: "Lab_Notes_2021.pptx" })).toContainText("0 of 8 published · 8 left to review");
  await yours.getByRole("listitem").filter({ hasText: "Lab_Notes_2021.pptx" }).getByRole("button").click();
  await expect(page.getByRole("tab", { name: "To review (8)", selected: true })).toBeVisible(); // a created import opens its deck
  await openImport(page);
  await yours.getByRole("listitem").filter({ hasText: "Left_halfway.pptx" }).getByText(/Ready to review/).click();
  await expect(page.getByRole("button", { name: /^Create \d+ drafts$/ })).toBeVisible(); // back in review, where it was left
});

test("an imported deck has its own page, like a notebook", async ({ page }) => {
  await openScenario(page, "small");
  await importPerSlide(page);
  await page.getByRole("button", { name: /^Publish all/ }).click();
  await expect(page.getByRole("tab", { name: "All (8)", selected: true })).toBeVisible(); // everything stays in view
  await expect(page.getByText("Imported slides")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Lab_Notes_2021"); // the collection is named after the file
  const links = grid(page).getByRole("link");
  await expect(links).toHaveCount(8);
  await expect(links.nth(1)).toContainText("Cooldown curve");
  await page.getByRole("button", { name: "More deck actions" }).click();
  await expect(page.getByRole("menuitem", { name: /Delete this import/ })).toBeVisible();
  const download = page.waitForEvent("download"); // the original deck is kept (provenance)
  await page.getByRole("menuitem", { name: /^Download original/ }).click();
  expect((await download).suggestedFilename()).toBe("Lab_Notes_2021.pptx");
  // A post opened from here comes back here.
  await links.nth(1).click();
  await page.getByRole("button", { name: /Back to Lab_Notes_2021/ }).click();
  await expect(page).toHaveURL(/\/collections\//);
  // The rail's Decks page lists it, and opens it here too, not in Search.
  await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Decks" }).click();
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

test("drafts stay in sync: discard on the deck, and Activity agrees", async ({ page }) => {
  await openScenario(page, "small");
  await importPerSlide(page);
  const deck = new URL(page.url()).pathname + "?show=review";
  await expect(cards(page)).toHaveCount(8);

  // Pick two drafts and discard them.
  await grid(page).getByRole("checkbox").nth(0).check();
  await grid(page).getByRole("checkbox").nth(1).check();
  await expect(page.getByText("2 selected")).toBeVisible();
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(page.getByText(/Discarded 2 posts/)).toBeVisible();
  await expect(cards(page)).toHaveCount(6);
  await expect(page.getByText("6 posts · 6 still drafts")).toBeVisible();

  // Undo puts them back in place.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(cards(page)).toHaveCount(8);

  // Discard two again (shift-click picks the range), then Activity shows the same 6.
  await grid(page).getByRole("checkbox").nth(0).check();
  await expect(page.getByText("1 selected")).toBeVisible();
  await grid(page).getByRole("checkbox").nth(1).click({ modifiers: ["Shift"] });
  await expect(page.getByText("2 selected")).toBeVisible();
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(cards(page)).toHaveCount(6);
  await page.getByRole("link", { name: "Activity" }).click();
  await page.getByRole("tab", { name: /Drafts/ }).click();
  await expect(page.getByRole("list", { name: "Unfinished imports" })).toContainText("6 of 6 slides to review");

  // Publish one on the deck: the tabs move it to Published.
  await inApp(page, deck);
  await grid(page).getByRole("checkbox").nth(0).check();
  await page.getByRole("button", { name: "Publish 1" }).click();
  await expect(page.getByText(/Published 1 post/)).toBeVisible();
  await expect(page.getByRole("tab", { name: "To review (5)" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Published (1)" })).toBeVisible();
});

test("combine drafts on the deck into one post, and split them back until it's published", async ({ page }) => {
  await openScenario(page, "small");
  await importPerSlide(page);
  await grid(page).getByRole("checkbox").nth(1).check();
  await expect(page.getByText("1 selected")).toBeVisible();
  await grid(page).getByRole("checkbox").nth(3).click({ modifiers: ["Shift"] }); // slides 2–4
  await page.getByRole("button", { name: "Combine into one post" }).click();
  await expect(page.getByText(/^Combined 3 slides into/)).toBeVisible();
  await expect(cards(page)).toHaveCount(6);
  await expect(page.getByRole("tab", { name: "To review (6)" })).toBeVisible();
  await expect(cards(page).nth(1)).toContainText("+2");

  // Open it: the trail says what's in it, and Split back restores the slides in place.
  await cards(page).nth(1).getByRole("link").click();
  const trail = page.getByRole("navigation", { name: "Import" });
  await expect(trail).toContainText("Combined with slide 3, slide 4");
  await trail.getByRole("button", { name: "Split back" }).click();
  await expect(page.getByText("Split back into separate slides")).toBeVisible();
  await expect(cards(page)).toHaveCount(8);
  await expect(page.getByRole("tab", { name: "To review (8)" })).toBeVisible();

  // Combine again from the deck, then undo from the message.
  await grid(page).getByRole("checkbox").nth(0).check();
  await grid(page).getByRole("checkbox").nth(1).check();
  await expect(page.getByText("2 selected")).toBeVisible();
  await page.getByRole("button", { name: "Combine into one post" }).click();
  await expect(cards(page)).toHaveCount(7);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(cards(page)).toHaveCount(8);
});

test("importing the same deck again points to the one already in the workspace", async ({ page }) => {
  await openScenario(page, "small");
  await importPerSlide(page);
  await openImport(page);
  await page.getByLabel("File to import").setInputFiles({ name: "Lab_Notes_2021 (1).pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", buffer: FIXTURE });
  await page.getByRole("button", { name: "Start import" }).click();
  const notice = page.getByRole("alert").filter({ hasText: /already imported this deck/ });
  await expect(notice).toContainText("You already imported this deck");
  await notice.getByRole("link", { name: "Open the deck" }).click();
  await expect(page).toHaveURL(/\/collections\//);
});

test("a deck can be kept to yourself at import", async ({ page }) => {
  await openScenario(page, "small");
  await openImport(page);
  await page.getByLabel("File to import").setInputFiles({ name: "Mine_only.pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", buffer: FIXTURE });
  await page.getByRole("button", { name: "Start import" }).click();
  await page.getByRole("checkbox", { name: /Share this deck with the workspace/ }).uncheck({ timeout: 20_000 });
  await page.getByRole("button", { name: /^Create \d+ drafts$/ }).click();
  await expect(page).toHaveURL(/\/collections\//);
  await expect(page.getByRole("button", { name: "More deck actions" })).toBeVisible();
});
