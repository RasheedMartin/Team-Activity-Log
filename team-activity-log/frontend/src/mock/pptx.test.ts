import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { docText } from "../lib/prosemirror";
import { guessDate, parsePptx } from "./pptx";

// jsdom's Blob lacks arrayBuffer(), so tests hand the parser raw bytes (the app passes a Blob).
const deck = () => new Uint8Array(readFileSync(join(__dirname, "../../e2e/fixtures/Lab_Notes_2021.pptx")));

describe("pptx parser", () => {
  it("reads slide order, titles, sections, notes, and pictures", async () => {
    const d = await parsePptx(deck());
    expect(d.slides.map((s) => s.title)).toEqual(["Cooldown overview", "Cooldown curve", "", "Calibration results", "Gain plot", "Calibration issues", "Analysis summary", "Next steps"]);
    expect(d.hasSections).toBe(true);
    expect(d.slides.map((s) => s.section)).toEqual(["Cooldown", "Cooldown", "Cooldown", "Calibration", "Calibration", "Calibration", "Analysis", "Analysis"]);
    expect(d.slides[0].notes).toBe("Mention the pump schedule");
    expect(d.slides[1].images).toHaveLength(1);
    expect(d.slides[1].images[0].blob.type).toBe("image/png");
  });
  it("keeps bullets, emphasis, and tables", async () => {
    const d = await parsePptx(deck());
    expect(d.slides[0].content[0].type).toBe("bulletList");
    expect(JSON.stringify(d.slides[0].content)).toContain('"bold"');
    expect(JSON.stringify(d.slides[5].content)).toContain('"italic"');
    expect(d.slides[3].content[0].type).toBe("table");
    expect(docText({ type: "doc", content: d.slides[3].content })).toContain("1.02");
  });
  it("guesses dates in several formats", async () => {
    const d = await parsePptx(deck());
    expect(d.slides.map((s) => s.date)).toEqual(["2024-03-12", undefined, "2024-03-14", "2024-03-20", undefined, undefined, "2024-03-28", undefined]);
    expect(guessDate("no date here, run 4512")).toBeUndefined();
  });
  it("warns about what it can't carry over", async () => {
    const d = await parsePptx(deck());
    expect(d.slides[1].warnings).toContain("Animations not preserved");
    expect(d.slides[2].warnings).toContain("No title on this slide");
    expect(d.slides[4].warnings).toContain("Chart not converted (export it as an image)");
    expect(d.slides[7].warnings).toContain("Slide transition not preserved");
  });
  it("rejects files that aren't presentations, with a readable message", async () => {
    await expect(parsePptx(new Uint8Array(4000))).rejects.toThrow(/isn't a valid .pptx/);
  });

  it("keeps formatting and reading order exactly like the backend parser", async () => {
    // Formatting_2024.expected.json is the backend parser's output (backend/tests/test_pptx.py).
    const d = await parsePptx(new Uint8Array(readFileSync(join(__dirname, "../../e2e/fixtures/Formatting_2024.pptx"))));
    const expected = JSON.parse(readFileSync(join(__dirname, "../../e2e/fixtures/Formatting_2024.expected.json"), "utf8"));
    const got = d.slides.map((s) => ({ title: s.title, warnings: s.warnings, notes: s.notes, parts: s.parts, rich: s.rich, design: s.design, designImages: s.designImages.length }));
    expect(got).toEqual(expected);
  });
});
