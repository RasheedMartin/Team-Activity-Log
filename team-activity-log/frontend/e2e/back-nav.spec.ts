import { expect, test } from "@playwright/test";
import { openScenario } from "./helpers";

test("back returns to where you came from, with scroll restored, plus an All posts link", async ({ page }) => {
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
  // Record where the clicked card sits on screen at the moment of the click.
  await page.evaluate((pid) => addEventListener("click", () => ((window as unknown as { __top: number }).__top = document.querySelector(`[data-post-id="${pid}"]`)!.getBoundingClientRect().top), { capture: true, once: true }), id);
  await card.getByRole("heading").click();
  await expect(page).toHaveURL(/\/p\/[^/]+$/);
  const postUrl = page.url();
  await expect(page.getByRole("button", { name: "Back to results" })).toBeVisible();
  await expect(page.getByRole("link", { name: "All posts", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back to results" }).click();
  await expect(page.getByRole("combobox", { name: "Search" })).toHaveValue("drift");
  // What you see is restored: the card you opened is back in the same place on screen. (Absolute
  // scrollY can differ slightly because rows above the viewport re-measure.)
  const before = await page.evaluate(() => (window as unknown as { __top: number }).__top);
  const topNow = () => page.evaluate((pid) => document.querySelector(`[data-post-id="${pid}"]`)?.getBoundingClientRect().top ?? -9999, id);
  await expect.poll(topNow).toBeGreaterThan(before - 8);
  await expect.poll(topNow).toBeLessThan(before + 8);

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
  await expect(fresh.getByRole("button", { name: "Home", exact: true })).toBeVisible();
});
