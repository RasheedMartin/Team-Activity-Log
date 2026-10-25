import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { openScenario } from "./helpers";

const PNG = path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures", "spectrum.png");

async function draw(page: Page, from: [number, number], to: [number, number]) {
  const box = (await page.getByRole("img", { name: /Annotation canvas/ }).boundingBox())!;
  await page.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * ((from[0] + to[0]) / 2), box.y + box.height * ((from[1] + to[1]) / 2), { steps: 4 });
  await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], { steps: 4 });
  await page.mouse.up();
}

// §W2 done-when: write with several images, annotate two, tag, survive refresh via autosave,
// publish, edit, hide and unhide; admin restores a deleted one; annotations survive reload.
test("v2 Write It Up end to end", async ({ page }) => {
  await openScenario(page, "small");
  await page.keyboard.press("c");
  await expect(page).toHaveURL(/\/p\/[^/]+\/edit$/);

  await page.getByLabel("Title").fill("Detector B noise after shielding");
  await page.getByLabel("Text block 1").click();
  await page.keyboard.type("Moved the ground strap and added copper tape. Noise floor dropped by half.");
  await page.locator("input[type=file][multiple]").setInputFiles([PNG, PNG]);
  await expect(page.getByLabel("Annotate image")).toHaveCount(2, { timeout: 15_000 });

  // Annotate both images.
  for (const i of [0, 1]) {
    await page.locator("img[alt='']").filter({ visible: true }).nth(i).hover();
    await page.getByRole("button", { name: "Annotate image" }).nth(i).click();
    await page.getByRole("button", { name: "Rectangle" }).click();
    await draw(page, [0.3, 0.3], [0.6, 0.6]);
    await page.getByRole("button", { name: "Arrow" }).click();
    await draw(page, [0.1, 0.1], [0.3, 0.3]);
    await expect(page.getByRole("img", { name: "Annotation canvas, 2 shapes" })).toBeVisible();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByLabel("Annotate image", { exact: true }).and(page.getByRole("dialog"))).toHaveCount(0);
  }
  await expect(page.getByText("2 annotations")).toHaveCount(2);

  // Tag it.
  await page.getByRole("combobox", { name: "Tags" }).click();
  await page.getByRole("combobox", { name: "Tags" }).fill("calib");
  await page.getByRole("option", { name: "calibration" }).click();
  await page.keyboard.press("Escape");

  // Autosave survives a refresh.
  await expect(page.getByRole("status")).toContainText("Saved", { timeout: 10_000 });
  await page.reload();
  await expect(page.getByLabel("Title")).toHaveValue("Detector B noise after shielding");
  await expect(page.getByText("Noise floor dropped by half.")).toBeVisible();
  await expect(page.getByText("2 annotations")).toHaveCount(2);

  // Publish.
  await page.getByRole("button", { name: /Publish/ }).click();
  await expect(page).toHaveURL(/\/p\/[^/]+$/);
  await expect(page.getByRole("heading", { name: "Detector B noise after shielding" })).toBeVisible();
  const postUrl = page.url();

  // Appears at the top of the feed.
  await page.getByRole("link", { name: "Search", exact: true }).click();
  await expect(page.locator("[data-post-id]").first()).toContainText("Detector B noise after shielding");
  await page.goto(postUrl);

  // Edit creates a revision and an "edited" marker.
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Title").fill("Detector B noise after shielding (v2)");
  await page.getByRole("button", { name: "Update" }).click();
  await expect(page.getByRole("heading", { name: "Detector B noise after shielding (v2)" })).toBeVisible();
  await expect(page.getByText("edited", { exact: true })).toBeVisible();

  // Hide, then show.
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: /Hide/ }).click();
  await page.getByLabel("Reason (optional)").fill("Superseded by run 4512");
  await page.getByRole("button", { name: "Hide", exact: true }).click();
  await expect(page.getByText(/Superseded by run 4512/)).toBeVisible();
  await page.getByRole("alert").getByRole("button", { name: "Show" }).click();
  await expect(page.getByText(/Superseded by run 4512/)).toHaveCount(0);

  // Delete, then an admin (Dana is owner) restores it from the recycle bin in Activity.
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(page.getByText("Post deleted")).toBeVisible();
  await page.getByRole("link", { name: "Activity" }).click();
  await page.getByRole("tab", { name: /Recycle bin/ }).click();
  const row = page.getByRole("tabpanel", { name: "Recycle bin" }).getByRole("listitem").filter({ hasText: "Detector B noise after shielding (v2)" });
  await row.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByText("Restored")).toBeVisible();

  // Annotations survive reload on the published post.
  await page.goto(postUrl);
  await expect(page.locator("figure svg[preserveAspectRatio=none]")).toHaveCount(2); // annotation layers
});

test("two tabs editing one draft get a conflict, not a silent overwrite", async ({ page, context }) => {
  await openScenario(page, "small");
  await page.keyboard.press("c");
  await expect(page).toHaveURL(/\/edit$/);
  await page.getByLabel("Title").fill("Shared draft");
  await expect(page.getByRole("status")).toContainText("Saved", { timeout: 10_000 });
  const other = await context.newPage();
  await other.goto(page.url());
  await other.getByLabel("Title").fill("Shared draft — tab 2");
  await expect(other.getByRole("status")).toContainText("Saved", { timeout: 10_000 });
  await page.getByLabel("Title").fill("Shared draft — tab 1");
  await expect(page.getByText(/changed in another tab/)).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Load latest" }).click();
  await expect(page.getByLabel("Title")).toHaveValue("Shared draft — tab 2");
});

test("drafts list and discard with undo", async ({ page }) => {
  await openScenario(page, "small");
  await page.getByRole("link", { name: "Activity" }).click();
  await page.getByRole("tab", { name: /Drafts/ }).click();
  const drafts = page.getByRole("tabpanel", { name: "Drafts" });
  const discard = drafts.getByRole("button", { name: /^Discard / }).first();
  const title = (await discard.getAttribute("aria-label"))!.replace(/^Discard /, "");
  await discard.click();
  await expect(page.getByText(`Discarded “${title}”`)).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText(title).first()).toBeVisible();
});

test("one Activity entry in the rail: mentions, drafts, and recycle bin are tabs; old links land on theirs", async ({ page }) => {
  await openScenario(page, "small");
  await expect(page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: /My drafts|Hidden|Recycle/ })).toHaveCount(0);
  await page.getByRole("link", { name: "Activity" }).click();
  await expect(page.getByRole("tab", { name: /Mentions & replies/ })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: /Drafts/ }).click();
  await expect(page).toHaveURL(/\/activity\/drafts$/);
  await expect(page.getByRole("tabpanel", { name: "Drafts" })).toBeVisible();
  await page.goto(page.url().replace(/\/activity\/drafts$/, "/trash"));
  await expect(page).toHaveURL(/\/activity\/recycle-bin$/);
  await expect(page.getByRole("tab", { name: /Recycle bin/ })).toHaveAttribute("aria-selected", "true");
});

test("annotation text: click the image, type, Enter adds a label; clicking away keeps it", async ({ page }) => {
  await openScenario(page, "small");
  await page.keyboard.press("c");
  await expect(page).toHaveURL(/\/p\/[^/]+\/edit$/);
  await page.locator("input[type=file][multiple]").setInputFiles([PNG]);
  await expect(page.getByLabel("Annotate image")).toHaveCount(1, { timeout: 15_000 });
  await page.locator("img[alt='']").filter({ visible: true }).first().hover();
  await page.getByRole("button", { name: "Annotate image" }).click();
  const canvas = page.getByRole("img", { name: /Annotation canvas/ });
  const box = (await canvas.boundingBox())!;

  await page.getByRole("button", { name: "Text" }).click();
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.5);
  const input = page.getByLabel("Annotation text");
  await expect(input).toBeFocused();
  await page.keyboard.type("peak at 1332 keV");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("img", { name: "Annotation canvas, 1 shapes" })).toBeVisible();
  await expect(canvas.locator("text", { hasText: "peak at 1332 keV" })).toBeVisible();

  // A second label, finished by clicking elsewhere on the image instead of Enter.
  await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.2);
  await page.keyboard.type("baseline");
  await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.8);
  await expect(page.getByRole("img", { name: /Annotation canvas, [23] shapes/ })).toBeVisible();
  await expect(canvas.locator("text", { hasText: "baseline" })).toBeVisible();
});
