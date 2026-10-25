import type { Block, ID, ImageView, Post, Presentation, SlideDesign } from "../api/contract";
import { docText, type PMNode } from "./prosemirror";

// §W5.1 slide derivation [DECISION]: a title slide, then slides from blocks. Explicit slide-break
// blocks win; otherwise each image becomes a slide with its adjacent text as caption, and long
// text is chunked. Imported decks keep their original breaks (they arrive as slide_break blocks).
// A designed slide block is always exactly one slide, shown as designed.

export type Slide = (
  | {
      kind: "title";
      postId: ID;
      title: string;
      summary?: string;
      workDate: string;
      authorId: ID;
      tagIds: ID[];
      notes?: string;
      /** Which parts show (Presentation.titleSlide); all by default. */
      show?: { date: boolean; author: boolean; summary: boolean; tags: boolean };
    }
  | {
      kind: "content";
      postId: ID;
      heading?: string;
      text: PMNode[];
      image?: ImageView;
      notes?: string;
      /** The post blocks this slide shows ("Customize this slide" turns them into a designed slide). */
      blockIds: ID[];
      /** Part of a text block split across slides: it can't be designed on its own. */
      partial?: boolean;
    }
  | { kind: "designed"; postId: ID; design: SlideDesign; images: Map<ID, ImageView>; notes?: string; blockId?: ID }
) & {
  /** Stable within a post's content: what Presentation.hidden refers to. */
  key?: string;
};

const designed = (postId: ID, b: Extract<Block, { type: "slide" }>, images: Map<ID, ImageView>): Slide => ({ kind: "designed", postId, design: b.design, images, notes: b.notes, blockId: b.id });

/** Keys: the title slide, a designed slide's block, else the first block shown (+ a counter for
 *  text split over several slides). Survive edits elsewhere in the post. */
function withKeys(slides: Slide[]): Slide[] {
  const seen = new Map<string, number>();
  return slides.map((sl) => {
    const base = sl.kind === "title" ? `${sl.postId}:title` : sl.kind === "designed" ? `${sl.postId}:d:${sl.blockId ?? ""}` : `${sl.postId}:c:${sl.blockIds[0] ?? ""}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return { ...sl, key: n ? `${base}:${n}` : base };
  });
}

/**
 * What actually presents (owner request): hidden slides out, optionally only designed slides,
 * title slides trimmed to the parts chosen, skipped right before a designed slide, or hidden.
 */
export function applyPresentation(slides: Slide[], p?: Presentation | null): Slide[] {
  if (!p) return slides;
  const hidden = new Set(p.hidden ?? []);
  const t = p.titleSlide ?? {};
  const show = { date: t.date !== false, author: t.author !== false, summary: t.summary !== false, tags: t.tags !== false };
  return slides.flatMap((sl, i): Slide[] => {
    if (sl.key && hidden.has(sl.key)) return [];
    if (sl.kind === "title") {
      if (t.hide) return [];
      const next = slides[i + 1];
      if (t.skipBeforeDesigned && next?.postId === sl.postId && next.kind === "designed") return [];
      return [{ ...sl, show }];
    }
    if (p.onlyDesigned && sl.kind !== "designed") return [];
    return [sl];
  });
}

const TEXT_BUDGET = 650; // characters of body text that comfortably fit beside nothing else
const CAPTION_BUDGET = 260; // text that fits as a caption under an image

const nodeText = (n: PMNode) => docText({ type: "doc", content: [n] });

/** Split a doc's top-level nodes into chunks that fit on one slide. */
function chunk(nodes: PMNode[], budget = TEXT_BUDGET): PMNode[][] {
  const out: PMNode[][] = [];
  let cur: PMNode[] = [];
  let size = 0;
  for (const n of nodes) {
    const len = nodeText(n).length + 40;
    if (cur.length && size + len > budget) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(n);
    size += len;
  }
  if (cur.length) out.push(cur);
  return out;
}

const topNodes = (b: Block): PMNode[] => ((b.type === "text" || b.type === "table") && (b.doc as PMNode)?.content ? ((b.doc as PMNode).content ?? []) : []);
const isBlank = (nodes: PMNode[]) => nodes.every((n) => !nodeText(n).trim() && n.type !== "table");

/** If the first node is a heading, lift it out as the slide heading. */
function liftHeading(nodes: PMNode[]): { heading?: string; rest: PMNode[] } {
  const [first, ...rest] = nodes;
  if (first?.type === "heading") return { heading: nodeText(first), rest };
  return { rest: nodes };
}

function contentSlides(postId: ID, blocks: Block[], images: Map<ID, ImageView>, notes?: string): Slide[] {
  const slides: Slide[] = [];
  let pendingText: PMNode[] = [];
  let pendingIds: ID[] = [];
  const flushText = () => {
    if (isBlank(pendingText)) {
      pendingText = [];
      pendingIds = [];
      return;
    }
    const chunks = chunk(pendingText);
    for (const c of chunks) {
      const { heading, rest } = liftHeading(c);
      slides.push({ kind: "content", postId, heading, text: rest, blockIds: pendingIds, partial: chunks.length > 1 || undefined });
    }
    pendingText = [];
    pendingIds = [];
  };
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type === "image") {
      const image = images.get(b.imageInstanceId);
      if (!image) continue;
      // Adjacent text becomes the caption when it's short: the text right before the image
      // (if nothing else claimed it), else the text right after.
      let caption: PMNode[] = [];
      let ids: ID[] = [b.id];
      const before = pendingText;
      if (!isBlank(before) && docText({ type: "doc", content: before }).length <= CAPTION_BUDGET) {
        caption = before;
        ids = [...pendingIds, b.id];
        pendingText = [];
        pendingIds = [];
      } else {
        flushText();
        const next = blocks[i + 1];
        const after = next ? topNodes(next) : [];
        if (next && next.type === "text" && !isBlank(after) && docText(next.doc).length <= CAPTION_BUDGET) {
          caption = after;
          ids = [b.id, next.id];
          i++;
        }
      }
      const { heading, rest } = liftHeading(caption);
      slides.push({ kind: "content", postId, heading, text: rest, image, blockIds: ids });
    } else if (b.type === "text" || b.type === "table") {
      pendingText.push(...topNodes(b));
      pendingIds.push(b.id);
    } else if (b.type === "slide") {
      flushText();
      slides.push(designed(postId, b, images));
    }
  }
  flushText();
  if (notes && slides.length) slides[0] = { ...slides[0], notes } as Slide;
  return slides;
}

export function deriveSlides(post: Post, images: ImageView[]): Slide[] {
  return withKeys(rawSlides(post, images));
}

function rawSlides(post: Post, images: ImageView[]): Slide[] {
  const imgs = new Map(images.map((i) => [i.id, i]));
  const title: Slide = { kind: "title", postId: post.id, title: post.title || "Untitled", summary: post.summary, workDate: post.workDate, authorId: post.authorId, tagIds: post.tagIds };
  const hasBreaks = post.blocks.some((b) => b.type === "slide_break");
  if (!hasBreaks) return [title, ...contentSlides(post.id, post.blocks, imgs)];
  // Explicit breaks: each section is one slide (images and text together), chunked only if huge.
  const sections: { blocks: Block[]; notes?: string; slide?: Extract<Block, { type: "slide" }> }[] = [{ blocks: [] }];
  for (const b of post.blocks) {
    if (b.type === "slide_break") sections.push({ blocks: [], notes: b.notes });
    else if (b.type === "slide") sections.push({ blocks: [], slide: b }, { blocks: [] });
    else sections[sections.length - 1].blocks.push(b);
  }
  const out: Slide[] = [title];
  for (const s of sections) {
    if (s.slide) {
      out.push(designed(post.id, s.slide, imgs));
      continue;
    }
    const imageBlocks = s.blocks.filter((b): b is Extract<Block, { type: "image" }> => b.type === "image");
    const text = s.blocks.flatMap(topNodes);
    if (!imageBlocks.length && isBlank(text)) continue;
    if (imageBlocks.length <= 1) {
      const chunks = chunk(text, imageBlocks.length ? CAPTION_BUDGET * 2 : TEXT_BUDGET * 1.5);
      const first = liftHeading(chunks[0] ?? []);
      const ids = s.blocks.map((b) => b.id);
      const partial = chunks.length > 1 || undefined;
      out.push({ kind: "content", postId: post.id, heading: first.heading, text: first.rest, image: imageBlocks[0] ? imgs.get(imageBlocks[0].imageInstanceId) : undefined, notes: s.notes, blockIds: ids, partial });
      chunks.slice(1).forEach((c) => out.push({ kind: "content", postId: post.id, text: c, blockIds: ids, partial }));
    } else {
      out.push(...contentSlides(post.id, s.blocks, imgs, s.notes));
    }
  }
  return out;
}
