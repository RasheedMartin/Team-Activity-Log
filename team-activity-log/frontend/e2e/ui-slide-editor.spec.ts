import { expect, test, type Locator, type Page } from "@playwright/test";
import { openScenario } from "./helpers";

// Slides step 3: build and edit a designed slide in the composer — layouts, editing text in place,
// moving, resizing, nudging, adding and deleting shapes — then publish, search, and convert back.

async function dragBy(page: Page, target: Locator, dx: number, dy: number) {
  const b = (await target.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + dx / 2, b.y + b.height / 2 + dy / 2, { steps: 4 });
  await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, { steps: 4 });
  await page.mouse.up();
}

const slideEditor = (page: Page) => page.getByLabel(/designed slide editor$/);

test("build a designed slide, edit it in place, publish, find it, convert it back", async ({ page }) => {
  await openScenario(page, "small");
  await page.keyboard.press("c");
  await page.getByLabel("Title").fill("Plan for the cooldown");
  await page.getByLabel("Text block 1").click();
  await page.keyboard.type("Intro paragraph.");
  await page.getByRole("button", { name: "Designed slide" }).click();
  await page.getByRole("menuitem", { name: "Title and text" }).click();
  const editor = slideEditor(page);
  await expect(editor).toBeVisible();

  // Edit the title in place.
  const title = editor.getByRole("button", { name: "Title: Title" });
  await title.dblclick();
  const text = editor.getByRole("textbox", { name: "Slide text" });
  await expect(text).toBeFocused();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Shield the cryostat");
  await expect(editor.getByRole("toolbar", { name: "Formatting" })).toBeVisible(); // same tools as post text
  await page.keyboard.press("Escape");
  await expect(editor.getByRole("button", { name: "Title: Shield the cryostat" })).toBeVisible();

  // Move the body with the mouse; nudge it with the keyboard; resize it from a corner.
  const body = editor.getByRole("button", { name: /^Text box: First point/ });
  const before = (await body.boundingBox())!;
  await dragBy(page, body, 60, 30);
  const moved = (await body.boundingBox())!;
  expect(moved.x - before.x).toBeGreaterThan(40);
  expect(moved.y - before.y).toBeGreaterThan(15);
  await page.keyboard.press("Shift+ArrowLeft");
  expect((await body.boundingBox())!.x).toBeLessThan(moved.x);
  await dragBy(page, body.locator('[data-handle="se"]'), -80, -40);
  const resized = (await body.boundingBox())!;
  expect(resized.width).toBeLessThan(moved.width - 40);

  // Add a shape, restyle it, then delete it with the keyboard.
  await editor.getByRole("button", { name: "Shape" }).click();
  await page.getByRole("menuitem", { name: "Ellipse" }).click();
  const ellipse = editor.getByRole("button", { name: "Ellipse" });
  await expect(ellipse).toHaveAttribute("aria-pressed", "true");
  await editor.getByRole("button", { name: "Fill" }).click();
  await page.getByRole("button", { name: "Color #ed7d31" }).click();
  await expect(editor.locator("ellipse[fill='#ed7d31']")).toHaveCount(1);
  // Dragged far past the edge, it stays partly on the slide (never lost in no man's land).
  const frame = (await editor.locator("[data-slide-design] > div").first().boundingBox())!;
  await dragBy(page, ellipse, 700, 0); // well past the right edge, still inside the window
  const off = (await ellipse.boundingBox())!;
  expect(off.x).toBeLessThan(frame.x + frame.width - 10);
  await expect(page.getByText(/outside the slide/)).toHaveCount(0);
  await page.keyboard.press("Delete");
  await expect(ellipse).toHaveCount(0);
  await page.screenshot({ path: "test-results/slide-editor.png", fullPage: true });

  // Publish: the slide shows as designed, and its text is searchable.
  await page.getByRole("button", { name: /Publish/ }).click();
  await expect(page).toHaveURL(/\/p\/[^/]+$/);
  const postUrl = page.url();
  await expect(page.getByRole("main").locator("[data-slide-design]").getByText("Shield the cryostat")).toBeVisible();
  await page.getByRole("link", { name: "Search", exact: true }).click();
  await page.getByRole("combobox", { name: "Search" }).fill("Shield the cryostat");
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-post-id]").filter({ hasText: "Plan for the cooldown" })).toHaveCount(1);

  // Convert back to post text.
  await page.goto(postUrl);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await slideEditor(page).getByRole("button", { name: "More slide actions" }).click();
  await page.getByRole("menuitem", { name: /Convert to post text/ }).click();
  await expect(slideEditor(page)).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: /^Text block/ }).getByRole("heading", { name: "Shield the cryostat" })).toBeVisible();
});

test("design an existing section as a slide", async ({ page }) => {
  await openScenario(page, "small");
  await page.keyboard.press("c");
  await page.getByLabel("Title").fill("Sectioned post");
  await page.getByLabel("Text block 1").click();
  await page.keyboard.type("Opening.");
  await page.getByRole("button", { name: "Slide break" }).click();
  await page.getByRole("button", { name: "Text", exact: true }).click();
  await page.keyboard.type("Second section text");
  await page.getByRole("button", { name: "Design this slide" }).click();
  await expect(slideEditor(page).getByRole("button", { name: "Text box: Second section text" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Design this slide" })).toHaveCount(0); // the break became the slide
});

test("the slide editor fits a phone", async ({ page }) => {
  await openScenario(page, "small");
  await page.keyboard.press("c");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("Title").fill("Phone slide");
  await page.getByRole("button", { name: "Designed slide" }).click();
  await page.getByRole("menuitem", { name: "Two columns" }).click();
  const editor = slideEditor(page);
  await editor.getByRole("button", { name: "Title: Title" }).click();
  await expect(editor.getByRole("toolbar", { name: "Selected element" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await editor.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/slide-editor-phone.png" });
});

test("customize a slide from Present", async ({ page }) => {
  await openScenario(page, "small");
  await page.keyboard.press("c");
  await page.getByLabel("Title").fill("Customize me");
  await page.getByLabel("Text block 1").click();
  await page.keyboard.type("Opening section.");
  await page.getByRole("button", { name: "Slide break" }).click();
  await page.getByRole("button", { name: "Text", exact: true }).click();
  await page.keyboard.type("Results worth a layout");
  await page.getByRole("button", { name: /Publish/ }).click();
  await expect(page).toHaveURL(/\/p\/[^/]+$/);
  await page.getByRole("button", { name: "Present" }).click();
  await expect(page.getByText(/^1 \/ \d+$/)).toBeVisible();
  await page.keyboard.press("End"); // the "Results" section's slide
  await expect(page.getByText("Results worth a layout")).toBeVisible();
  await page.getByRole("button", { name: "Customize this slide" }).click();
  await expect(page).toHaveURL(/\/edit$/); // the request is used once, then cleared
  const editor = slideEditor(page);
  await expect(editor.getByRole("button", { name: "Text box: Results worth a layout" })).toBeVisible();
  await expect(page.getByText("Opening section.")).toBeVisible(); // the rest of the post is untouched
  await expect(page.getByRole("button", { name: "Design this slide" })).toHaveCount(0);
});

test("a slide cut from a long text explains why it can't be customized yet", async ({ page }) => {
  await openScenario(page, "small");
  await page.keyboard.press("c");
  await page.getByLabel("Title").fill("Long one");
  await page.getByLabel("Text block 1").click();
  for (let i = 0; i < 14; i++) await page.keyboard.type(`Paragraph ${i} with enough words to fill a slide quickly. `.repeat(2) + "\n");
  await page.getByRole("button", { name: /Publish/ }).click();
  await expect(page).toHaveURL(/\/p\/[^/]+$/);
  await page.getByRole("button", { name: "Present" }).click();
  await expect(page.getByText(/^1 \/ \d+$/)).toBeVisible();
  await page.keyboard.press("ArrowRight");
  const btn = page.getByRole("button", { name: "Customize this slide" });
  await expect(btn).toHaveAttribute("aria-disabled", "true");
  await expect(btn).toHaveAccessibleDescription(/Add a slide break/);
  await btn.click({ force: true }); // Playwright skips aria-disabled controls; people can still press it
  await expect(page.getByRole("alert").or(page.getByRole("status")).filter({ hasText: "Add a slide break" }).first()).toBeVisible();
  await expect(page).toHaveURL(/\/present/); // nothing changed
});
