import { describe, expect, it } from "vitest";
import type { Block, ImageView } from "../api/contract";
import { blockDocs, blockImageIds } from "./blocks";
import { bringOn, designToBlocks, fitImage, keepOn, newDesign, offSlide, sectionToDesign } from "./slideLayouts";
import { doc, docText, heading, paragraph } from "./prosemirror";

const img = (id: string, width: number, height: number) => ({ id, asset: { width, height } }) as unknown as ImageView;

describe("designed slide helpers", () => {
  it("starter layouts are 16:9 with a title", () => {
    for (const l of ["title", "titleBody", "twoColumn"] as const) {
      const d = newDesign(l);
      expect(d.size).toEqual({ w: 960, h: 540 });
      expect(d.elements.some((e) => e.kind === "text" && e.role === "title")).toBe(true);
    }
    expect(newDesign("blank").elements).toEqual([]);
  });

  it("fits a picture inside an area, keeping its shape", () => {
    expect(fitImage(img("a", 2000, 1000), { x: 0, y: 0, w: 400, h: 400 })).toEqual({ x: 0, y: 100, w: 400, h: 200 });
  });

  it("turns a section into a slide: heading → title, text beside the first picture, extra pictures kept", () => {
    const images = new Map([["i1", img("i1", 800, 600)], ["i2", img("i2", 800, 600)]]);
    const section: Block[] = [
      { id: "t", type: "text", doc: doc(heading("Results"), paragraph("Gain is stable")) },
      { id: "a", type: "image", imageInstanceId: "i1" },
      { id: "b", type: "image", imageInstanceId: "i2" },
    ];
    const { design, rest } = sectionToDesign(section, images);
    const [title, body, picture] = design.elements;
    expect(title).toMatchObject({ kind: "text", role: "title" });
    expect(docText((title as { doc: unknown }).doc)).toBe("Results");
    expect(docText((body as { doc: unknown }).doc)).toBe("Gain is stable");
    expect(picture).toMatchObject({ kind: "image", imageInstanceId: "i1" });
    expect(picture.x).toBeGreaterThan(body.x + body.w - 1); // beside, not on top of, the text
    expect(rest).toEqual([section[2]]);
  });

  it("turns a slide back into post text in reading order, without template art", () => {
    const slide: Extract<Block, { type: "slide" }> = {
      id: "s",
      type: "slide",
      notes: "say hi",
      design: {
        size: { w: 960, h: 540 },
        elements: [
          { id: "logo", kind: "image", imageInstanceId: "logo", x: 900, y: 500, w: 40, h: 20, decorative: true },
          { id: "body", kind: "text", x: 48, y: 140, w: 400, h: 300, doc: doc(paragraph("Body")) },
          { id: "pic", kind: "image", imageInstanceId: "p", x: 500, y: 140, w: 400, h: 300 },
          { id: "title", kind: "text", role: "title", x: 48, y: 20, w: 800, h: 80, doc: doc(paragraph("Title")) },
        ],
      },
    };
    const blocks = designToBlocks(slide);
    expect(blocks.map((b) => b.type)).toEqual(["slide_break", "text", "image"]);
    expect(blocks[0]).toMatchObject({ notes: "say hi" });
    expect(docText((blocks[1] as { doc: unknown }).doc)).toBe("Title\nBody");
    expect((blocks[1] as { doc: { content: { type: string }[] } }).doc.content[0].type).toBe("heading");
    expect(blockImageIds(blocks)).toEqual(["p"]);
  });

  it("slide text and pictures count as post content, template art does not", () => {
    const blocks: Block[] = [
      {
        id: "s",
        type: "slide",
        design: {
          size: { w: 960, h: 540 },
          elements: [
            { id: "a", kind: "text", x: 0, y: 0, w: 1, h: 1, doc: doc(paragraph("Visible")) },
            { id: "b", kind: "text", x: 0, y: 0, w: 1, h: 1, doc: doc(paragraph("Confidential")), decorative: true },
            { id: "c", kind: "image", imageInstanceId: "x", x: 0, y: 0, w: 1, h: 1, decorative: true },
            { id: "d", kind: "image", imageInstanceId: "y", x: 0, y: 0, w: 1, h: 1 },
          ],
        },
      },
    ];
    expect(blockDocs(blocks).map(docText)).toEqual(["Visible"]);
    expect(blockImageIds(blocks)).toEqual(["x", "y"]);
    expect(blockImageIds(blocks, "content")).toEqual(["y"]);
  });
});

describe("keeping slide elements reachable", () => {
  it("a moved element keeps a 32 pt strip on the slide (all of it when smaller)", () => {
    expect(keepOn(2000, 100, 960)).toBe(928); // pushed far right: 32 pt still showing
    expect(keepOn(-500, 100, 960)).toBe(-68); // far left: 32 pt still showing
    expect(keepOn(400, 100, 960)).toBe(400); // inside: unchanged
    expect(keepOn(950, 10, 960)).toBe(950); // a 10 pt element stays whole
    expect(keepOn(-5, 10, 960)).toBe(0);
  });
  it("finds elements nobody can see and brings them just inside", () => {
    const e = { id: "x", kind: "shape" as const, shape: "ellipse" as const, x: 1200, y: -300, w: 100, h: 80 };
    expect(offSlide(e, 960, 540)).toBe(true);
    expect(bringOn(e, 960, 540)).toEqual({ x: 860, y: 0 });
    expect(offSlide({ ...e, x: 900, y: 0 }, 960, 540)).toBe(false); // partly visible is fine
  });
});
