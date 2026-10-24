// Minimal ProseMirror JSON helpers. Rich text is always ProseMirror JSON (§C1), never raw HTML.

export interface PMNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: PMNode[];
}

const BLOCK_TYPES = new Set(["paragraph", "heading", "listItem", "blockquote", "codeBlock", "tableRow"]);

/** Plain text of a doc, with block boundaries as newlines (search indexing, snippets, slides). */
export function docText(doc: unknown): string {
  const out: string[] = [];
  const walk = (n: PMNode | undefined) => {
    if (!n || typeof n !== "object") return;
    if (n.type === "text" && n.text) out.push(n.text);
    if (n.type === "mention" && n.attrs?.label) out.push(`@${n.attrs.label}`);
    if (n.type === "hardBreak") out.push("\n");
    n.content?.forEach(walk);
    if (BLOCK_TYPES.has(n.type)) out.push("\n");
  };
  walk(doc as PMNode);
  return out.join("").replace(/\n{2,}/g, "\n").trim();
}

export const textNode = (text: string, marks?: PMNode["marks"]): PMNode => ({ type: "text", text, ...(marks ? { marks } : {}) });
export const paragraph = (text: string): PMNode => ({ type: "paragraph", content: text ? [textNode(text)] : [] });
export const heading = (text: string, level = 2): PMNode => ({ type: "heading", attrs: { level }, content: [textNode(text)] });
export const bulletList = (items: string[]): PMNode => ({
  type: "bulletList",
  content: items.map((t) => ({ type: "listItem", content: [paragraph(t)] })),
});
export const doc = (...content: PMNode[]): PMNode => ({ type: "doc", content });
export const docFromText = (text: string): PMNode => doc(...text.split(/\n+/).map(paragraph));

export const isDocEmpty = (d: unknown) => docText(d).trim().length === 0;

/** User IDs mentioned in a doc (mention nodes carry `id`). */
export function mentionedIds(d: unknown): string[] {
  const ids: string[] = [];
  const walk = (n: PMNode | undefined) => {
    if (!n) return;
    if (n.type === "mention" && typeof n.attrs?.id === "string") ids.push(n.attrs.id);
    n.content?.forEach(walk);
  };
  walk(d as PMNode);
  return [...new Set(ids)];
}

/** Whether a doc contains a table anywhere (its editor then needs table support to keep it). */
export function hasTable(doc: unknown): boolean {
  const walk = (n: PMNode | undefined): boolean => !!n && (n.type === "table" || (n.content ?? []).some(walk));
  return walk(doc as PMNode);
}
