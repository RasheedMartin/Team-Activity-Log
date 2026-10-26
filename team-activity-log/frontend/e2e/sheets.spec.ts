import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { openScenario } from "./helpers";

// Owner request (Sheets v1): import a spreadsheet, browse its tabs as typed tables, sort, filter,
// see what's in a column, find it by what's in its cells, download the original.
const XLSX = readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures", "Gain_Runs.xlsx"));

test("import a workbook: tabs, sort, filter, column stats, search, download", async ({ page }) => {
  await openScenario(page, "small");
  await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Sheets" }).click();
  await expect(page.getByRole("heading", { name: "Sheets" })).toBeVisible();

  // Only spreadsheets are accepted.
  await page.getByLabel("Spreadsheet to import").setInputFiles({ name: "deck.pptx", mimeType: "application/octet-stream", buffer: Buffer.from("x") });
  await expect(page.getByText("Choose an Excel (.xlsx) or CSV file")).toBeVisible();

  await page.getByLabel("Spreadsheet to import").setInputFiles({ name: "Gain_Runs.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: XLSX });
  await expect(page).toHaveURL(/\/sheets\/[^/]+$/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Gain_Runs" })).toBeVisible();
  await expect(page.getByText("Gain_Runs.xlsx · 2 tabs · 43 rows")).toBeVisible();

  const grid = page.getByRole("grid");
  const firstRow = grid.getByRole("row").nth(1);
  await expect(firstRow.getByRole("gridcell").first()).toHaveText("4,500");

  // Sort: largest run first.
  await grid.getByRole("columnheader", { name: "Run" }).click();
  await page.getByRole("menuitem", { name: "Largest first" }).click();
  await expect(firstRow.getByRole("gridcell").first()).toHaveText("4,539");
  await expect(grid.getByRole("columnheader", { name: "Run" })).toHaveAttribute("aria-sort", "descending");

  // Filter, then what's in a column (for the rows shown).
  await page.getByLabel("Filter rows").fill("B");
  await expect(page.getByText("13 of 40 rows")).toBeVisible();
  await grid.getByRole("columnheader", { name: "Channel" }).click();
  const about = page.getByLabel("About Channel");
  await expect(about).toContainText("Distinct1");
  await page.keyboard.press("Escape");

  // Another tab.
  await page.getByRole("tab", { name: "Calibration" }).click();
  await expect(grid.getByRole("columnheader", { name: "Instrument" })).toBeVisible();
  await expect(page.getByText("3 rows", { exact: true })).toBeVisible();

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Sheet actions" }).click();
  await page.getByRole("menuitem", { name: "Download original" }).click();
  expect((await download).suggestedFilename()).toBe("Gain_Runs.xlsx");
  await page.keyboard.press("Escape");

  // Search reads cells.
  await page.getByRole("link", { name: "Sheets" }).first().click();
  await page.getByLabel("Find sheets").fill("Thermocouple");
  await expect(page.getByRole("list", { name: "Sheets" }).getByText("Gain_Runs")).toBeVisible();
  await page.getByLabel("Find sheets").fill("nothing like this");
  await expect(page.getByText("Nothing matches")).toBeVisible();
});
