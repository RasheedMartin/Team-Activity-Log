import { expect, test } from "@playwright/test";
import { openScenario } from "./helpers";

// Scale: hundreds of views/notebooks/collections live in a paged, searchable Library; the rail
// shows only personal pins.
test("library at scale: tabs, search, paging, pin to rail, delete with undo", async ({ page }) => {
  await openScenario(page, "busy");
  await page.getByRole("link", { name: /^Library/ }).click();
  await expect(page.getByRole("tab", { name: /Saved views \(\d+\)/ })).toBeVisible();
  const counts = await page.getByRole("tab").allInnerTexts();
  const n = (label: string) => Number(counts.find((c) => c.startsWith(label))!.match(/\((\d+)\)/)![1]);
  expect(n("Saved views")).toBeGreaterThan(30); // others' private views are excluded
  expect(n("Notebooks")).toBeGreaterThan(25);
  expect(n("Collections")).toBeGreaterThan(70);

  // Paged: first page is limited; "Show more" loads the next.
  const rows = page.getByRole("list", { name: "Library items" }).getByRole("listitem");
  await expect(rows).toHaveCount(40);
  await page.getByRole("button", { name: /Show more/ }).click();
  await expect(rows).toHaveCount(80);

  // Tabs + search narrow server-side.
  await page.getByRole("tab", { name: /Notebooks/ }).click();
  await page.getByLabel("Search the library").fill("notebook 1");
  await expect(rows.first()).toContainText("notebook 1");
  const name = (await rows.first().getByRole("link").innerText()).split("\n")[0];

  // Pin → appears in the rail; unpin → gone.
  await rows.first().getByRole("button", { name: `Pin ${name}` }).click();
  const rail = page.getByRole("list", { name: "Pinned" });
  await expect(rail.getByRole("link", { name })).toBeVisible();
  await rows.first().getByRole("button", { name: `Unpin ${name}` }).click();
  await expect(rail.getByRole("link", { name })).toHaveCount(0);

  // Delete with undo.
  await rows.first().getByRole("button", { name: `More actions for ${name}` }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(page.getByText(`Deleted “${name}” (its posts are kept)`)).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(rows.filter({ hasText: name }).first()).toBeVisible();
});

test("the Saved menu searches views on the server", async ({ page }) => {
  await openScenario(page, "busy");
  await page.getByRole("button", { name: "Saved" }).click();
  await page.getByLabel("Find a saved view").fill("calibration");
  await expect(page.getByRole("menuitem", { name: /calibration/i }).first()).toBeVisible();
  await page.getByRole("menuitem", { name: /calibration/i }).first().click();
  await expect(page).toHaveURL(/view=/);
});
