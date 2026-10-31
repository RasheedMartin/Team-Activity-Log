import { expect, test } from "@playwright/test";
import { openScenario } from "./helpers";

// Owner request: build a deck without PowerPoint. New deck → add slides from layouts (each opens
// in the slide editor) or existing posts → reorder → publish → present → delete.

test("build a deck slide by slide, reorder it, present it, delete it", async ({ page }) => {
  await openScenario(page, "small");
  await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Decks" }).click();
  await page.getByRole("button", { name: "New deck" }).click();
  await page.getByRole("dialog").getByLabel("Name").fill("Q3 detector review");
  await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("heading", { name: "Q3 detector review" })).toBeVisible();
  await expect(page.getByText("No slides yet")).toBeVisible();

  // Two slides from layouts; each opens in the editor, and Back returns to the deck.
  for (const [layout, title] of [["Title slide", "Q3 at a glance"], ["Title and text", "Timing resolution"]] as const) {
    await page.getByRole("button", { name: "Add slide" }).click();
    await page.getByRole("menuitem", { name: layout }).click();
    await expect(page).toHaveURL(/\/p\/[^/]+\/edit$/);
    await page.getByLabel("Title", { exact: true }).fill(title);
    await expect(page.getByRole("status")).toContainText("Saved", { timeout: 10_000 });
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Q3 detector review" })).toBeVisible();
  }
  const cards = page.getByRole("list", { name: "Posts in this collection" }).locator(":scope > li"); // not the bullets inside previews
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText("Q3 at a glance");

  // Reorder.
  await page.getByRole("button", { name: "Move Timing resolution earlier" }).click();
  await expect(cards.nth(0)).toContainText("Timing resolution");
  await expect(page.getByRole("button", { name: "Move Timing resolution earlier" })).toBeDisabled();

  // An existing post can be a slide too.
  await page.getByRole("button", { name: "Add posts" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("list", { name: "Posts to add" }).getByRole("checkbox").first().click();
  await dialog.getByRole("button", { name: /^Add/ }).click();
  await expect(cards).toHaveCount(3);

  // Publish the drafts, then present in deck order.
  await page.getByRole("button", { name: "Publish all 2" }).click();
  await expect(page.getByText("Published 2 slides")).toBeVisible();
  await page.getByRole("link", { name: "Present" }).click();
  await expect(page).toHaveURL(/present\?collection=/);
  await page.goBack();

  // Delete the deck and the slides made for it.
  await page.getByRole("button", { name: "More deck actions" }).click();
  await page.getByRole("menuitem", { name: "Delete deck…" }).click();
  await expect(page.getByLabel("Also delete my slides in it")).toBeChecked();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL(/\/collections$/);
  await expect(page.getByText("Q3 detector review")).toHaveCount(0);
});
