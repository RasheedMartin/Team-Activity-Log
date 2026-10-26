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

test("make a chart from a tab, put it in a post, and it stays live", async ({ page }) => {
  await openScenario(page, "small");
  await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Sheets" }).click();
  await page.getByLabel("Spreadsheet to import").setInputFiles({ name: "Gain_Runs.xlsx", mimeType: "application/octet-stream", buffer: XLSX });
  await expect(page).toHaveURL(/\/sheets\/[^/]+$/, { timeout: 20_000 });

  await page.getByRole("button", { name: "Charts" }).click();
  await expect(page.getByText("No charts on this tab yet")).toBeVisible();
  await page.getByRole("button", { name: "New chart" }).click();
  const builder = page.getByRole("dialog", { name: "New chart" });
  await builder.getByRole("combobox", { name: "Measure (Y)" }).click();
  await page.getByRole("option", { name: "Run" }).click(); // deselect the default
  await page.getByRole("option", { name: "Gain" }).click();
  await page.keyboard.press("Escape");
  await builder.getByRole("combobox", { name: "Summarize rows with the same X" }).click();
  await page.getByRole("option", { name: "Average" }).click();
  await builder.getByRole("combobox", { name: "Split into a series per" }).click();
  await page.getByRole("option", { name: "Channel" }).click();
  await expect(builder.getByRole("img", { name: /line chart of A, B, C/ })).toBeVisible();
  await builder.getByLabel("Name").fill("Gain by channel");
  await builder.getByRole("button", { name: "Save chart" }).click();
  await expect(page.getByRole("button", { name: "Charts (1)" })).toBeVisible();
  const card = page.getByRole("region", { name: "Gain by channel" });
  await expect(card.getByRole("img", { name: /line chart/ })).toBeVisible();

  // Into a new post: a draft with the chart, ready to write around.
  await card.getByRole("button", { name: "Add to a new post" }).click();
  await expect(page).toHaveURL(/\/p\/[^/]+\/edit$/);
  await expect(page.getByRole("figure", { name: "Chart: Gain by channel" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Saved", { timeout: 10_000 });
  await page.getByRole("button", { name: /^Publish/ }).click();
  await expect(page).toHaveURL(/\/p\/[^/]+$/);
  const postUrl = page.url();
  const fig = page.getByRole("figure", { name: "Chart: Gain by channel" });
  await expect(fig.getByRole("img", { name: /line chart of A, B, C/ })).toBeVisible();
  await expect(fig.getByRole("link", { name: "Gain_Runs · Runs" })).toBeVisible();

  // Search finds the post by its chart's name.
  await page.getByRole("link", { name: "Search", exact: true }).click();
  await page.getByRole("combobox", { name: "Search" }).fill("Gain by channel");
  await expect(page.locator("[data-post-id]").first()).toBeVisible();

  // The composer can add a saved chart too.
  await page.getByRole("button", { name: /^New post/ }).click();
  await expect(page).toHaveURL(/\/edit$/);
  await page.getByRole("button", { name: "Chart", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Add a chart from a sheet" });
  await picker.getByRole("button", { name: /Gain_Runs/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Gain by channel/ }).click();
  await expect(page.getByRole("figure", { name: "Chart: Gain by channel" })).toBeVisible();

  // Delete the chart: posts say it's gone instead of breaking.
  await page.goto(postUrl);
  await fig.getByRole("link", { name: "Gain_Runs · Runs" }).click();
  await page.getByRole("button", { name: /^Charts/ }).click();
  await page.getByRole("button", { name: "Delete Gain by channel" }).click();
  await expect(page.getByText("No charts on this tab yet")).toBeVisible();
  await page.goto(postUrl);
  await expect(page.getByText("This chart is no longer available.", { exact: false })).toBeVisible();
});
