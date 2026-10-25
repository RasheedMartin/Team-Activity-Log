import { describe, expect, it } from "vitest";
import type { Post } from "../api/contract";
import { applyPresentation, deriveSlides } from "./slides";

const doc = (t: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] });
const post = {
  id: "p1",
  title: "Run 4512",
  summary: "Cooldown",
  workDate: "2026-10-01",
  authorId: "u1",
  tagIds: ["t1"],
  blocks: [
    { id: "s1", type: "slide", design: { width: 960, height: 540, elements: [] } },
    { id: "b1", type: "slide_break" },
    { id: "x1", type: "text", doc: doc("Notes on the run") },
  ],
} as unknown as Post;

describe("applyPresentation (what presents)", () => {
  const all = deriveSlides(post, []);
  it("gives every slide a stable key", () => {
    expect(all.map((s) => s.key)).toEqual(["p1:title", "p1:d:s1", "p1:c:x1"]);
  });
  it("hides slides by key, keeps only designed slides, trims or skips title slides", () => {
    expect(applyPresentation(all, { hidden: ["p1:c:x1"] }).map((s) => s.key)).toEqual(["p1:title", "p1:d:s1"]);
    expect(applyPresentation(all, { onlyDesigned: true }).map((s) => s.kind)).toEqual(["title", "designed"]);
    expect(applyPresentation(all, { titleSlide: { skipBeforeDesigned: true } }).map((s) => s.kind)).toEqual(["designed", "content"]);
    expect(applyPresentation(all, { titleSlide: { hide: true }, onlyDesigned: true }).map((s) => s.kind)).toEqual(["designed"]);
    const title = applyPresentation(all, { titleSlide: { date: false, tags: false } })[0];
    expect(title.kind === "title" && title.show).toEqual({ date: false, author: true, summary: true, tags: false });
  });
});
