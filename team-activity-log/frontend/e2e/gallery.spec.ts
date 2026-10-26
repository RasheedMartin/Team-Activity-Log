import { expect, test } from "@playwright/test";
import { openScenario } from "./helpers";

// Images view: a carousel steps through every match above the grid, and thumbnails show their
// annotations (owner feedback: they only appeared after opening an image).

test("image grid: a carousel on top, and thumbnails show annotations", async ({ page }) => {
  await openScenario(page, "busy");
  await page.getByRole("link", { name: "Search", exact: true }).click();
  await page.getByRole("button", { name: "Images" }).click();
  const carousel = page.getByRole("region", { name: "Highlighted images" });
  await expect(carousel).toContainText(/1 of \d+/); // every matching image, in the grid's order
  await carousel.getByRole("button", { name: "Next image" }).click();
  await expect(carousel).toContainText(/2 of \d+/);
  await carousel.getByRole("button", { name: "Previous image" }).click();
  await carousel.getByRole("button", { name: "Previous image" }).click();
  await expect(carousel).not.toContainText(/ 1 of /); // wraps around to the last
  await carousel.getByRole("button", { name: /^Open / }).click();
  await expect(page.getByRole("dialog")).toBeVisible(); // the image viewer
  await page.keyboard.press("Escape");

  // Annotated images draw their shapes on the thumbnail.
  await expect(page.getByRole("list", { name: "Images" }).locator("svg").first()).toBeAttached();
});
