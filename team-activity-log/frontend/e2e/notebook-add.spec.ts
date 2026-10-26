import { expect, test } from "@playwright/test";
import { openScenario, notebookAction } from "./helpers";

// Owner feedback: a post removed from a notebook had no way back in. Removing has Undo, the
// notebook can add posts itself, and posts selected in search can join an existing notebook.

test("remove a notebook entry, undo it, and add posts back", async ({ page }) => {
  await openScenario(page, "small");
  const boxes = page.getByRole("checkbox", { name: /^Select / });
  for (const i of [0, 1, 2]) await boxes.nth(i).check();
  await page.getByRole("button", { name: "New notebook" }).click();
  await page.getByRole("dialog").getByLabel("Name").fill("Add-back notebook");
  await page.getByRole("button", { name: "Create notebook" }).click();
  await expect(page.getByText("Entry 1 of 3").first()).toBeVisible();

  // Remove one entry, then Undo.
  await notebookAction(page, "Reorder or remove");
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
  await notebookAction(page, "Add posts");
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Search posts to add").fill(`"${title}"`);
  const list = dialog.getByRole("list", { name: "Posts to add" });
  await list.getByRole("button", { name: new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).first().click();
  await dialog.getByRole("button", { name: "Add 1" }).click();
  await expect(page.getByText(/^\d+ entries/)).toHaveText(/^3 entries/);
  await expect(contents.getByRole("button", { name: `Remove ${title}` })).toBeVisible();
});

test("posts selected in search can be added to an existing notebook", async ({ page }) => {
  await openScenario(page, "small");
  const boxes = page.getByRole("checkbox", { name: /^Select / });
  await boxes.nth(0).check();
  await page.getByRole("button", { name: "New notebook" }).click();
  await page.getByRole("dialog").getByLabel("Name").fill("Grows later");
  await page.getByRole("button", { name: "Create notebook" }).click();
  await expect(page.getByText(/^1 entry/)).toBeVisible();

  await page.getByRole("link", { name: "Search", exact: true }).click();
  for (const i of [0, 1, 2]) await boxes.nth(i).check();
  await page.getByRole("button", { name: "Add to…" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Find a notebook").fill("Grows later");
  await dialog.getByRole("button", { name: /Grows later/ }).click();
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText(/Added 2 posts to “Grows later”/)).toBeVisible(); // the first was already in it
});

test("add posts quickly: select all shown, shift-click a range, clear", async ({ page }) => {
  await openScenario(page, "small");
  await page.getByRole("checkbox", { name: /^Select / }).nth(0).check();
  await page.getByRole("button", { name: "New notebook" }).click();
  await page.getByRole("dialog").getByLabel("Name").fill("Quick picks");
  await page.getByRole("button", { name: "Create notebook" }).click();
  await expect(page.getByText(/^1 entry/)).toBeVisible();

  await notebookAction(page, "Add posts");
  const dialog = page.getByRole("dialog");
  const rows = dialog.getByRole("list", { name: "Posts to add" }).getByRole("button");
  await expect(rows.nth(5)).toBeVisible();
  // Shift-click: rows 2 through 5 (the one already in it is skipped).
  await rows.nth(2).click();
  await rows.nth(5).click({ modifiers: ["Shift"] });
  await expect(dialog.getByText("4 picked")).toBeVisible();
  await dialog.getByRole("button", { name: "Clear" }).click();
  // Select all shown: everything not already in it.
  const free = (await rows.count()) - (await dialog.getByText("Already in it").count());
  await dialog.getByRole("checkbox", { name: "Select all shown" }).check();
  await expect(dialog.getByText(`${free} picked`)).toBeVisible();
  await dialog.getByRole("button", { name: `Add ${free}` }).click();
  await expect(page.getByText(/^\d+ entries/)).toHaveText(new RegExp(`^${free + 1} entries`));
});
