import { expect, test } from "@playwright/test";
import { openScenario } from "./helpers";

test("back returns to where you came from, with scroll restored, plus a Feed link", async ({ page }) => {
  await openScenario(page, "busy");
  // Search results → post → "Back to results" restores the query and scroll.
  await page.getByRole("combobox", { name: "Search" }).fill("drift");
  await expect(page.getByText(/^[\d,]+ posts/)).toBeVisible();
  await page.waitForTimeout(400);
  await page.mouse.wheel(0, 2400);
  await page.waitForTimeout(400);
  // Pin the card by ID: positional locators re-resolve as the virtual list re-renders.
  const id = await page.locator("[data-post-id]").filter({ visible: true }).nth(3).getAttribute("data-post-id");
  const card = page.locator(`[data-post-id="${id}"]`);
  await card.getByRole("heading").scrollIntoViewIfNeeded();
  const y = await page.evaluate(() => window.scrollY); // where we actually are when we leave
  expect(y).toBeGreaterThan(800);
  // Record the scroll position at the real pointer-down (Playwright may nudge the page to click).
  await page.evaluate(() => addEventListener("pointerdown", () => ((window as unknown as { __y: number }).__y = scrollY), { capture: true, once: true }));
  await card.getByRole("heading").click();
  await expect(page).toHaveURL(/\/p\/[^/]+$/);
  const postUrl = page.url();
  await expect(page.getByRole("button", { name: "Back to results" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Feed", exact: true }).last()).toBeVisible();
  await page.getByRole("button", { name: "Back to results" }).click();
  await expect(page.getByRole("combobox", { name: "Search" })).toHaveValue("drift");
  const leftAt = await page.evaluate(() => (window as unknown as { __y: number }).__y);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(leftAt - 8);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(leftAt + 8);

  // Inbox → post says "Back to Inbox".
  await page.getByRole("link", { name: "Inbox" }).click();
  await page.getByRole("button", { name: "All", exact: true }).click();
  const item = page.getByRole("button", { name: /mentioned you|replied/ }).first();
  if (await item.count()) {
    await item.click();
    await expect(page.getByRole("button", { name: "Back to Inbox" })).toBeVisible();
  }

  // Direct visit (no history, no origin): back falls back to the feed.
  const fresh = await page.context().newPage();
  await fresh.goto(postUrl);
  await expect(fresh.getByRole("button", { name: "Feed", exact: true })).toBeVisible();
});
