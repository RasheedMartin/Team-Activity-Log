import { expect, test } from "@playwright/test";
import path from "node:path";
import { openScenario } from "./helpers";

const PNG = path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures", "spectrum.png");

// Owner feedback: a text label dropped on an image couldn't be edited.
test("annotation text: type a label, then click it to edit or clear it", async ({ page }) => {
  await openScenario(page, "small");
  await page.keyboard.press("c");
  await page.getByLabel("Title", { exact: true }).fill("Label test");
  await page.locator("input[type=file][accept='image/*']").setInputFiles([PNG]);
  await expect(page.getByLabel("Annotate image")).toHaveCount(1, { timeout: 15_000 });
  await page.locator("img[alt='']").filter({ visible: true }).first().hover();
  await page.getByRole("button", { name: "Annotate image" }).first().click();

  const canvas = page.getByRole("img", { name: /Annotation canvas/ });
  const box = (await canvas.boundingBox())!;
  await page.getByRole("button", { name: "Text" }).click();
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.4);
  await page.keyboard.type("Peak at 4.1 K");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("img", { name: "Annotation canvas, 1 shapes" })).toBeVisible();
  await expect(canvas.getByText("Peak at 4.1 K")).toBeVisible();

  // Click the label (Text tool) to edit it in place.
  await canvas.getByText("Peak at 4.1 K").click();
  const input = page.getByRole("textbox", { name: "Annotation text" });
  await expect(input).toHaveValue("Peak at 4.1 K");
  await input.fill("Peak at 4.2 K");
  await page.keyboard.press("Enter");
  await expect(canvas.getByText("Peak at 4.2 K")).toBeVisible();
  await expect(page.getByRole("img", { name: "Annotation canvas, 1 shapes" })).toBeVisible();

  // Double-click with another tool edits too; emptying it removes the label.
  await page.getByRole("button", { name: "Rectangle" }).click();
  await canvas.getByText("Peak at 4.2 K").dblclick();
  await page.getByRole("textbox", { name: "Annotation text" }).fill("");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("img", { name: "Annotation canvas, 0 shapes" })).toBeVisible();
});
