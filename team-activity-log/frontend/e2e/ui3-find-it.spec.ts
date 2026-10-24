import { expect, test, type Page } from "@playwright/test";
import { openScenario } from "./helpers";

/** Type a query and wait until the results for exactly that query have arrived. */
async function search(page: Page, q: string) {
  const resp = page.waitForResponse((r) => r.url().endsWith("/search") && (JSON.parse(r.request().postData() ?? "{}").q ?? "") === q);
  await page.getByRole("combobox", { name: "Search" }).fill(q);
  await resp;
  await page.waitForTimeout(100);
}

const count = async (page: Page) => Number(((await page.getByText(/^[\d,]+ (posts?|images?)/).first().innerText()).match(/[\d,]+/)?.[0] ?? "0").replace(/,/g, ""));

// §W4 done-when, on the 5,000-post scenario.
test("v4 Find It end to end", async ({ page }) => {
  test.setTimeout(120_000);
  await openScenario(page, "busy");
  const all = await count(page);
  expect(all).toBeGreaterThan(1000);

  // Type a query.
  await search(page, "drift");
  const afterQuery = await count(page);
  expect(afterQuery).toBeLessThan(all);

  // Click a histogram bar: select the busiest bucket via keyboard (same code path as a click).
  const hist = page.getByRole("group", { name: /Posts over time/ });
  await hist.focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: /Filter: Work date/ })).toBeVisible();
  const afterDate = await count(page);
  expect(afterDate).toBeLessThanOrEqual(afterQuery);
  await page.getByRole("button", { name: /Filter: Work date/ }).focus();
  await page.keyboard.press("Delete");
  await expect.poll(() => count(page)).toBe(afterQuery);

  // Two tags (one excluded), facet counts disjunctive.
  const firstTag = page.getByRole("checkbox", { name: /^\S+ \d/ }).nth(0);
  const firstTagName = (await firstTag.getAttribute("aria-label"))!.split(" ")[0];
  const secondTagName = (await page.getByRole("checkbox", { name: /^\S+ \d/ }).nth(1).getAttribute("aria-label"))!.split(" ")[0];
  const countBefore = Number((await firstTag.getAttribute("aria-label"))!.split(" ")[1]);
  // Address tags by name: the facet list can re-sort between reading and clicking.
  await page.getByRole("checkbox", { name: new RegExp(`^${firstTagName} \\d`) }).click();
  // Disjunctive: the selected tag's own count is unchanged by selecting it.
  await expect(page.getByRole("checkbox", { name: new RegExp(`^${firstTagName} ${countBefore}`) })).toBeVisible();
  await page.getByRole("checkbox", { name: new RegExp(`^${secondTagName} \\d`) }).click({ modifiers: ["Alt"] });
  await expect(page.getByRole("button", { name: new RegExp(`Filter: Not tagged: ${secondTagName}`) })).toBeVisible();

  // Filter to one person.
  const person = page.getByRole("region", { name: "People" }).getByRole("checkbox").nth(1);
  await person.click();
  await expect(page.getByRole("button", { name: /Filter: By / })).toBeVisible();

  // Gallery mode.
  await page.getByRole("button", { name: "Images" }).click();
  await expect(page.getByText(/^[\d,]+ images?/)).toBeVisible();

  // Save the view, reload from the URL → identical state.
  await page.getByRole("button", { name: "Save view" }).click();
  await page.getByLabel("Name").fill("Drift, focused");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved “Drift, focused”")).toBeVisible();
  const url = page.url();
  const before = await count(page);
  await page.goto(url);
  await expect(page.getByRole("combobox", { name: "Search" })).toHaveValue("drift");
  await expect(page.getByRole("button", { name: /Filter: Not tagged/ })).toBeVisible();
  await expect.poll(() => count(page)).toBe(before);
  await expect(page.getByRole("link", { name: "Drift, focused" })).toBeVisible(); // pinned in the rail
});

test("keyboard: / focuses search, j/k move, Space peeks, Enter opens", async ({ page }) => {
  await openScenario(page, "small");
  await page.keyboard.press("/");
  await expect(page.getByRole("combobox", { name: "Search" })).toBeFocused();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.locator("body").click({ position: { x: 5, y: 500 } });
  await page.keyboard.press("j");
  await page.keyboard.press("j");
  await expect(page.locator("[aria-current=true]")).toHaveCount(1);
  await page.keyboard.press(" ");
  await expect(page.getByRole("complementary", { name: "Preview" })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/p\/[^/]+$/);
});

test("boolean search and advanced filters", async ({ page }) => {
  await openScenario(page, "busy");
  const box = page.getByRole("combobox", { name: "Search" });
  await search(page, "drift");
  const drift = await count(page);
  expect(drift).toBeGreaterThan(0);
  await search(page, "drift -cooldown");
  expect(await count(page)).toBeLessThan(drift);
  await search(page, "drift OR noise");
  expect(await count(page)).toBeGreaterThan(drift);
  await box.fill("(drift OR noise");
  await expect(page.getByText(/Missing \)/)).toBeVisible();

  // Advanced: (has images) AND (NOT mine)
  await box.fill("");
  await page.getByRole("button", { name: "Advanced" }).click();
  const drawer = page.getByRole("presentation").filter({ hasText: "Advanced filters" });
  await drawer.getByRole("combobox", { name: "Field" }).click();
  await page.getByRole("option", { name: "Has images" }).click();
  await drawer.getByRole("button", { name: "Group" }).click();
  await drawer.getByRole("combobox", { name: "Group operator" }).nth(1).click();
  await page.getByRole("option", { name: "NONE of" }).click();
  await drawer.getByRole("combobox", { name: "Field" }).nth(1).click();
  await page.getByRole("option", { name: "Mine" }).click();
  await expect(drawer.getByText(/Has images AND \(NOT \(Mine\)\)/)).toBeVisible();
  await drawer.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByRole("button", { name: /Has images AND/ })).toBeVisible();
});

test("zero results suggest which filter to drop", async ({ page }) => {
  await openScenario(page, "small");
  await page.getByRole("button", { name: "Add filter" }).click();
  await page.getByRole("menuitem", { name: "Has images" }).click();
  await search(page, "zzqxv");
  await expect(page.getByText("No posts match")).toBeVisible();
  await expect(page.getByText(/Try removing a filter/)).toBeVisible();
  await page.getByRole("button", { name: /Remove the search/ }).click();
  await expect(page.getByRole("combobox", { name: "Search" })).toHaveValue("");
});
