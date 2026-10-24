import { describe, expect, it } from "vitest";
import type { Block, ImageView, Post } from "../api/contract";
import { doc, heading, paragraph } from "./prosemirror";
import { deriveSlides } from "./slides";

const img = (id: string): ImageView => ({ id, assetId: "a", tags: [], customFields: {}, asset: { id: "a", kind: "image", mime: "image/png", bytes: 1, width: 10, height: 10, sha256: "", dominantColors: [], variants: [], processing: "ready", metadata: { ocrState: "none", sourceKind: "upload" } } });
const post = (blocks: Block[]): Post => ({ id: "p", orgId: "o", workspaceId: "w", title: "Cooldown", workDate: "2026-10-01", workDateSource: "user", status: "published", visibility: "visible", authorId: "u", coAuthorIds: [], tagIds: [], blocks, revision: 1, version: 1, createdAt: "", updatedAt: "", counts: { comments: 0, reactions: 0, images: 0 }, reactions: {}, collectionIds: [] });
const text = (id: string, ...ps: string[]): Block => ({ id, type: "text", doc: doc(...ps.map(paragraph)) });
const image = (id: string): Block => ({ id, type: "image", imageInstanceId: id });

describe("slide derivation (§W5.1)", () => {
  it("starts with a title slide", () => {
    const s = deriveSlides(post([]), []);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ kind: "title", title: "Cooldown" });
  });
  it("each image becomes a slide with adjacent short text as its caption", () => {
    const s = deriveSlides(post([text("t1", "Before the plot."), image("i1"), text("t2", "After the plot."), image("i2")]), [img("i1"), img("i2")]);
    expect(s.map((x) => x.kind)).toEqual(["title", "content", "content"]);
    expect(s[1]).toMatchObject({ image: { id: "i1" } });
    expect(JSON.stringify((s[1] as { text: unknown }).text)).toContain("Before the plot.");
    expect(JSON.stringify((s[2] as { text: unknown }).text)).toContain("After the plot.");
  });
  it("chunks long text across slides and lifts headings", () => {
    const long = Array.from({ length: 12 }, (_, i) => `Paragraph ${i} ${"x".repeat(90)}`);
    const s = deriveSlides(post([{ id: "t", type: "text", doc: doc(heading("Results"), ...long.map(paragraph)) }]), []);
    expect(s.length).toBeGreaterThan(2);
    expect(s[1]).toMatchObject({ heading: "Results" });
  });
  it("explicit slide breaks win and carry presenter notes", () => {
    const s = deriveSlides(
      post([text("a", "Intro"), { id: "b1", type: "slide_break", notes: "Mention the pump" }, text("c", "Second"), image("i1"), { id: "b2", type: "slide_break" }, text("d", "Third")]),
      [img("i1")],
    );
    expect(s.map((x) => x.kind)).toEqual(["title", "content", "content", "content"]);
    expect(s[2]).toMatchObject({ notes: "Mention the pump", image: { id: "i1" } });
  });
  it("skips empty sections", () => {
    const s = deriveSlides(post([{ id: "b", type: "slide_break" }, text("a", "")]), []);
    expect(s).toHaveLength(1);
  });
});
