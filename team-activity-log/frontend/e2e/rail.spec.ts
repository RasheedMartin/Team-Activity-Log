import { expect, test } from "@playwright/test";
import { openScenario } from "./helpers";

test("only the clicked saved search or collection is highlighted", async ({ page }) => {
  await openScenario(page, "small");
  const rail = page.getByRole("complementary").first();
  const views = rail.getByRole("link", { name: /Open questions|Calibration, last 90 days/ });
  await rail.getByRole("link", { name: "Open questions" }).click();
  await expect(rail.getByRole("link", { name: "Open questions" })).toHaveAttribute("aria-current", "page");
  await expect(rail.getByRole("link", { name: "Calibration, last 90 days" })).not.toHaveAttribute("aria-current", "page");
  await expect(rail.getByRole("link", { name: "Lab_Notes_2022.pptx" })).not.toHaveAttribute("aria-current", "page");
  await rail.getByRole("link", { name: "Lab_Notes_2022.pptx" }).click();
  await expect(rail.getByRole("link", { name: "Lab_Notes_2022.pptx" })).toHaveAttribute("aria-current", "page");
  await expect(views.first()).not.toHaveAttribute("aria-current", "page");
  await expect(page).toHaveURL(/\/collections\//); // a collection opens as its own page
  // Searching within it means you're in Search, no longer "on" the collection.
  await page.getByRole("main").getByRole("link", { name: "Search within" }).click();
  await expect(rail.getByRole("link", { name: "Lab_Notes_2022.pptx" })).not.toHaveAttribute("aria-current", "page");
  // With an ad-hoc search (no favorite matches), Search is the current item.
  await expect(rail.getByRole("link", { name: "Search", exact: true })).toHaveAttribute("aria-current", "page");
});
