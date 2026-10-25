import { expect, test } from "@playwright/test";
import { openScenario } from "./helpers";

// Text in images (OCR): every picture's text is read and searchable; people can correct it; admins
// see the engine (built in for everyone, cloud engines on Business).

const inApp = (page: import("@playwright/test").Page, path: string) => page.evaluate((p) => (history.pushState({}, "", p), dispatchEvent(new PopStateEvent("popstate"))), path);

test("an image's text is shown, can be corrected, and search uses the correction", async ({ page }) => {
  await openScenario(page, "small");
  await page.getByRole("button", { name: "Images" }).click();
  await page.getByRole("button", { name: /from / }).first().click();
  await page.getByRole("link", { name: "Open post" }).click();
  const title = await page.getByRole("heading", { level: 1 }).first().innerText();
  await page.locator("main figure img").first().click();
  await page.getByRole("button", { name: "Details" }).click();
  const drawer = page.getByRole("presentation").filter({ hasText: "Text in this image" });
  await expect(drawer.getByText(/^(Read by the built-in engine|Read automatically) · searchable$|^No text found\.$/)).toBeVisible();

  await drawer.getByRole("button", { name: /^(Correct|Add text)$/ }).click();
  await drawer.getByRole("textbox", { name: "Text in this image" }).fill("Zebrafish rig 7781\nbaseline after shielding");
  await drawer.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved. Search uses the corrected text.")).toBeVisible();
  await expect(drawer.getByText("Corrected by a person · searchable")).toBeVisible();

  await page.keyboard.press("Escape"); // closes the details drawer
  await page.getByRole("button", { name: "Close image" }).click();
  await page.getByRole("link", { name: "Search", exact: true }).click();
  await page.getByRole("combobox", { name: "Search" }).fill("zebrafish");
  await expect(page.locator("[data-post-id]").filter({ hasText: title }).first()).toBeVisible();
});

test("admins see which engine reads images; cloud engines are a Business option", async ({ page }) => {
  await openScenario(page, "small");
  const org = new URL(page.url()).pathname.split("/")[2];
  await inApp(page, `/o/${org}/admin/settings`);
  await expect(page.getByRole("heading", { name: "Text in images" })).toBeVisible();
  await expect(page.getByRole("radio", { name: /Built-in \(Tesseract\)/ })).toBeChecked();
  await expect(page.getByText("In use")).toBeVisible();
  await expect(page.getByRole("radio", { name: /Google Cloud Vision/ })).toBeDisabled();
  await expect(page.getByText("Business plan").first()).toBeVisible();
  await expect(page.getByText(/\d+ with text/)).toBeVisible();
  await page.getByRole("button", { name: "Re-read all images" }).click();
  await expect(page.getByText(/Reading \d+ images again \(corrected text is kept\)/)).toBeVisible();
});
