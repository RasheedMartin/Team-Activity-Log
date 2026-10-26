import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { notebookAction, openDocumentImport, openImport, openScenario } from "./helpers";

// Owner request: PDF and Word files import into notebooks (slides still make decks); the original
// is kept and downloadable.
const fixture = (name: string) => readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures", name));

for (const [file, mime, pages, title] of [
  ["Noise_study.pdf", "application/pdf", 2, "Detector B noise study"],
  ["Run_notes.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", 3, "Method"],
] as const) {
  test(`import ${file} into a notebook, publish it, and download the original`, async ({ page }) => {
    await openScenario(page, "small");
    await openDocumentImport(page);
    await expect(page.getByRole("heading", { name: "Import a document" })).toBeVisible();
    await page.getByLabel("File to import").setInputFiles({ name: file, mimeType: mime, buffer: fixture(file) });
    await expect(page.getByText("becomes a notebook")).toBeVisible();
    await expect(page.getByRole("radiogroup", { name: "Slide design" })).toHaveCount(0); // slides only
    await page.getByRole("button", { name: "Start import" }).click();
    await page.getByRole("button", { name: new RegExp(`^Create ${pages} drafts$`) }).click({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/notebooks\//);
    await expect(page.getByText(new RegExp(`^${pages} pages? from “${file}” are drafts`))).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Contents" })).toContainText(title);

    await page.getByRole("alert").getByRole("button", { name: "Publish all" }).click();
    await expect(page.getByText(new RegExp(`^Published ${pages} pages`))).toBeVisible();

    const download = page.waitForEvent("download");
    await notebookAction(page, /^Download original/);
    expect((await download).suggestedFilename()).toBe(file);
  });
}

test("each section imports its own kind of file", async ({ page }) => {
  await openScenario(page, "small");
  await openImport(page);
  await expect(page.getByRole("heading", { name: "Import slides" })).toBeVisible();
  await page.getByLabel("File to import").setInputFiles({ name: "Noise_study.pdf", mimeType: "application/pdf", buffer: fixture("Noise_study.pdf") });
  await expect(page.getByText(/Import slides takes PowerPoint \(\.pptx\) files/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Start import" })).toBeDisabled(); // no way around it
  await page.getByRole("alert").getByRole("button", { name: "Import a document" }).click();
  await expect(page.getByRole("heading", { name: "Import a document" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start import" })).toBeEnabled();
});

test("Import a document speaks in pages before a file is chosen", async ({ page }) => {
  await openScenario(page, "small");
  await openDocumentImport(page);
  await expect(page.getByText("How should the document become pages?")).toBeVisible();
  await expect(page.getByLabel("Notebook name")).toBeVisible();
  await expect(page.getByText(/slides/i)).toHaveCount(0);
});

test("a document can be imported into an existing notebook", async ({ page }) => {
  await openScenario(page, "small");
  await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Notebooks" }).click();
  await page.getByRole("button", { name: "New notebook" }).click();
  await page.getByRole("dialog").getByLabel("Name").fill("Detector log");
  await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();
  await expect(page.getByText("This notebook is empty")).toBeVisible();
  await notebookAction(page, "Import a document into this notebook");
  await page.getByLabel("File to import").setInputFiles({ name: "Run_notes.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: fixture("Run_notes.docx") });
  await expect(page.getByRole("radio", { name: "An existing notebook" })).toBeChecked();
  await expect(page.getByRole("combobox", { name: "Notebook" })).toHaveText("Detector log");
  await page.getByRole("button", { name: "Start import" }).click();
  await page.getByRole("button", { name: /^Create 3 drafts$/ }).click({ timeout: 20_000 });
  await expect(page.getByLabel("Notebook title")).toHaveValue("Detector log");
  await expect(page.getByText(/^3 pages from “Run_notes\.docx” are drafts/)).toBeVisible();
});
