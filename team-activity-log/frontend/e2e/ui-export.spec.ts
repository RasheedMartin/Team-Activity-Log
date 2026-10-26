import { expect, test } from "@playwright/test";
import JSZip from "jszip";
import { readFileSync } from "node:fs";
import path from "node:path";
import { openImport, openScenario } from "./helpers";

// Slides step 4: download what Present shows as a real PowerPoint file.

const FIXTURE = readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures", "Formatting_2024.pptx"));

test("download a deck as .pptx: designed slides, text slides, notes, pictures", async ({ page }) => {
  await openScenario(page, "small");
  await openImport(page);
  await page.getByLabel("File to import").setInputFiles({ name: "Formatting_2024.pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", buffer: FIXTURE });
  await page.getByRole("radio", { name: /One post for the deck/ }).click();
  await page.getByRole("radio", { name: /^Automatic/ }).click(); // a mix of designed and text slides
  await page.getByRole("button", { name: "Start import" }).click();
  await page.getByRole("button", { name: /^Create 1 draft$/ }).click({ timeout: 20_000 });
  await page.getByRole("button", { name: /^Publish all/ }).click(); // on the deck, where the import lands
  await expect(page.getByRole("tab", { name: "Published (1)" })).toBeVisible(); // cards now open the post, not the editor
  await page.getByRole("list", { name: "Posts in this collection" }).getByRole("link").first().click();
  await page.getByRole("button", { name: "Present" }).click();
  await expect(page.getByText(/^1 \/ \d+$/)).toBeVisible();
  const total = Number((await page.getByText(/^1 \/ \d+$/).innerText()).split("/")[1]);

  const [file] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download as PowerPoint" }).click()]);
  expect(file.suggestedFilename()).toBe("Quarterly review.pptx");
  const out = test.info().outputPath("export.pptx");
  await file.saveAs(out);
  await file.saveAs("test-results/exported-deck.pptx");

  const zip = await JSZip.loadAsync(readFileSync(out));
  const slides = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  expect(slides).toHaveLength(total);
  const xml = (await Promise.all(slides.map((n) => zip.file(n)!.async("string")))).join("\n");
  for (const text of ["Quarterly review", "Grouped box", "Step B", "Gain stable", "Run summary"]) expect(xml).toContain(text);
  // The chart is a native, editable PowerPoint chart with its data.
  const charts = Object.keys(zip.files).filter((n) => /^ppt\/charts\/chart\d+\.xml$/.test(n));
  expect(charts).toHaveLength(1);
  const chartXml = await zip.file(charts[0])!.async("string");
  for (const text of ["Ch 12", "Run A", "1.02", "2E75B6"]) expect(chartXml).toContain(text);
  expect(xml).toContain('typeface="Courier New"'); // a run's own font survives
  const notes = await Promise.all(Object.keys(zip.files).filter((n) => /^ppt\/notesSlides\/.*\.xml$/.test(n)).map((n) => zip.file(n)!.async("string")));
  expect(notes.join("\n")).toContain("Designed slide notes");
  expect(Object.keys(zip.files).some((n) => n.startsWith("ppt/media/"))).toBe(true);
});
