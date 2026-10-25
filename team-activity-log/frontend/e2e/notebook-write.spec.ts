import { expect, test } from "@playwright/test";
import { openScenario, notebookAction } from "./helpers";

// Owner request: a notebook you write in. Start one empty, write pages in it (each page is a post,
// a private draft until published), pull in anyone's posts, and delete it with the option to
// delete only the pages you wrote.

test("write a notebook: empty, write pages, pull in posts, delete with my pages, undo", async ({ page }) => {
  await openScenario(page, "small");
  await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Notebooks" }).click();
  await page.getByRole("button", { name: "New notebook" }).click();
  await page.getByRole("dialog").getByLabel("Name").fill("Detector lab book");
  await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();
  await expect(page.getByLabel("Notebook title")).toHaveValue("Detector lab book");
  await expect(page.getByText("This notebook is empty")).toBeVisible();

  // Write the first page and publish it: back to the notebook, on that page.
  await page.getByRole("button", { name: "Write a page" }).first().click();
  await expect(page).toHaveURL(/\/p\/[^/]+\/edit$/);
  await page.getByLabel("Title", { exact: true }).fill("Day 1: shielding");
  await page.getByLabel("Text block 1").click();
  await page.keyboard.type("Copper tape on the east side; noise down by half.");
  await expect(page.getByRole("status")).toContainText("Saved", { timeout: 10_000 });
  await page.getByRole("button", { name: /^Publish/ }).click();
  await expect(page.getByLabel("Notebook title")).toHaveValue("Detector lab book");
  await expect(page.locator("[data-nb-section] h2")).toHaveText("Day 1: shielding");

  // A second page left as a draft: only its author sees it, marked as a draft.
  await page.getByRole("button", { name: "Write a page" }).first().click();
  await page.getByLabel("Title", { exact: true }).fill("Day 2: ideas");
  await expect(page.getByRole("status")).toContainText("Saved", { timeout: 10_000 });
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByText(/^\d+ entr/)).toHaveText(/^2 entries/);
  await expect(page.getByRole("navigation", { name: "Contents" })).toContainText("Draft");

  // Pull in someone else's post.
  await notebookAction(page, "Add posts");
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("list", { name: "Posts to add" }).getByRole("button").filter({ hasNotText: /Day [12]/ }).first().click();
  await dialog.getByRole("button", { name: "Add 1" }).click();
  await expect(page.getByText(/^\d+ entr/)).toHaveText(/^3 entries/);

  // Delete, also deleting my two pages; Undo brings everything back.
  await notebookAction(page, "Delete notebook…");
  await page.getByRole("checkbox", { name: "Also delete the 2 pages I wrote in it" }).check();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Deleted notebook “Detector lab book” and 2 of your pages")).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByLabel("Notebook title")).toHaveValue("Detector lab book");
  await expect(page.getByText(/^\d+ entr/)).toHaveText(/^3 entries/);
});

test("a notebook can follow a tag: published posts with it are added", async ({ page }) => {
  await openScenario(page, "small");
  await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Notebooks" }).click();
  await page.getByRole("button", { name: "New notebook" }).click();
  await page.getByRole("dialog").getByLabel("Name").fill("Cooldown log");
  await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();
  await expect(page.getByText("This notebook is empty")).toBeVisible();
  await notebookAction(page, "Follow a tag…");
  await page.getByRole("menuitem", { name: "cooldown", exact: true }).click();
  await expect(page.getByText("Following cooldown")).toBeVisible();
  await expect(page.getByText(/^\d+ entr/)).toHaveText(/^[1-9]\d* entr/); // the tag's published posts came in
  await page.getByRole("button", { name: "Write a page" }).first().click();
  await page.getByLabel("Title", { exact: true }).fill("Cooldown run 4513");
  await page.getByLabel("Text block 1").click();
  await page.keyboard.type("Second cooldown.");
  await page.getByRole("combobox", { name: "Tags" }).click();
  await page.getByRole("combobox", { name: "Tags" }).fill("cool");
  await page.getByRole("option", { name: "cooldown" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("status")).toContainText("Saved", { timeout: 10_000 });
  await page.getByRole("button", { name: /^Publish/ }).click();
  await expect(page.getByRole("navigation", { name: "Contents" })).toContainText("Cooldown run 4513");
});
