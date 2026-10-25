import { expect, test } from "@playwright/test";
import { openScenario } from "./helpers";

// Owner feedback: a post removed from a notebook had no way back in. Removing has Undo, the
// notebook can add posts itself, and posts selected in search can join an existing notebook.

test("remove a notebook entry, undo it, and add posts back", async ({ page }) => {
  await openScenario(page, "small");
  await page.getByRole("button", { name: "Select posts" }).click();
  const boxes = page.getByRole("checkbox", { name: /^Select / });
  for (const i of [0, 1, 2]) await boxes.nth(i).check();
  await page.getByRole("button", { name: "New notebook" }).click();
  await page.getByRole("dialog").getByLabel("Name").fill("Add-back notebook");
  await page.getByRole("button", { name: "Create notebook" }).click();
  await expect(page.getByText("Entry 1 of 3").first()).toBeVisible();

  // Remove one entry, then Undo.
  await page.getByRole("button", { name: "Edit" }).click();
  const contents = page.getByRole("navigation", { name: "Contents" });
  const removeButtons = contents.getByRole("button", { name: /^Remove / });
  const title = ((await removeButtons.first().getAttribute("aria-label")) ?? "").replace(/^Remove /, "");
  await removeButtons.first().click();
  await expect(page.getByText(/^3 entries|^2 entries/)).toHaveText(/^2 entries/);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText(/^\d+ entries/)).toHaveText(/^3 entries/);

  // Remove it again, then add it back with Add posts (it goes at the end).
  await removeButtons.first().click();
  await expect(page.getByText(/^\d+ entries/)).toHaveText(/^2 entries/);
  await page.getByRole("button", { name: "Add posts" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Search posts to add").fill(`"${title}"`);
  const list = dialog.getByRole("list", { name: "Posts to add" });
  await list.getByRole("button", { name: new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).first().click();
  await expect(list.getByText("Already in it").first()).toBeVisible(); // the other two entries, if they match
  await dialog.getByRole("button", { name: "Add 1" }).click();
  await expect(page.getByText(/^\d+ entries/)).toHaveText(/^3 entries/);
  await expect(contents.getByRole("button", { name: `Remove ${title}` })).toBeVisible();
});

test("posts selected in search can be added to an existing notebook", async ({ page }) => {
  await openScenario(page, "small");
  await page.getByRole("button", { name: "Select posts" }).click();
  const boxes = page.getByRole("checkbox", { name: /^Select / });
  await boxes.nth(0).check();
  await page.getByRole("button", { name: "New notebook" }).click();
  await page.getByRole("dialog").getByLabel("Name").fill("Grows later");
  await page.getByRole("button", { name: "Create notebook" }).click();
  await expect(page.getByText(/^1 entry/)).toBeVisible();

  await page.getByRole("link", { name: "Search", exact: true }).click();
  await page.getByRole("button", { name: "Select posts" }).click();
  for (const i of [0, 1, 2]) await boxes.nth(i).check();
  await page.getByRole("button", { name: "Add to…" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Find a notebook or collection").fill("Grows later");
  await dialog.getByRole("button", { name: /Grows later/ }).click();
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText(/Added 2 posts to “Grows later”/)).toBeVisible(); // the first was already in it
});
