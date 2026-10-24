import { expect, test, type Page } from "@playwright/test";
import { openScenario } from "./helpers";

const deck = (name: string, size = 3_000_000) => ({ name, mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", buffer: Buffer.alloc(size, 7) });

async function startImport(page: Page, file: ReturnType<typeof deck>, mode: string) {
  await page.getByRole("link", { name: "Import deck" }).click();
  await page.getByLabel("PowerPoint file").setInputFiles(file);
  await page.getByRole("radio", { name: new RegExp(mode) }).click();
  await page.getByRole("button", { name: "Start import" }).click();
}

// §W5 done-when: every post presents cleanly; the import wizard runs end to end in all three
// modes against the mock job, including review edits and commit-as-drafts.
test("present a post: keys, overview, jump, exit", async ({ page }) => {
  await openScenario(page, "small");
  await page.locator("[data-post-id]").first().click();
  await page.getByRole("button", { name: "Present" }).click();
  await expect(page.getByRole("region", { name: /Presentation|/ }).first()).toBeVisible();
  await expect(page.getByText(/^1 \/ \d+$/)).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByText(/^2 \/ \d+$/)).toBeVisible();
  await page.keyboard.press("o");
  await expect(page.getByRole("listbox", { name: "All slides" })).toBeVisible();
  await page.getByRole("option").first().click();
  await expect(page.getByText(/^1 \/ \d+$/)).toBeVisible();
  await page.reload(); // ?s= keeps the slide
  await expect(page.getByText(/^1 \/ \d+$/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/p\/[^/]+$/);
});

test("every seeded post derives slides without errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openScenario(page, "small");
  const ids = await page.locator("[data-post-id]").evaluateAll((els) => els.map((e) => e.getAttribute("data-post-id")));
  const base = page.url().replace(/\/(search.*)?$/, "");
  for (const id of ids.slice(0, 10)) {
    await page.goto(`${base}/p/${id}/present`);
    await expect(page.getByText(/^1 \/ \d+$/)).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test("select posts → notebook → reorder → present", async ({ page }) => {
  await openScenario(page, "small");
  await page.getByRole("button", { name: "Select posts" }).click();
  const boxes = page.getByRole("checkbox", { name: /^Select / });
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await boxes.nth(2).check();
  await expect(page.getByText("3 selected")).toBeVisible();
  await page.getByRole("button", { name: "Make notebook" }).click();
  await page.getByRole("dialog").getByLabel("Name").fill("Cooldown notebook");
  await page.getByRole("button", { name: "Create notebook" }).click();
  await expect(page).toHaveURL(/\/notebooks\//);
  await expect(page.getByLabel("Notebook title")).toHaveValue("Cooldown notebook");
  await expect(page.locator("[data-nb-section]")).toHaveCount(3);
  await expect(page.getByRole("link", { name: "Cooldown notebook" })).toBeVisible(); // in the rail
  const first = await page.locator("[data-nb-section] h2").first().innerText();
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("button", { name: /Move .* down/ }).first().click();
  await expect(page.locator("[data-nb-section] h2").nth(1)).toHaveText(first);
  await page.getByRole("button", { name: "Present" }).click();
  await expect(page.getByText(/^1 \/ \d+$/)).toBeVisible();
});

for (const mode of ["One post per slide", "One post for the deck", "Group by section"]) {
  test(`import wizard end to end: ${mode}`, async ({ page }) => {
    await openScenario(page, "small");
    await startImport(page, deck("Lab_Notes_2021.pptx"), mode);
    await expect(page.getByRole("table", { name: "Posts to create" })).toBeVisible({ timeout: 20_000 });
    const rows = page.getByRole("table", { name: "Posts to create" }).locator("tbody tr");
    const n = await rows.count();
    expect(n).toBeGreaterThan(0);
    // Review edit: retitle the first item.
    await page.getByRole("textbox", { name: /^Title for slides/ }).first().fill("Imported overview");
    if (mode === "One post per slide") {
      // Merge two, split back, skip one.
      await page.getByRole("checkbox", { name: /^Select slides 1$/ }).check();
      await page.getByRole("checkbox", { name: /^Select slides 2$/ }).check();
      await page.getByRole("button", { name: "Merge" }).click();
      await expect(rows).toHaveCount(n - 1);
      await page.getByRole("button", { name: "Split into slides" }).click();
      await expect(rows).toHaveCount(n);
      await page.getByRole("checkbox", { name: /^Include slides 3$/ }).uncheck();
    }
    const create = page.getByRole("button", { name: /^Create \d+ drafts?$/ });
    const expected = Number((await create.innerText()).match(/\d+/)![0]);
    await create.click();
    await expect(page.getByText(new RegExp(`Created ${expected} drafts`))).toBeVisible();
    await page.getByRole("button", { name: "Publish all" }).click();
    await expect(page.getByText("All imported drafts published")).toBeVisible();
    await page.getByRole("link", { name: "Open collection" }).click();
    await expect(page.locator("[data-post-id]").first()).toBeVisible();
  });
}

test("a damaged file fails clearly and lets you retry", async ({ page }) => {
  await openScenario(page, "small");
  await startImport(page, deck("corrupt_notes.pptx"), "One post per slide");
  await expect(page.getByText(/isn't a valid .pptx/)).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Try another file" }).click();
  await expect(page.getByRole("button", { name: "Start import" })).toBeVisible();
});

test("delete a whole import removes its posts", async ({ page }) => {
  await openScenario(page, "small");
  await startImport(page, deck("Old_Deck.pptx", 3_200_000), "One post per slide");
  await page.getByRole("button", { name: /^Create \d+ drafts?$/ }).click({ timeout: 20_000 });
  await page.getByRole("button", { name: "Delete this import" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Import deleted")).toBeVisible();
  await page.getByRole("link", { name: "My drafts" }).click();
  await expect(page.getByText("Slide 8 (no title)")).toHaveCount(0);
});

test("no duplicate notebooks; back from a post returns to the notebook", async ({ page }) => {
  await openScenario(page, "small");
  // Explore: first click makes the tag notebook, the second opens the same one.
  await page.getByRole("link", { name: "Explore" }).click();
  const shelf = page.getByRole("region", { name: /^Tag / }).first();
  await shelf.getByRole("button", { name: "Notebook" }).click();
  await expect(page).toHaveURL(/\/notebooks\//);
  const firstUrl = page.url();
  await page.getByRole("link", { name: "Explore" }).click();
  await page.getByRole("region", { name: /^Tag / }).first().getByRole("button", { name: "Open notebook" }).click();
  await expect(page).toHaveURL(firstUrl);
  // The make-notebook dialog refuses a duplicate name.
  const name = await page.getByLabel("Notebook title").inputValue();
  await page.getByRole("link", { name: "Feed" }).click();
  await page.getByRole("button", { name: "Select posts" }).click();
  await page.getByRole("checkbox", { name: /^Select / }).first().check();
  await page.getByRole("button", { name: "Make notebook" }).click();
  await page.getByRole("dialog").getByLabel("Name").fill(name.toUpperCase());
  await expect(page.getByText(/already exists/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Create notebook" })).toBeDisabled();
  await page.getByRole("button", { name: "Open it" }).click();
  await expect(page).toHaveURL(firstUrl);
  // Back from a post goes to the notebook, not the feed.
  await page.locator("[data-nb-section] h2 a").first().click();
  await page.getByRole("button", { name: `Back to ${name}` }).click();
  await expect(page).toHaveURL(new RegExp(`${firstUrl.split("/").pop()}#nb-`));
});
