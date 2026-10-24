import { expect, test } from "@playwright/test";
import { openScenario } from "./helpers";

test("only the clicked saved view or collection is highlighted", async ({ page }) => {
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
  // Changing filters means you're no longer "on" the collection.
  await page.getByRole("button", { name: "Add filter" }).click();
  await page.getByRole("menuitem", { name: "Has images" }).click();
  await expect(rail.getByRole("link", { name: "Lab_Notes_2022.pptx" })).not.toHaveAttribute("aria-current", "page");
  // Feed isn't highlighted on search URLs.
  await expect(rail.getByRole("link", { name: "Feed" })).not.toHaveAttribute("aria-current", "page");
});
