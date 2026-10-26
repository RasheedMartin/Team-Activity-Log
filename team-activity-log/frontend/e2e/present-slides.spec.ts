import { expect, test } from "@playwright/test";
import { openScenario } from "./helpers";

// Owner request: choose what presents: hide slides, title slide parts, only designed slides.
test("present: hide a slide, trim the title slide, and it's remembered", async ({ page }) => {
  await openScenario(page, "small");
  await page.locator("[data-post-id]").first().click();
  await page.getByRole("button", { name: "Present" }).click();
  const total = Number((await page.getByText(/^1 \/ \d+$/).innerText()).split("/")[1]);
  expect(total).toBeGreaterThan(1);

  await page.getByRole("button", { name: "Slide settings" }).click();
  const panel = page.getByRole("presentation").filter({ hasText: "Title slides" });
  await panel.getByRole("button", { name: "Hide slide 2" }).click();
  await expect(panel.getByText(`${total - 1} of ${total} slides present`)).toBeVisible();
  await panel.getByRole("switch", { name: "Date" }).uncheck();
  await panel.getByRole("button", { name: "Close slide settings" }).click();
  await expect(page.getByText(new RegExp(`^1 / ${total - 1}$`))).toBeVisible();

  await page.waitForTimeout(1000); // saved a moment after the last change
  await page.reload(); // saved with the post
  await expect(page.getByText(new RegExp(`^1 / ${total - 1}$`))).toBeVisible();
  await page.getByRole("button", { name: "Slide settings" }).click();
  await expect(page.getByRole("switch", { name: "Date" })).not.toBeChecked();
  await page.getByRole("button", { name: "Show slide 2" }).click();
  await page.getByRole("button", { name: "Close slide settings" }).click();
  await expect(page.getByText(new RegExp(`^1 / ${total}$`))).toBeVisible();
});
