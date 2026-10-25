import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { openScenario } from "./helpers";

// Owner request: attach a file to a post; it stays with the post, downloadable, its text searchable.
const PDF = readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures", "Noise_study.pdf"));

test("attach a PDF to a post: search finds its text, and it downloads", async ({ page }) => {
  await openScenario(page, "small");
  await page.keyboard.press("c");
  await expect(page).toHaveURL(/\/edit$/);
  await page.getByLabel("Title", { exact: true }).fill("Preamp vendor notes");
  await page.getByLabel("File to attach").setInputFiles({ name: "Noise_study.pdf", mimeType: "application/pdf", buffer: PDF });
  await expect(page.getByText(/Attached Noise_study\.pdf; its text is searchable/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/PDF · \d+ (KB|B) · its text is searchable/)).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Saved", { timeout: 10_000 });
  await page.getByRole("button", { name: /^Publish/ }).click();
  await expect(page).toHaveURL(/\/p\/[^/]+$/);

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download Noise_study.pdf" }).click();
  expect((await download).suggestedFilename()).toBe("Noise_study.pdf");

  await page.getByRole("link", { name: "Search", exact: true }).click();
  await page.getByRole("combobox", { name: "Search" }).fill("noise floor in half");
  await expect(page.locator("[data-post-id]").filter({ hasText: "Preamp vendor notes" })).toBeVisible();
});
