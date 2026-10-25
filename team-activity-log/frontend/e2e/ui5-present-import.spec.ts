import { expect, test, type Page } from "@playwright/test";
import { openScenario } from "./helpers";

import { readFileSync } from "node:fs";
import path from "node:path";

const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const FIXTURE = readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures", "Lab_Notes_2021.pptx"));
/** A real .pptx (8 slides in 3 sections; see scripts/make-test-deck.mjs), or garbage bytes. */
const deck = (name: string, real = true) => ({ name, mimeType: PPTX_MIME, buffer: real ? FIXTURE : Buffer.alloc(3_000_000, 7) });
const EXPECTED_ITEMS: Record<string, number> = { "One post per slide": 8, "One post for the deck": 1, "Group by section": 3 };

async function startImport(page: Page, file: ReturnType<typeof deck>, mode: string) {
  await page.getByRole("complementary").getByRole("link", { name: "Import slides" }).click();
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
  const boxes = page.getByRole("checkbox", { name: /^Select / });
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await boxes.nth(2).check();
  await expect(page.getByText("3 selected")).toBeVisible();
  await page.getByRole("button", { name: "New notebook" }).click();
  await page.getByRole("dialog").getByLabel("Name").fill("Cooldown notebook");
  await page.getByRole("button", { name: "Create notebook" }).click();
  await expect(page).toHaveURL(/\/notebooks\//);
  await expect(page.getByLabel("Notebook title")).toHaveValue("Cooldown notebook");
  await expect(page.getByText("Entry 1 of 3").first()).toBeVisible(); // reader: one entry at a time
  // Not pinned automatically (the rail only shows pins); it's in the Library.
  const first = await page.locator("[data-nb-section] h2").first().innerText();
  await page.getByRole("button", { name: "Next" }).first().click();
  await expect(page.getByText("Entry 2 of 3").first()).toBeVisible();
  await page.getByRole("button", { name: "Continuous" }).click();
  await expect(page.locator("[data-nb-section]")).toHaveCount(3);
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("button", { name: `Move ${first} down`, exact: true }).click();
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
    await expect(rows).toHaveCount(EXPECTED_ITEMS[mode]);
    const n = EXPECTED_ITEMS[mode];
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
    await page.getByRole("button", { name: /^Publish all/ }).click(); // on the deck, where the import lands
    await expect(page.getByText(/^Published \d+ slides?$/)).toBeVisible();
    await expect(page.getByRole("tab", { name: `Published (${expected})` })).toBeVisible();
    const cards = page.getByRole("list", { name: "Posts in this collection" }).getByRole("link");
    await expect(cards).toHaveCount(expected);
    if (mode === "One post per slide") {
      // Real content from the deck, not canned text: slide 2's caption and picture. (Slide 2's
      // post was renamed by the merge/split above.)
      await cards.filter({ hasText: "Imported overview (slide 2)" }).first().click();
      await expect(page.getByText("Curve from run 4512")).toBeVisible();
      await expect(page.locator("figure img")).toHaveCount(1);
    }
  });
}

test("a damaged file fails clearly and lets you retry", async ({ page }) => {
  await openScenario(page, "small");
  await startImport(page, deck("Renamed_spreadsheet.pptx", false), "One post per slide");
  await expect(page.getByText(/isn't a valid .pptx/)).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Try another file" }).click();
  await expect(page.getByRole("button", { name: "Start import" })).toBeVisible();
});

test("delete a whole import removes its posts", async ({ page }) => {
  await openScenario(page, "small");
  await startImport(page, deck("Old_Deck.pptx"), "One post per slide");
  await page.getByRole("button", { name: /^Create \d+ drafts?$/ }).click({ timeout: 20_000 });
  await page.getByRole("button", { name: "More deck actions" }).click();
  await page.getByRole("menuitem", { name: /Delete this import/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Import deleted")).toBeVisible();
  await page.getByRole("link", { name: "Activity" }).click();
  await page.getByRole("tab", { name: /Drafts/ }).click();
  await expect(page.getByRole("tabpanel", { name: "Drafts" })).toBeVisible();
  await expect(page.getByText("Cooldown overview")).toHaveCount(0);
});

test("no duplicate notebooks; back from a post returns to the notebook", async ({ page }) => {
  await openScenario(page, "small");
  // Explore: first click makes the tag notebook, the second opens the same one.
  await page.getByRole("link", { name: "Home", exact: true }).click();
  const shelf = page.getByRole("region", { name: /^Tag / }).first();
  await shelf.getByRole("button", { name: "Create notebook" }).click();
  await expect(page).toHaveURL(/\/notebooks\//);
  const firstUrl = page.url();
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await page.getByRole("region", { name: /^Tag / }).first().getByRole("button", { name: "Open notebook" }).click();
  await expect(page).toHaveURL(firstUrl);
  // The make-notebook dialog refuses a duplicate name.
  const name = await page.getByLabel("Notebook title").inputValue();
  await page.getByRole("link", { name: "Search", exact: true }).click();
  await page.getByRole("checkbox", { name: /^Select / }).first().check();
  await page.getByRole("button", { name: "New notebook" }).click();
  await page.getByRole("dialog").getByLabel("Name").fill(name.toUpperCase());
  await expect(page.getByText(/already exists/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Create notebook" })).toBeDisabled();
  await page.getByRole("button", { name: "Open it" }).click();
  await expect(page).toHaveURL(firstUrl);
  // Back from a post goes to the notebook, not the feed.
  await page.getByRole("button", { name: "Next" }).first().click();
  const entryUrl = page.url();
  await page.locator("[data-nb-section] h2 a").first().click();
  await page.getByRole("button", { name: `Back to ${name}` }).click();
  await expect(page).toHaveURL(entryUrl); // the same entry you left from
});

test("notebook contents land exactly on the entry (reader and continuous)", async ({ page }) => {
  await openScenario(page, "busy");
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await page.getByRole("region", { name: /^Tag / }).first().getByRole("button", { name: /notebook/i }).click();
  await expect(page).toHaveURL(/\/notebooks\//);
  const toc = page.getByRole("navigation", { name: "Contents" }).getByRole("button");
  await expect(toc.nth(10)).toBeVisible();
  const n = await toc.count();
  for (const i of [5, Math.min(40, n - 1), 1]) {
    const title = (await toc.nth(i).locator(".MuiListItemText-primary").innerText()).trim();
    await toc.nth(i).click();
    await expect(page.locator("[data-nb-section] h2")).toHaveText(title);
    await expect(page.getByText(`Entry ${i + 1} of ${n}`).first()).toBeVisible();
    expect(await page.evaluate(() => window.scrollY)).toBe(0); // the reader starts each entry at the top
  }
  await page.keyboard.press("ArrowRight");
  await expect(page.getByText(`Entry 3 of ${n}`).first()).toBeVisible();
  // Continuous: every entry has a place at once, but only those near the screen load (a long
  // notebook isn't fetched all at once). Jumps land on the entry while the ones around it load.
  await page.getByRole("button", { name: "Continuous" }).click();
  await expect(page.locator("[data-nb-section]")).toHaveCount(n);
  await expect.poll(() => page.locator("[data-nb-loading]").count()).toBeGreaterThan(n / 2); // most not fetched yet
  for (const i of [5, Math.min(40, n - 1)]) {
    await toc.nth(i).click();
    const id = (await page.locator("[data-nb-section]").nth(i).getAttribute("data-nb-section"))!;
    await expect(page.locator(`#nb-${id}:not([data-nb-loading])`)).toBeVisible(); // it loaded
    // Lands just below the sticky notebook bar.
    await expect.poll(() => page.evaluate((x) => Math.abs(Math.round(document.getElementById(`nb-${x}`)!.getBoundingClientRect().top) - 16 - parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--nb-bar") || "0")), id)).toBeLessThan(4);
  }
});

test("import slides is easy to find, and a deck dropped anywhere starts an import", async ({ page }) => {
  await openScenario(page, "small", "home");
  await expect(page.getByRole("complementary").getByRole("link", { name: "Import slides" })).toBeVisible();

  // Drag a real .pptx over the Home page and drop it.
  const dt = await page.evaluateHandle(({ bytes, type }) => {
    const d = new DataTransfer();
    d.items.add(new File([new Uint8Array(bytes)], "Dropped_Deck.pptx", { type }));
    return d;
  }, { bytes: [...FIXTURE], type: PPTX_MIME });
  await page.dispatchEvent("main", "dragenter", { dataTransfer: dt });
  await expect(page.getByText("Drop to import slides")).toBeVisible();
  await page.dispatchEvent("main", "dragover", { dataTransfer: dt });
  await page.dispatchEvent("main", "drop", { dataTransfer: dt });
  await expect(page).toHaveURL(/\/import$/);
  await expect(page.getByText("Dropped_Deck.pptx")).toBeVisible();
  await expect(page.getByLabel("Collection name")).toHaveValue("Dropped_Deck");
});
