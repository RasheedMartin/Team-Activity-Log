import JSZip from "jszip";
import type { ISODate } from "../api/contract";
import { docText, type PMNode } from "../lib/prosemirror";

// Real .pptx reading for the mock import (owner request: "does import actually work?").
// A .pptx is a zip of OOXML parts. These rules are also the spec for the backend worker
// (python-pptx, §B13 B-5), so the mock and the real import agree:
//
//   order      ppt/presentation.xml <p:sldIdLst>, resolved through presentation.xml.rels
//   sections   <p14:sectionLst> in presentation.xml extLst (PowerPoint "Sections")
//   title      the shape whose placeholder type is "title" or "ctrTitle"
//   text       every other text shape, in z-order; bulleted when it is a body/object placeholder
//              or a paragraph has <a:buChar>/<a:buAutoNum>; bold/italic/underline kept
//   tables     <a:tbl> inside a graphicFrame → table block
//   pictures   <p:pic> → <a:blip r:embed> → slide rels → ppt/media/* (PNG/JPEG/GIF/SVG)
//   notes      the slide's notesSlide part, body placeholder text
//   headers    slides whose layout type is "secHead" start a section when no Sections exist
//   warnings   charts, SmartArt, EMF/WMF pictures, video/audio, animations, transitions,
//              slides without a title

export interface ParsedImage {
  name: string;
  blob: Blob;
}
export interface ParsedSlide {
  n: number;
  title: string;
  section?: string;
  isSectionHeader: boolean;
  content: PMNode[];
  images: ParsedImage[];
  notes: string;
  text: string;
  date?: ISODate;
  warnings: string[];
}
export interface ParsedDeck {
  slides: ParsedSlide[];
  hasSections: boolean;
}

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", svg: "image/svg+xml", webp: "image/webp" };

const xml = (s: string) => new DOMParser().parseFromString(s, "application/xml");
const els = (root: Element | Document, tag: string) => Array.from(root.getElementsByTagName(tag));
const first = (root: Element | Document, tag: string) => root.getElementsByTagName(tag)[0] as Element | undefined;
const children = (el: Element, tag?: string) => Array.from(el.children).filter((c) => !tag || c.tagName === tag);

/** Resolve "../media/image1.png" relative to "ppt/slides/slide1.xml". */
function resolvePath(fromPart: string, target: string) {
  if (target.startsWith("/")) return target.slice(1);
  const parts = fromPart.split("/").slice(0, -1);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

async function rels(zip: JSZip, part: string): Promise<{ id: string; type: string; target: string }[]> {
  const dir = part.split("/").slice(0, -1).join("/");
  const name = part.split("/").pop();
  const f = zip.file(`${dir}/_rels/${name}.rels`);
  if (!f) return [];
  return els(xml(await f.async("string")), "Relationship").map((r) => ({ id: r.getAttribute("Id") ?? "", type: r.getAttribute("Type") ?? "", target: resolvePath(part, r.getAttribute("Target") ?? "") }));
}

// ---- text ----

function runs(p: Element): PMNode[] {
  const out: PMNode[] = [];
  for (const c of Array.from(p.children)) {
    if (c.tagName === "a:r" || c.tagName === "a:fld") {
      const t = first(c, "a:t")?.textContent ?? "";
      if (!t) continue;
      const pr = first(c, "a:rPr");
      const marks: PMNode["marks"] = [];
      if (pr?.getAttribute("b") === "1") marks.push({ type: "bold" });
      if (pr?.getAttribute("i") === "1") marks.push({ type: "italic" });
      const u = pr?.getAttribute("u");
      if (u && u !== "none") marks.push({ type: "underline" });
      out.push({ type: "text", text: t, ...(marks.length ? { marks } : {}) });
    } else if (c.tagName === "a:br") out.push({ type: "hardBreak" });
  }
  return out;
}

const plain = (nodes: PMNode[]) => nodes.map((n) => (n.type === "hardBreak" ? "\n" : n.text ?? "")).join("");

/** Paragraphs of a text body → ProseMirror nodes (paragraphs, or a bullet list when bulleted). */
function textBody(body: Element, bulleted: boolean): PMNode[] {
  const out: PMNode[] = [];
  let list: PMNode | null = null;
  for (const p of els(body, "a:p")) {
    const content = runs(p);
    if (!plain(content).trim()) {
      list = null;
      continue;
    }
    const ppr = first(p, "a:pPr");
    const explicitBullet = !!(ppr && (first(ppr, "a:buChar") || first(ppr, "a:buAutoNum")));
    const noBullet = !!(ppr && first(ppr, "a:buNone"));
    if ((bulleted || explicitBullet) && !noBullet) {
      if (!list) {
        list = { type: "bulletList", content: [] };
        out.push(list);
      }
      list.content!.push({ type: "listItem", content: [{ type: "paragraph", content }] });
    } else {
      list = null;
      out.push({ type: "paragraph", content });
    }
  }
  return out;
}

function table(tbl: Element): PMNode {
  return {
    type: "table",
    content: els(tbl, "a:tr").map((tr, r) => ({
      type: "tableRow",
      content: children(tr, "a:tc").map((tc) => ({ type: r === 0 ? "tableHeader" : "tableCell", content: [{ type: "paragraph", content: runs(first(tc, "a:p") ?? tc) }] })),
    })),
  };
}

// ---- dates ----

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (n: number) => String(n).padStart(2, "0");
/** First plausible date in the text (ISO, US numeric, "12 Mar 2024", "March 12, 2024"). */
export function guessDate(text: string): ISODate | undefined {
  const valid = (y: number, m: number, d: number) => y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31;
  let m = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/.exec(text);
  if (m && valid(+m[1], +m[2], +m[3])) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(text);
  if (m && valid(+m[3], +m[1], +m[2])) return `${m[3]}-${pad(+m[1])}-${pad(+m[2])}`;
  m = /\b(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})\b/.exec(text);
  if (m) {
    const mo = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1;
    if (mo && valid(+m[3], mo, +m[1])) return `${m[3]}-${pad(mo)}-${pad(+m[1])}`;
  }
  m = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/.exec(text);
  if (m) {
    const mo = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
    if (mo && valid(+m[3], mo, +m[2])) return `${m[3]}-${pad(mo)}-${pad(+m[2])}`;
  }
  return undefined;
}

// ---- slides ----

async function parseSlide(zip: JSZip, part: string, n: number): Promise<ParsedSlide> {
  const doc = xml(await zip.file(part)!.async("string"));
  const slideRels = await rels(zip, part);
  const warnings: string[] = [];
  const content: PMNode[] = [];
  const images: ParsedImage[] = [];
  let title = "";

  const walk = async (tree: Element) => {
    for (const el of Array.from(tree.children)) {
      if (el.tagName === "p:grpSp") await walk(el);
      else if (el.tagName === "p:sp") {
        const ph = first(el, "p:ph");
        const type = ph?.getAttribute("type") ?? (ph ? "body" : undefined);
        const body = first(el, "p:txBody");
        if (!body) continue;
        if ((type === "title" || type === "ctrTitle") && !title) {
          title = els(body, "a:p").map((p) => plain(runs(p))).join(" ").replace(/\s+/g, " ").trim();
          continue;
        }
        if (type === "sldNum" || type === "dt" || type === "ftr") continue; // slide chrome, not content
        content.push(...textBody(body, type === "body" || type === "obj"));
      } else if (el.tagName === "p:pic") {
        if (first(el, "a:videoFile") || first(el, "p14:media") || first(el, "a:audioFile")) {
          warnings.push("Video/audio not imported");
          continue;
        }
        const embed = first(el, "a:blip")?.getAttribute("r:embed");
        const target = slideRels.find((r) => r.id === embed)?.target;
        if (!target) continue;
        const ext = target.split(".").pop()!.toLowerCase();
        const mime = MIME[ext];
        if (!mime) {
          warnings.push(`${ext.toUpperCase()} picture not supported (re-save it as PNG)`);
          continue;
        }
        const f = zip.file(target);
        if (f) images.push({ name: `slide${n}-${target.split("/").pop()}`, blob: new Blob([await f.async("uint8array")], { type: mime }) });
      } else if (el.tagName === "p:graphicFrame") {
        const uri = first(el, "a:graphicData")?.getAttribute("uri") ?? "";
        const tbl = first(el, "a:tbl");
        if (tbl) content.push(table(tbl));
        else if (uri.includes("chart")) warnings.push("Chart not converted (export it as an image)");
        else if (uri.includes("diagram")) warnings.push("SmartArt not converted");
        else warnings.push("Embedded object not converted");
      }
    }
  };
  const spTree = first(doc, "p:spTree");
  if (spTree) await walk(spTree);
  if (first(doc, "p:timing")) warnings.push("Animations not preserved");
  if (first(doc, "p:transition")) warnings.push("Slide transition not preserved");
  if (!title) warnings.push("No title on this slide");

  let notes = "";
  const notesRel = slideRels.find((r) => r.type.endsWith("/notesSlide"));
  if (notesRel && zip.file(notesRel.target)) {
    const nd = xml(await zip.file(notesRel.target)!.async("string"));
    notes = els(nd, "p:sp")
      .filter((sp) => first(sp, "p:ph")?.getAttribute("type") === "body")
      .flatMap((sp) => els(sp, "a:p").map((p) => plain(runs(p))))
      .join("\n")
      .trim();
  }
  let isSectionHeader = false;
  const layoutRel = slideRels.find((r) => r.type.endsWith("/slideLayout"));
  if (layoutRel && zip.file(layoutRel.target)) {
    const ld = xml(await zip.file(layoutRel.target)!.async("string"));
    isSectionHeader = ld.documentElement.getAttribute("type") === "secHead";
  }
  const text = `${title}\n${docText({ type: "doc", content })}`.trim();
  return { n, title, isSectionHeader, content, images, notes, text, date: guessDate(text), warnings };
}

/** Parse a .pptx. Throws a readable Error if it isn't one. `onProgress` gets 0..1 per slide. */
export async function parsePptx(input: Blob | Uint8Array, onProgress?: (f: number) => void): Promise<ParsedDeck> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(input instanceof Uint8Array ? input : await input.arrayBuffer());
  } catch {
    throw new Error("This file isn't a valid .pptx (it couldn't be opened as a PowerPoint package). Re-save it from PowerPoint and try again.");
  }
  const presFile = zip.file("ppt/presentation.xml");
  if (!presFile) throw new Error("This file isn't a PowerPoint presentation (no ppt/presentation.xml). Is it a Word or Excel file?");
  const pres = xml(await presFile.async("string"));
  const presRels = await rels(zip, "ppt/presentation.xml");
  const order = els(pres, "p:sldId").map((s) => ({ id: s.getAttribute("id") ?? "", target: presRels.find((r) => r.id === s.getAttribute("r:id"))?.target }));
  const sectionOf = new Map<string, string>();
  for (const sec of els(pres, "p14:section")) for (const sid of els(sec, "p14:sldId")) sectionOf.set(sid.getAttribute("id") ?? "", sec.getAttribute("name") ?? "");
  const slides: ParsedSlide[] = [];
  for (let i = 0; i < order.length; i++) {
    const t = order[i].target;
    if (!t || !zip.file(t)) continue;
    const s = await parseSlide(zip, t, i + 1);
    s.section = sectionOf.get(order[i].id) || undefined;
    slides.push(s);
    onProgress?.((i + 1) / order.length);
  }
  if (!slides.length) throw new Error("This presentation has no slides.");
  return { slides, hasSections: sectionOf.size > 0 };
}
