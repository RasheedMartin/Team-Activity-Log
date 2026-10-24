import { expect, test } from "@playwright/test";
import { openScenario } from "./helpers";

// Scale: hundreds of views/notebooks/collections live in a paged, searchable Library; the rail
// shows only personal pins.
test("library at scale: tabs, search, paging, favorites, delete with undo", async ({ page }) => {
  test.setTimeout(120_000);
  await openScenario(page, "busy");
  await page.getByRole("link", { name: /^Library/ }).click();
  await expect(page.getByRole("tab", { name: /Saved searches \(\d+\)/ })).toBeVisible();
  const counts = await page.getByRole("tab").allInnerTexts();
  const n = (label: string) => Number(counts.find((c) => c.startsWith(label))!.match(/\((\d+)\)/)![1]);
  expect(n("Saved searches")).toBeGreaterThan(30); // others' private saved searches are excluded
  expect(n("Notebooks")).toBeGreaterThan(25);
  expect(n("Collections")).toBeGreaterThan(70);

  // Paged: first page is limited; "Show more" loads the next.
  const rows = page.getByRole("list", { name: "Library items" }).getByRole("listitem");
  await expect(rows).toHaveCount(40);
  await page.getByRole("button", { name: /Show more/ }).click();
  await expect(rows).toHaveCount(80);

  // Tabs + search narrow server-side.
  await page.getByRole("tab", { name: /Notebooks/ }).click();
  await expect(page.getByText("Posts in an order, read start to finish.")).toBeVisible(); // each kind says what it is
  await page.getByLabel("Search the library").fill("notebook 1");
  await expect(rows.first()).toContainText("notebook 1");
  const name = (await rows.first().getByRole("link").innerText()).split("\n")[0];

  // Star → it says where it went and appears under Favorites in the rail; unstar → gone.
  await rows.first().getByRole("button", { name: `Add ${name} to Favorites` }).click();
  await expect(page.getByText(`Added “${name}” to Favorites in the sidebar`)).toBeVisible();
  const rail = page.getByRole("list", { name: "Favorites" });
  await expect(rail.getByRole("link", { name })).toBeVisible();
  await rows.first().getByRole("button", { name: `Remove ${name} from Favorites` }).click();
  await expect(rail.getByRole("link", { name })).toHaveCount(0);

  // Delete with undo.
  await rows.first().getByRole("button", { name: `More actions for ${name}` }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(page.getByText(`Deleted “${name}” (its posts are kept)`)).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(rows.filter({ hasText: name }).first()).toBeVisible();
});

test("the saved-searches menu searches on the server", async ({ page }) => {
  test.setTimeout(120_000);
  await openScenario(page, "busy");
  await page.getByRole("button", { name: "Saved searches" }).click();
  await page.getByLabel("Find a saved search").fill("calibration");
  await expect(page.getByRole("menuitem", { name: /calibration/i }).first()).toBeVisible();
  await page.getByRole("menuitem", { name: /calibration/i }).first().click();
  await expect(page).toHaveURL(/view=/);
});
