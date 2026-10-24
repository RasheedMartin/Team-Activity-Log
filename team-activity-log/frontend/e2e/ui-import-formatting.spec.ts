import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { openScenario } from "./helpers";

// Imported slides keep their formatting and reading order (scripts/make-test-deck.mjs builds the
// deck), the result stays editable, and both read on a phone.

const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const FIXTURE = readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures", "Formatting_2024.pptx"));

async function importDeck(page: Page) {
  await openScenario(page, "small");
  await page.getByRole("complementary").getByRole("link", { name: "Import slides" }).click();
  await page.getByLabel("PowerPoint file").setInputFiles({ name: "Formatting_2024.pptx", mimeType: PPTX_MIME, buffer: FIXTURE });
  await page.getByRole("radio", { name: /One post for the deck/ }).click();
  await page.getByRole("button", { name: "Start import" }).click();
  await page.getByRole("button", { name: /^Create 1 draft$/ }).click({ timeout: 20_000 });
  await page.getByRole("button", { name: "Publish all" }).click();
  await expect(page.getByText("All imported drafts published")).toBeVisible();
  await page.getByRole("link", { name: "Search these slides" }).click();
  await page.locator("[data-post-id]").first().getByRole("heading").click();
  await expect(page.getByText("Gain stable")).toBeVisible();
}

/** The color button in the toolbar of the text block that contains this text (each block has its own). */
const colorButtonFor = (page: Page, text: string) =>
  page
    .locator("div", { has: page.getByRole("toolbar", { name: "Formatting" }) })
    .filter({ has: page.getByRole("textbox").getByText(text) })
    .last()
    .getByRole("button", { name: "Text color and highlight" });

const before = (page: Page, a: string, b: string) =>
  page.evaluate(([x, y]) => {
    const find = (t: string) => [...document.querySelectorAll("main *")].find((e) => e.childElementCount === 0 && e.textContent === t)!;
    return !!(find(x).compareDocumentPosition(find(y)) & Node.DOCUMENT_POSITION_FOLLOWING);
  }, [a, b] as const);

test("imported slides keep formatting and reading order, and stay editable", async ({ page }) => {
  await importDeck(page);
  const main = page.getByRole("main");
  await expect(main.locator("[data-tc]", { hasText: "critical" })).toHaveCSS("color", "rgb(192, 0, 0)");
  await expect(main.locator("[data-tc]", { hasText: "plain" })).toHaveCount(0); // black follows the theme
  await expect(main.locator("mark[data-hl]", { hasText: "flagged" })).toBeVisible();
  await expect(main.getByRole("link", { name: "run log" })).toHaveAttribute("href", "https://example.test/run");
  await expect(main.locator("s", { hasText: "old value" })).toBeVisible();
  await expect(main.locator('ol[start="3"] li')).toHaveCount(2);
  await expect(main.locator("ul ul li", { hasText: "Channel 12 fixed" })).toBeVisible();
  await expect(main.locator("p", { hasText: "Centered note" })).toHaveCSS("text-align", "center");
  await expect(main.getByRole("heading", { name: "Big takeaway" })).toBeVisible();
  await expect(main.getByRole("cell", { name: "Ch 12" })).toBeVisible(); // chart data
  await expect(main.getByRole("listitem").filter({ hasText: /^Build$/ })).toBeVisible(); // SmartArt
  expect(await before(page, "Right column", "Big takeaway")).toBe(true);
  expect(await main.locator("figure img").evaluate((img) => !!(img.compareDocumentPosition([...document.querySelectorAll("main h3")].find((h) => h.textContent === "Big takeaway")!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);

  // Edit: tables survive, and color can be changed from the toolbar.
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const editor = page.getByRole("textbox", { name: /^Text block/ });
  await expect(editor.getByText("Ch 12")).toBeVisible();
  await editor.getByText("Centered note").click({ clickCount: 3 });
  await colorButtonFor(page, "Centered note").click();
  await page.getByRole("button", { name: "Text blue" }).click();
  await expect(page.getByRole("button", { name: "Text blue" })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape"); // the picker is modal; close it before reading the editor
  await expect(editor.locator("[data-tc]", { hasText: "Centered note" })).toHaveAttribute("style", /--tc: #1565c0/);
});

test("an imported post and the color picker fit a phone screen", async ({ page }) => {
  await importDeck(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByText("Gain stable")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "test-results/import-formatting-phone.png", fullPage: true });
  await page.emulateMedia({ colorScheme: "dark" }); // stored colors are lightened to stay readable
  await expect(page.locator("main [data-tc]", { hasText: "critical" })).not.toHaveCSS("color", "rgb(192, 0, 0)");
  await page.screenshot({ path: "test-results/import-formatting-phone-dark.png" });
  await page.emulateMedia({ colorScheme: "light" });
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("textbox", { name: /^Text block/ }).getByText("Gain stable").click();
  await colorButtonFor(page, "Gain stable").click();
  await expect(page.locator(".MuiPopover-paper")).toHaveCSS("opacity", "1");
  const box = await page.getByRole("button", { name: "Highlight orange" }).boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "test-results/color-picker-phone.png" });
});
