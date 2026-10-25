import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { openScenario } from "./helpers";

// Designed slides (slides step 2): an imported deck keeps its layout, its text stays searchable,
// it presents as designed, and it scales down to a phone.

const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const FIXTURE = readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures", "Formatting_2024.pptx"));

async function importDeck(page: Page, design: "Automatic" | "Keep the design") {
  await openScenario(page, "small");
  await page.getByRole("complementary").getByRole("link", { name: "Import slides" }).click();
  await page.getByLabel("PowerPoint file").setInputFiles({ name: "Formatting_2024.pptx", mimeType: PPTX_MIME, buffer: FIXTURE });
  await page.getByRole("radio", { name: /One post for the deck/ }).click();
  await page.getByRole("radio", { name: new RegExp(`^${design}`) }).click();
  await page.getByRole("button", { name: "Start import" }).click();
  await page.getByRole("button", { name: /^Create 1 draft$/ }).click({ timeout: 20_000 });
  await page.getByRole("button", { name: /^Publish all/ }).click(); // on the deck, where the import lands
  await expect(page.getByRole("tab", { name: "Published (1)" })).toBeVisible(); // cards now open the post, not the editor
  await expect(page.getByText(/^Published \d+ slides?$/)).toBeVisible();
  await page.getByRole("list", { name: "Posts in this collection" }).getByRole("link").first().click();
}

test("keep the design: slides render as laid out, are searchable, and present", async ({ page }) => {
  await importDeck(page, "Keep the design");
  const slides = page.getByRole("main").locator("[data-slide-design]");
  await expect(slides).toHaveCount(4);
  const design = slides.nth(3);
  await expect(design.getByText("Grouped box")).toBeVisible();
  await expect(design.getByText("Step B")).toBeVisible(); // SmartArt, as drawn
  await expect(design.locator('[data-slide-element="shape"]')).toHaveCount(6); // template bar, group box, arrow, see-through ellipse, 2 SmartArt boxes
  await expect(design.locator('[data-slide-element="image"] img')).toHaveCount(1); // the master's logo
  await expect(slides.nth(0).locator('[data-slide-element="image"]')).toHaveCount(0); // title layout hides template art
  // Mixed sizes kept at their ratio: a 12 pt run in a 24 pt box.
  const para = design.locator("p", { hasText: "Big small again" });
  const big = await para.evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  const small = await para.getByText("small", { exact: true }).evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  expect(small / big).toBeCloseTo(0.5, 1);
  await expect(design.locator('[data-slide-element="shape"] line')).toHaveCount(1); // the arrow connector
  // A PowerPoint chart is drawn as a chart, from its data, in the deck's color for Run A.
  const chart = slides.nth(2).locator('[data-slide-element="chart"]');
  await expect(chart.getByRole("img", { name: /Gain by channel: column chart of Run A, Run B/ })).toBeVisible();
  await expect(chart.locator("path[fill='#2e75b6']")).toHaveCount(2);
  await expect(chart.locator("svg path")).toHaveCount(4);
  await chart.locator("path[fill='#2e75b6']").first().hover();
  await expect(chart.getByText("Run A: 1.02")).toBeVisible();
  await page.screenshot({ path: "test-results/designed-slides-laptop.png", fullPage: true });

  // Slide text is post text: search finds it.
  const postUrl = page.url();
  await page.getByRole("complementary").getByRole("link", { name: "Search" }).click();
  await page.getByRole("combobox", { name: "Search" }).fill("Grouped box");
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-post-id]").filter({ hasText: "Quarterly review" })).toHaveCount(1);
  await page.goto(postUrl);

  // Present: each designed slide is one slide, shown as designed, with its notes.
  await page.getByRole("button", { name: "Present" }).click();
  await expect(page.getByText(/^1 \/ 5$/)).toBeVisible(); // the post's title slide + 4 designed
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowRight");
  await expect(page.getByText(/^5 \/ 5$/)).toBeVisible();
  await expect(page.locator("[data-slide-design]").getByText("Grouped box")).toBeVisible();
  await page.waitForTimeout(400); // the slide fades in
  await page.screenshot({ path: "test-results/designed-slides-present.png" });
});

test("automatic: text slides become post text, laid-out slides keep their design", async ({ page }) => {
  await importDeck(page, "Automatic");
  const main = page.getByRole("main");
  await expect(main.locator("[data-slide-design]")).toHaveCount(3); // the title slide is just text
  await expect(main.getByRole("heading", { name: "Detector group" })).toBeVisible();
});

test("designed slides scale to a phone without sideways scrolling", async ({ page }) => {
  await importDeck(page, "Keep the design");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  const slide = page.getByRole("main").locator("[data-slide-design]").nth(3);
  await expect(slide.getByText("Grouped box")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const box = await slide.boundingBox();
  expect(box!.width).toBeLessThanOrEqual(390);
  expect(box!.height / box!.width).toBeCloseTo(540 / 960, 1);
  await slide.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/designed-slides-phone.png" });
});
