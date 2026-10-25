import type { Block, ID, SlideDesign } from "../api/contract";
import { docText, isDocEmpty } from "./prosemirror";

// One place that knows where a post's text and images live, so every block type (including
// designed slides) is searched, previewed, and counted the same way. Mirrors backend views.py.

/** ProseMirror docs in reading order: text/table blocks, and text on designed slides (not template text). */
export function blockDocs(blocks: Block[]): unknown[] {
  return blocks.flatMap((b) => (b.type === "text" || b.type === "table" ? [b.doc] : b.type === "slide" ? designDocs(b.design) : []));
}

export function designDocs(design: SlideDesign): unknown[] {
  return design.elements.flatMap((e) => (e.kind !== "image" && e.doc && !e.decorative ? [e.doc] : []));
}

/** Image instances a post shows. `content` drops template art (logos repeated on every slide). */
export function blockImageIds(blocks: Block[], which: "all" | "content" = "all"): ID[] {
  return blocks.flatMap((b) =>
    b.type === "image" ? [b.imageInstanceId] : b.type === "slide" ? b.design.elements.flatMap((e) => (e.kind === "image" && (which === "all" || !e.decorative) ? [e.imageInstanceId] : [])) : [],
  );
}

export const blocksText = (blocks: Block[]) => blockDocs(blocks).map(docText).filter(Boolean).join("\n");

export const hasContent = (blocks: Block[]) => blockImageIds(blocks).length > 0 || blocks.some((b) => b.type === "file") || blockDocs(blocks).some((d) => !isDocEmpty(d));
