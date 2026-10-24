import { expect, test } from "@playwright/test";
import { openScenario } from "./helpers";

test("explore shelves by tag and a tag slideshow", async ({ page }) => {
  await openScenario(page, "small");
  await page.getByRole("link", { name: "Explore" }).click();
  const shelf = page.getByRole("region", { name: /^Tag / }).filter({ has: page.getByRole("button", { name: "Slideshow" }) }).first();
  await expect(shelf).toBeVisible();
  await shelf.getByRole("button", { name: "Slideshow" }).click();
  await expect(page).toHaveURL(/slideshow=/);
  await expect(page.getByText(/^1 of \d+ images/)).toBeVisible();
  const total = Number((await page.getByText(/^1 of \d+ images/).innerText()).match(/of (\d+)/)![1]);
  if (total > 1) {
    await page.keyboard.press("ArrowRight");
    await expect(page.getByText(/^2 of \d+ images/)).toBeVisible();
  }
  await page.getByRole("button", { name: "Close slideshow" }).click();
  await expect(page).not.toHaveURL(/slideshow=/);
  // Tag group filter.
  await page.getByRole("tab", { name: "Topic" }).click();
  await expect(page.getByRole("tab", { name: "Topic" })).toHaveAttribute("aria-selected", "true");
});
