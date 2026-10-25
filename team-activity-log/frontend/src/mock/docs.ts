import JSZip from "jszip";
import type { PMNode } from "../lib/prosemirror";
import type { ParsedDeck, ParsedImage, ParsedSlide, SlidePart } from "./pptx";

// Mirrors backend/src/tal/docs.py: PDF pages and Word heading sections become notebook pages.
// PDF: each page as its picture, the page's text carried along as the picture's text. Word: headings
// split; paragraphs, lists, tables, and pictures come across as text.

const lines = (t: string) => t.replace(/\r/g, "\n").split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);

const slide = (n: number, title: string, images: ParsedImage[], parts: SlidePart[], text: string, warnings: string[] = [], section?: string): ParsedSlide => ({
  n, title, section, isSectionHeader: false, content: [], images, notes: "", text, warnings, parts, designImages: [], rich: false, look: {},
});

export async function parsePdf(input: Blob, onProgress?: (f: number) => void): Promise<ParsedDeck> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  let pdf;
  try {
    pdf = await pdfjs.getDocument({ data: new Uint8Array(await input.arrayBuffer()) }).promise;
  } catch {
    throw new Error("This isn't a readable PDF (it may be damaged or password-protected)");
  }
  const marks: [number, string][] = [];
  for (const item of (await pdf.getOutline()) ?? []) {
    try {
      const dest = typeof item.dest === "string" ? await pdf.getDestination(item.dest) : item.dest;
      if (dest?.[0]) marks.push([await pdf.getPageIndex(dest[0]), item.title.slice(0, 200)]);
    } catch {
      // a bookmark we can't place: skip it
    }
  }
  marks.sort((a, b) => a[0] - b[0]);
  const deck: ParsedDeck = { slides: [], hasSections: marks.length > 0 };
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const text = (await page.getTextContent()).items.map((it) => ("str" in it ? it.str + (it.hasEOL ? "\n" : " ") : "")).join("");
    const ls = lines(text);
    const vp = page.getViewport({ scale: 1600 / page.getViewport({ scale: 1 }).width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    await page.render({ canvasContext: canvas.getContext("2d")!, viewport: vp }).promise;
    const blob = await new Promise<Blob>((ok) => canvas.toBlob((b) => ok(b!), "image/png"));
    const img: ParsedImage & { text?: string } = { name: `page-${i}.png`, blob, text: ls.join("\n") || undefined };
    const section = [...marks].reverse().find(([at]) => at <= i - 1)?.[1];
    deck.slides.push(slide(i, ls[0]?.slice(0, 200) || `Page ${i}`, [img], [{ kind: "image", index: 0 }], ls.join("\n"), ls.length ? [] : ["No text layer (a scan?): its text will be read from the picture"], section));
    onProgress?.(i / pdf.numPages);
  }
  return deck;
}

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const xml = (s: string) => new DOMParser().parseFromString(s, "application/xml");
const kids = (el: Element) => Array.from(el.children);
const w = (el: Element, tag: string) => Array.from(el.getElementsByTagNameNS(W, tag));

function runs(p: Element, rels: Record<string, string>): PMNode[] {
  const out: PMNode[] = [];
  const run = (r: Element, href?: string) => {
    const pr = w(r, "rPr")[0];
    const on = (tag: string) => { const el = pr && w(pr, tag)[0]; return !!el && !["0", "false"].includes(el.getAttributeNS(W, "val") ?? ""); };
    const marks = [...(on("b") ? [{ type: "bold" }] : []), ...(on("i") ? [{ type: "italic" }] : []), ...(href ? [{ type: "link", attrs: { href } }] : [])];
    for (const c of kids(r)) {
      if (c.localName === "t" && c.textContent) out.push({ type: "text", text: c.textContent, ...(marks.length ? { marks } : {}) } as PMNode);
      else if (c.localName === "tab") out.push({ type: "text", text: "\t" } as PMNode);
      else if (c.localName === "br" || c.localName === "cr") out.push({ type: "hardBreak" } as PMNode);
    }
  };
  for (const c of kids(p)) {
    if (c.localName === "r") run(c);
    else if (c.localName === "hyperlink") {
      const t = rels[c.getAttributeNS(R, "id") ?? ""];
      w(c, "r").forEach((r) => run(r, t && /^(https?:|mailto:)/.test(t) ? t : undefined));
    }
  }
  return out;
}
const plain = (n: PMNode): string => (n.type === "text" ? (n as { text?: string }).text ?? "" : ((n as { content?: PMNode[] }).content ?? []).map(plain).join(" "));

export async function parseDocx(input: Blob, onProgress?: (f: number) => void): Promise<ParsedDeck> {
  let zip: JSZip;
  let body: Element | undefined;
  try {
    zip = await JSZip.loadAsync(await input.arrayBuffer());
    body = w(xml(await zip.file("word/document.xml")!.async("string")).documentElement, "body")[0];
  } catch {
    throw new Error("This isn't a valid .docx file");
  }
  if (!body) throw new Error("This document is empty");
  const styles: Record<string, string> = {};
  const st = zip.file("word/styles.xml");
  if (st) for (const s of w(xml(await st.async("string")).documentElement, "style")) styles[s.getAttributeNS(W, "styleId") ?? ""] = w(s, "name")[0]?.getAttributeNS(W, "val") ?? "";
  const rels: Record<string, string> = {};
  const rf = zip.file("word/_rels/document.xml.rels");
  if (rf) for (const r of Array.from(xml(await rf.async("string")).getElementsByTagName("Relationship"))) rels[r.getAttribute("Id") ?? ""] = r.getAttribute("Target") ?? "";
  const levelOf = (style: string) => { const s = style.toLowerCase().replace(/ /g, ""); return s === "title" ? 1 : /^heading([1-6])$/.test(s) ? Number(s.slice(7)) : undefined; };

  type B = { kind: "heading"; level: number; text: string } | { kind: "nodes"; nodes: PMNode[] } | { kind: "image"; img: ParsedImage };
  const blocks: B[] = [];
  let items: PMNode[] = [];
  const flush = () => { if (items.length) blocks.push({ kind: "nodes", nodes: [{ type: "bulletList", content: items } as PMNode] }); items = []; };
  for (const el of kids(body)) {
    if (el.localName === "p") {
      const ppr = w(el, "pPr")[0];
      const style = styles[(ppr && w(ppr, "pStyle")[0]?.getAttributeNS(W, "val")) ?? ""] ?? "";
      for (const blip of Array.from(el.getElementsByTagNameNS(A, "blip"))) {
        const target = rels[blip.getAttributeNS(R, "embed") ?? ""];
        const path = target ? "word/" + target.replace(/^\//, "").replace(/^word\//, "") : "";
        const f = path && zip.file(path);
        const ext = path.split(".").pop()?.toLowerCase() ?? "";
        if (f && ["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) {
          flush();
          blocks.push({ kind: "image", img: { name: path.split("/").pop()!, blob: new Blob([await f.async("uint8array")], { type: `image/${ext === "jpg" ? "jpeg" : ext}` }) } });
        }
      }
      const content = runs(el, rels);
      const text = content.map(plain).join("").trim();
      const level = levelOf(style);
      if (level && text) {
        flush();
        blocks.push({ kind: "heading", level, text });
      } else if (ppr && w(ppr, "numPr").length && text) items.push({ type: "listItem", content: [{ type: "paragraph", content }] } as PMNode);
      else if (text) {
        flush();
        blocks.push({ kind: "nodes", nodes: [{ type: "paragraph", content } as PMNode] });
      }
    } else if (el.localName === "tbl") {
      flush();
      const rows = w(el, "tr").map((tr, ri) => ({
        type: "tableRow",
        content: kids(tr).filter((c) => c.localName === "tc").map((tc) => ({ type: ri ? "tableCell" : "tableHeader", content: w(tc, "p").map((p) => { const c = runs(p, rels); return c.length ? { type: "paragraph", content: c } : { type: "paragraph" }; }) })),
      }));
      if (rows.length) blocks.push({ kind: "nodes", nodes: [{ type: "table", content: rows } as unknown as PMNode] });
    }
  }
  flush();
  const levels = [...new Set(blocks.flatMap((b) => (b.kind === "heading" ? [b.level] : [])))].sort();
  const split = levels[0];
  type U = { title: string; parts: SlidePart[]; images: ParsedImage[]; texts: string[] };
  const units: U[] = [{ title: "", parts: [], images: [], texts: [] }];
  for (const b of blocks) {
    if (b.kind === "heading" && b.level === split) { units.push({ title: b.text.slice(0, 200), parts: [], images: [], texts: [] }); continue; }
    const u = units[units.length - 1];
    if (b.kind === "image") { u.images.push(b.img); u.parts.push({ kind: "image", index: u.images.length - 1 }); continue; }
    const nodes = b.kind === "heading" ? [{ type: "heading", attrs: { level: Math.min(4, Math.max(2, b.level - (split ?? 0) + 2)) }, content: [{ type: "text", text: b.text }] } as PMNode] : b.nodes;
    const last = u.parts[u.parts.length - 1];
    if (last?.kind === "text") last.content.push(...nodes);
    else u.parts.push({ kind: "text", content: [...nodes] });
    u.texts.push(nodes.map(plain).join(" "));
  }
  const kept = units.filter((u) => u.parts.length || u.title);
  if (!kept.length) throw new Error("No text or pictures found in this document");
  const deck: ParsedDeck = { slides: [], hasSections: false };
  kept.forEach((u, i) => {
    const text = u.texts.filter(Boolean).join("\n");
    deck.slides.push(slide(i + 1, u.title || lines(text)[0]?.slice(0, 200) || `Part ${i + 1}`, u.images, u.parts, text));
    onProgress?.((i + 1) / kept.length);
  });
  return deck;
}
