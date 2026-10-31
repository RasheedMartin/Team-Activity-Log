import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { openScenario } from "./helpers";

// Owner request (Sheets v2): edit cells, rows, and columns; start a blank sheet; replace the data
// with a new file; download what's there now; who may edit.
const XLSX = readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures", "Gain_Runs.xlsx"));

async function signInAs(page: Page, name: string) {
  await page.evaluate(async (n) => {
    const personas = await (await fetch("/v1/dev/personas")).json();
    const p = personas.find((x: { user: { name: string } }) => x.user.name === n);
    await fetch("/v1/dev/sign-in-as", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: p.user.id }) });
  }, name);
}

/** A cell by its row number (1 = first data row) and column position. Rows are virtualized: only
 *  rows on screen exist, so tests scroll the grid to the top first (top()). */
const cell = (page: Page, row: number, col: number) =>
  page.getByRole("grid").getByRole("row").filter({ has: page.getByRole("button", { name: new RegExp(`^Row ${row}(,|$)`) }) }).getByRole("gridcell").nth(col);
const top = (page: Page) => page.getByRole("grid").evaluate((el) => (el.scrollTop = 0));
/** Full reloads boot the mock again; wait for the sheet itself. */
const open = async (page: Page, url: string) => {
  await page.goto(url);
  await expect(page.getByRole("heading", { name: "Cooldown log" })).toBeVisible({ timeout: 30_000 });
};

test("edit an imported sheet: cells, undo, rows, columns, CSV, a new version", async ({ page }) => {
  await openScenario(page, "small");
  await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Sheets" }).click();
  await page.getByLabel("Spreadsheet to import").setInputFiles({ name: "Gain_Runs.xlsx", mimeType: "application/octet-stream", buffer: XLSX });
  await expect(page).toHaveURL(/\/sheets\/[^/]+$/, { timeout: 20_000 });

  // Type over a cell; Enter saves and moves down.
  const gain = cell(page, 1, 3);
  await gain.click();
  await page.keyboard.type("1.5");
  await page.keyboard.press("Enter");
  await expect(gain).toHaveText("1.5");
  await expect(page.getByRole("gridcell", { selected: true })).toHaveText(/./); // moved down a row

  // A number column refuses text, and says why.
  await gain.click();
  await page.keyboard.type("n/a");
  await page.keyboard.press("Enter");
  await expect(page.getByText(/“n\/a” isn't a number: Gain holds numbers/)).toBeVisible();
  await expect(gain).toHaveText("1.5");

  // Undo the edit.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(gain).not.toHaveText("1.5");

  // Rows: select two by their numbers, delete, undo puts them back in place.
  await page.getByRole("button", { name: "Row 2", exact: true }).click();
  await page.getByRole("button", { name: "Row 3", exact: true }).click({ modifiers: ["Shift"] });
  await expect(page.getByText("2 rows selected")).toBeVisible();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText("38 rows", { exact: true })).toBeVisible();
  await expect(cell(page, 2, 0)).toHaveText("4,503");
  await page.getByRole("button", { name: "Undo" }).last().click();
  await expect(page.getByText("40 rows", { exact: true })).toBeVisible();
  await expect(cell(page, 2, 0)).toHaveText("4,501");

  await page.getByRole("button", { name: "Add row" }).click();
  await expect(page.getByText("41 rows", { exact: true })).toBeVisible();

  // Columns: insert one after Noise; it takes the type of what's typed in.
  await top(page);
  await page.getByRole("columnheader", { name: "Noise" }).click();
  await page.getByRole("menuitem", { name: "Insert column to the right" }).click();
  await expect(page.getByRole("columnheader", { name: "Column 6" })).toBeVisible();
  await cell(page, 1, 5).click();
  await page.keyboard.type("12");
  await page.keyboard.press("Enter");
  await expect(cell(page, 1, 5)).toHaveText("12");
  await page.getByRole("columnheader", { name: "Column 6" }).click();
  await page.getByLabel("Column name").fill("Temp (K)");
  await page.getByRole("button", { name: "Rename" }).click();
  await expect(page.getByRole("columnheader", { name: "Temp (K)" })).toBeVisible();
  await page.getByRole("columnheader", { name: "Temp (K)" }).click();
  await expect(page.getByText("Numbers (follows what's typed in)")).toBeVisible();
  await page.keyboard.press("Escape");

  // Download what's there now.
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Sheet actions" }).click();
  await page.getByRole("menuitem", { name: /Download as CSV/ }).click();
  const csv = readFileSync(await (await download).path(), "utf8");
  expect(csv.split("\r\n")[0]).toBe("﻿Run,Date,Channel,Gain,Noise,Temp (K)");
  expect(csv.split("\r\n")[1]).toMatch(/^4500,2026-03-01,A,[\d.]+,[\d.]+,12$/);

  // A new version of the file: columns match by name.
  await page.getByRole("button", { name: "Sheet actions" }).click();
  await page.getByRole("menuitem", { name: /Replace data/ }).click();
  await expect(page.getByRole("dialog", { name: "Replace the data?" })).toBeVisible();
  await page.getByLabel("New version of the file").setInputFiles({ name: "runs.csv", mimeType: "text/csv", buffer: Buffer.from("Run,Date,Channel,Gain,Noise\n5000,2026-04-01,A,1.1,0.3\n5001,2026-04-02,B,1.2,0.4\n") });
  await expect(page.getByText(/Data replaced from runs\.csv/)).toBeVisible();
  await expect(page.getByText(/^runs\.csv · 2 tabs · 5 rows/)).toBeVisible();
  await expect(cell(page, 1, 0)).toHaveText("5,000");
});

test("a new sheet: type into it; others view it until it's opened to everyone", async ({ page }) => {
  await openScenario(page, "small");
  await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Sheets" }).click();
  await page.getByRole("button", { name: "New sheet" }).click();
  await page.getByRole("dialog").getByLabel("Name").fill("Cooldown log");
  await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("heading", { name: "Cooldown log" })).toBeVisible();
  await expect(page.getByText(/^Made in the app · 5 rows/)).toBeVisible();

  await cell(page, 1, 0).click();
  await page.keyboard.type("Stage 1");
  await page.keyboard.press("Tab");
  await page.keyboard.type("4.2");
  await page.keyboard.press("Enter");
  await expect(cell(page, 1, 0)).toHaveText("Stage 1");
  await expect(cell(page, 1, 1)).toHaveText("4.2");
  const url = page.url();

  await signInAs(page, "Priya Raman");
  await open(page, url);
  await expect(page.getByText("View only")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add row" })).toHaveCount(0);

  await signInAs(page, "Dana Okafor");
  await open(page, url);
  await page.getByRole("button", { name: "Sheet actions" }).click();
  await page.getByRole("menuitem", { name: /Let everyone edit/ }).click();
  await expect(page.getByText("Everyone in the workspace can edit this sheet")).toBeVisible();

  await signInAs(page, "Priya Raman");
  await open(page, url);
  await expect(page.getByRole("button", { name: "Add row" })).toBeVisible();
  await expect(page.getByText(/edited .* by Dana Okafor/)).toBeVisible();
});
