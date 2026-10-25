import { expect, test } from "@playwright/test";
import { openScenario } from "./helpers";

// Collections and Notebooks each have their own page in the rail (owner request, replacing the
// Library): paged, searchable by name, star to favorite, delete with undo. Saved searches live in
// Search's menu.
test("collections and notebooks pages at scale: search, paging, favorites, delete with undo", async ({ page }) => {
  test.setTimeout(120_000);
  await openScenario(page, "busy");
  const nav = page.getByRole("navigation", { name: "Workspace" });
  await expect(nav.getByRole("link", { name: "Library" })).toHaveCount(0);

  await nav.getByRole("link", { name: "Collections" }).click();
  await expect(page.getByRole("main").getByRole("heading", { name: "Collections" })).toBeVisible();
  const collections = page.getByRole("list", { name: "Collections" }).getByRole("listitem");
  await expect(collections).toHaveCount(40); // paged: first page is limited; "Show more" loads the next
  await page.getByRole("button", { name: /Show more/ }).click();
  await expect(collections).toHaveCount(80);
  await collections.first().getByRole("link").click();
  await expect(page).toHaveURL(/\/collections\/[^/]+$/); // its own page, not Search

  await nav.getByRole("link", { name: "Notebooks" }).click();
  await expect(page.getByText("Posts in an order, read start to finish.")).toBeVisible(); // each kind says what it is
  const rows = page.getByRole("list", { name: "Notebooks" }).getByRole("listitem");
  await page.getByLabel("Find notebooks").fill("notebook 1");
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

  // Old Library links land on the right page.
  await page.goto(page.url().replace(/\/notebooks.*$/, "/library?kind=notebook"));
  await expect(page).toHaveURL(/\/notebooks$/);
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

test("saved searches can be deleted from the menu (with undo)", async ({ page }) => {
  await openScenario(page, "small");
  await page.getByRole("button", { name: "Saved searches" }).click();
  const item = page.getByRole("menuitem", { name: /Open questions/ });
  await item.getByRole("button", { name: "Delete Open questions" }).click();
  await expect(page.getByText("Deleted “Open questions”")).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await page.getByRole("button", { name: "Saved searches" }).click();
  await expect(page.getByRole("menuitem", { name: /Open questions/ })).toBeVisible();
});
