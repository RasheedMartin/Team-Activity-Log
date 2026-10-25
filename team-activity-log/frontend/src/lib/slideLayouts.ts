import type { Block, ID, ImageView, SlideDesign, SlideElement, SlideShape } from "../api/contract";
import { uuidv7 } from "./ids";
import { doc, heading, paragraph, type PMNode } from "./prosemirror";

// Making and unmaking designed slides in the composer: starter layouts, a section of post text
// turned into a slide, and a slide turned back into post text. Sizes are points on a 960×540 canvas.

export const SLIDE_W = 960;
export const SLIDE_H = 540;

export type SlideLayout = "title" | "titleBody" | "twoColumn" | "blank";

export const LAYOUTS: { id: SlideLayout; label: string }[] = [
  { id: "titleBody", label: "Title and text" },
  { id: "title", label: "Title slide" },
  { id: "twoColumn", label: "Two columns" },
  { id: "blank", label: "Blank" },
];

const id = () => uuidv7();
type TextElement = Extract<SlideElement, { kind: "text" }>;

const title = (text: string, box: Partial<TextElement> = {}): TextElement => ({
  id: id(), kind: "text", role: "title", x: 48, y: 28, w: 864, h: 84, fontSize: 36, color: "#1f2328", valign: "bottom",
  doc: doc(paragraph(text)), ...box,
}); // prettier-ignore
const body = (content: PMNode[], box: Partial<TextElement> = {}): TextElement => ({
  id: id(), kind: "text", role: "body", x: 48, y: 132, w: 864, h: 370, fontSize: 22, color: "#1f2328", doc: doc(...content), ...box,
}); // prettier-ignore
const bullets = (...items: string[]): PMNode => ({ type: "bulletList", content: items.map((t) => ({ type: "listItem", content: [paragraph(t)] })) });

export function newDesign(layout: SlideLayout): SlideDesign {
  const base = { size: { w: SLIDE_W, h: SLIDE_H }, background: "#ffffff" };
  switch (layout) {
    case "title":
      return { ...base, elements: [title("Title", { y: 150, h: 120, fontSize: 44, valign: "middle", doc: doc({ type: "paragraph", attrs: { textAlign: "center" }, content: [{ type: "text", text: "Title" }] }) }), body([{ type: "paragraph", attrs: { textAlign: "center" }, content: [{ type: "text", text: "Subtitle" }] }], { y: 280, h: 60, fontSize: 24, color: "#57606a" })] };
    case "twoColumn":
      return { ...base, elements: [title("Title"), body([bullets("First point")], { w: 420 }), body([bullets("Second point")], { x: 492, w: 420 })] };
    case "blank":
      return { ...base, elements: [] };
    default:
      return { ...base, elements: [title("Title"), body([bullets("First point", "Second point")])] };
  }
}

/** A box for an image of this shape, fitted inside `area` and centered in it. */
export function fitImage(img: ImageView, area: { x: number; y: number; w: number; h: number }) {
  const s = Math.min(area.w / img.asset.width, area.h / img.asset.height);
  const w = Math.round(img.asset.width * s);
  const h = Math.round(img.asset.height * s);
  return { x: Math.round(area.x + (area.w - w) / 2), y: Math.round(area.y + (area.h - h) / 2), w, h };
}

export function newElement(kind: "text" | SlideShape, at?: { x: number; y: number }): SlideElement {
  if (kind === "text") return { id: id(), kind: "text", x: at?.x ?? 330, y: at?.y ?? 240, w: 300, h: 60, fontSize: 24, color: "#1f2328", doc: doc(paragraph("Text")) };
  if (kind === "line" || kind === "arrow") return { id: id(), kind: "shape", shape: kind, x: at?.x ?? 380, y: at?.y ?? 270, w: 200, h: 0, line: "#333333", lineWidth: 2 };
  return { id: id(), kind: "shape", shape: kind, x: at?.x ?? 400, y: at?.y ?? 220, w: 160, h: 100, fill: "#4472c4", fontSize: 18, color: "#ffffff", valign: "middle" };
}

export function imageElement(img: ImageView, area = { x: 240, y: 120, w: 480, h: 300 }): SlideElement {
  return { id: id(), kind: "image", imageInstanceId: img.id, ...fitImage(img, area) };
}

const topNodes = (b: Block): PMNode[] => (b.type === "text" || b.type === "table" ? (((b.doc as PMNode)?.content ?? []) as PMNode[]) : []);
const nodeText = (n: PMNode): string => (n.text ?? "") + (n.content ?? []).map(nodeText).join("");

/**
 * A section of post content as a starting design: its first heading becomes the title, the rest
 * of its text the body, and its first image sits beside the text. Images past the first are
 * returned so the caller keeps them as image blocks.
 */
export function sectionToDesign(blocks: Block[], images: Map<ID, ImageView>): { design: SlideDesign; rest: Block[] } {
  const nodes = blocks.flatMap(topNodes);
  const head = nodes[0]?.type === "heading" ? nodeText(nodes[0]) : "";
  const text = head ? nodes.slice(1) : nodes;
  const imageBlocks = blocks.filter((b): b is Extract<Block, { type: "image" }> => b.type === "image" && images.has(b.imageInstanceId));
  const img = imageBlocks[0] ? images.get(imageBlocks[0].imageInstanceId)! : undefined;
  const elements: SlideElement[] = [];
  if (head) elements.push(title(head));
  const top = head ? 132 : 48;
  const area = { y: top, h: SLIDE_H - top - 38 };
  if (text.length) elements.push(body(text, { y: area.y, h: area.h, w: img ? 420 : 864 }));
  if (img) elements.push({ id: id(), kind: "image", imageInstanceId: img.id, ...fitImage(img, text.length ? { x: 492, y: area.y, w: 420, h: area.h } : { x: 48, y: area.y, w: 864, h: area.h }) });
  return { design: { size: { w: SLIDE_W, h: SLIDE_H }, background: "#ffffff", elements }, rest: imageBlocks.slice(1) };
}

/** A designed slide back to post content, in reading order: a slide break (with the notes), its
 *  text as one text block, then its pictures. Template art is dropped. */
export function designToBlocks(slide: Extract<Block, { type: "slide" }>): Block[] {
  const band = slide.design.size.h / 16;
  const order = slide.design.elements.filter((e) => !e.decorative).sort((a, b) => Math.floor(a.y / band) - Math.floor(b.y / band) || a.x - b.x);
  const content = order.flatMap((e) => {
    if (e.kind === "image" || !e.doc) return [];
    const nodes = ((e.doc as PMNode).content ?? []) as PMNode[];
    return e.role === "title" && nodes.length === 1 && nodes[0].type === "paragraph" ? [heading(nodeText(nodes[0]))] : nodes;
  });
  return [
    { id: id(), type: "slide_break", ...(slide.notes ? { notes: slide.notes } : {}) },
    ...(content.length ? [{ id: id(), type: "text" as const, doc: doc(...content) }] : []),
    ...order.flatMap((e) => (e.kind === "image" ? [{ id: id(), type: "image" as const, imageInstanceId: e.imageInstanceId }] : [])),
  ];
}

// ---- keeping elements reachable ----

export const KEEP = 32; // points of an element that always stay on the slide while moving it

/** Keep at least KEEP points of a box (or all of it, if smaller) on the slide. */
export const keepOn = (v: number, size: number, slide: number) => {
  const keep = Math.min(KEEP, Math.max(size, 1));
  return Math.min(slide - keep, Math.max(keep - size, v));
};
/** Entirely outside the slide: invisible, so it needs rescuing. */
export const offSlide = (e: SlideElement, W: number, H: number) => e.x >= W || e.y >= H || e.x + e.w <= 0 || e.y + e.h <= 0;
/** Just inside the nearest edge (or the top-left corner, for one bigger than the slide). */
export const bringOn = (e: SlideElement, W: number, H: number) => ({ x: Math.max(0, Math.min(W - e.w, e.x)), y: Math.max(0, Math.min(H - e.h, e.y)) });
