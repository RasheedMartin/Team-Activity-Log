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
//   order      shapes in reading order (top to bottom, then left to right) by their <a:off>,
//              placeholders inheriting their position from the layout, then the master;
//              z-order when any shape has no position
//   text       every other text shape; bulleted when it is a body/object placeholder or a
//              paragraph has <a:buChar>/<a:buAutoNum> (numbered); <a:pPr lvl> nests lists
//   formatting bold, italic, underline, strike, links (<a:hlinkClick>), text color and highlight
//              (srgbClr / schemeClr through the theme, with lumMod/lumOff), alignment (algn);
//              colors are kept only when clearly colored, so black/white/gray text follows the
//              app theme. A subtitle placeholder, or a short paragraph whose runs are all
//              >= 28 pt, becomes a heading.
//   tables     <a:tbl> inside a graphicFrame → table block; header row when firstRow is set
//              (or no tblPr); gridSpan/rowSpan kept, merged-away cells skipped
//   charts     the chart part's cached series data → a table (categories × series)
//   SmartArt   the diagram data part's node text → a bullet list
//   pictures   <p:pic> → <a:blip r:embed> → slide rels → ppt/media/* (PNG/JPEG/GIF/SVG)
//   notes      the slide's notesSlide part, body placeholder text
//   headers    slides whose layout type is "secHead" start a section when no Sections exist
//   warnings   charts/SmartArt converted (or not), EMF/WMF pictures, video/audio, animations,
//              transitions, slides without a title

export interface ParsedImage {
  name: string;
  blob: Blob;
}
/** Reading order: text runs and pictures (index into `images`), adjacent text merged. */
export type SlidePart = { kind: "text"; content: PMNode[] } | { kind: "image"; index: number };
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
  parts: SlidePart[];
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
  // External targets (hyperlinks) are kept as written.
  return els(xml(await f.async("string")), "Relationship").map((r) => {
    const target = r.getAttribute("Target") ?? "";
    return { id: r.getAttribute("Id") ?? "", type: r.getAttribute("Type") ?? "", target: r.getAttribute("TargetMode") === "External" ? target : resolvePath(part, target) };
  });
}

// ---- colors ----

const SCHEME_ALIAS: Record<string, string> = { tx1: "dk1", bg1: "lt1", tx2: "dk2", bg2: "lt2" };
const HEX = /^[0-9a-fA-F]{6}$/;
type Theme = Record<string, string>;

const relOf = async (zip: JSZip, part: string | undefined, kind: string) => (part ? (await rels(zip, part)).find((r) => r.type.endsWith(`/${kind}`))?.target : undefined);

/** The deck theme's color scheme (slide → layout → master → theme), name → RRGGBB. */
async function themeColors(zip: JSZip, slidePart: string): Promise<Theme> {
  const layout = await relOf(zip, slidePart, "slideLayout");
  const master = await relOf(zip, layout, "slideMaster");
  const theme = await relOf(zip, master, "theme");
  const f = theme ? zip.file(theme) : null;
  if (!f) return {};
  const scheme = first(xml(await f.async("string")), "a:clrScheme");
  const out: Theme = {};
  for (const c of scheme ? Array.from(scheme.children) : []) {
    const v = c.children[0];
    const val = (v?.tagName === "a:srgbClr" ? v.getAttribute("val") : v?.getAttribute("lastClr")) ?? "";
    if (HEX.test(val)) out[c.tagName.split(":").pop()!] = val;
  }
  return out;
}

function rgbToHls(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, l, 0];
  const d = max - min;
  const s = l <= 0.5 ? d / (max + min) : d / (2 - max - min);
  const h = (max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4) / 6;
  return [h, l, s];
}

function hlsToRgb(h: number, l: number, s: number): [number, number, number] {
  if (s === 0) return [l, l, l];
  const q2 = l <= 0.5 ? l * (1 + s) : l + s - l * s;
  const p2 = 2 * l - q2;
  const f = (t: number) => {
    t = ((t % 1) + 1) % 1;
    if (t < 1 / 6) return p2 + (q2 - p2) * 6 * t;
    if (t < 1 / 2) return q2;
    if (t < 2 / 3) return p2 + (q2 - p2) * (2 / 3 - t) * 6;
    return p2;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}

const channels = (hex: string) => [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];

/** "#rrggbb" from a fill element's srgbClr/schemeClr/sysClr child, with lumMod/lumOff applied. */
function color(fill: Element | undefined, theme: Theme): string | undefined {
  for (const c of fill ? Array.from(fill.children) : []) {
    let base: string;
    if (c.tagName === "a:srgbClr") base = c.getAttribute("val") ?? "";
    else if (c.tagName === "a:schemeClr") {
      const v = c.getAttribute("val") ?? "";
      base = theme[SCHEME_ALIAS[v] ?? v] ?? "";
    } else if (c.tagName === "a:sysClr") base = c.getAttribute("lastClr") ?? "";
    else continue;
    if (!HEX.test(base)) return undefined;
    const [h, l0, s] = rgbToHls(...channels(base));
    let light = l0;
    for (const mod of Array.from(c.children)) {
      const raw = mod.getAttribute("val") ?? "";
      if (!/^\d+$/.test(raw)) continue;
      if (mod.tagName === "a:lumMod") light *= +raw / 100_000;
      else if (mod.tagName === "a:lumOff") light += +raw / 100_000;
    }
    return "#" + hlsToRgb(h, Math.min(1, Math.max(0, light)), s).map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("");
  }
  return undefined;
}

/** Clearly colored (not black, white or gray), so it carries meaning worth keeping. */
function distinct(c: string): boolean {
  const [, light, s] = rgbToHls(...channels(c.slice(1)));
  return s >= 0.25 && light >= 0.18 && light <= 0.82;
}

// ---- text ----

/** What text conversion needs from the slide: its theme colors and hyperlink targets. */
interface Ctx {
  theme: Theme;
  links: Record<string, string>;
}
const NO_CTX: Ctx = { theme: {}, links: {} };
const SAFE_HREF = /^(https?:\/\/|mailto:)/i;
const ALIGN: Record<string, string> = { ctr: "center", r: "right", just: "justify" };
const HEADING_SIZE = 2800; // hundredths of a point: 28 pt and up reads as a heading

function runs(p: Element, ctx: Ctx = NO_CTX): PMNode[] {
  const out: PMNode[] = [];
  for (const c of Array.from(p.children)) {
    if (c.tagName === "a:r" || c.tagName === "a:fld") {
      const t = first(c, "a:t")?.textContent ?? "";
      if (!t) continue;
      const pr = children(c, "a:rPr")[0];
      const marks: NonNullable<PMNode["marks"]> = [];
      if (pr) {
        if (pr.getAttribute("b") === "1") marks.push({ type: "bold" });
        if (pr.getAttribute("i") === "1") marks.push({ type: "italic" });
        const u = pr.getAttribute("u");
        if (u && u !== "none") marks.push({ type: "underline" });
        if (["sngStrike", "dblStrike"].includes(pr.getAttribute("strike") ?? "")) marks.push({ type: "strike" });
        const href = ctx.links[children(pr, "a:hlinkClick")[0]?.getAttribute("r:id") ?? ""];
        if (href && SAFE_HREF.test(href)) marks.push({ type: "link", attrs: { href } });
        const fg = color(children(pr, "a:solidFill")[0], ctx.theme);
        if (fg && distinct(fg)) marks.push({ type: "textStyle", attrs: { color: fg } });
        const hl = color(children(pr, "a:highlight")[0], ctx.theme);
        if (hl) marks.push({ type: "highlight", attrs: { color: hl } });
      }
      out.push({ type: "text", text: t, ...(marks.length ? { marks } : {}) });
    } else if (c.tagName === "a:br") out.push({ type: "hardBreak" });
  }
  return out;
}

const plain = (nodes: PMNode[]) => nodes.map((n) => (n.type === "hardBreak" ? "\n" : n.text ?? "")).join("");

/** Every run with text is explicitly sized at heading size. */
function large(p: Element): boolean {
  const sizes = Array.from(p.children)
    .filter((r) => (r.tagName === "a:r" || r.tagName === "a:fld") && (first(r, "a:t")?.textContent ?? "").trim())
    .map((r) => children(r, "a:rPr")[0]?.getAttribute("sz") ?? "");
  return sizes.length > 0 && sizes.every((sz) => /^\d+$/.test(sz) && +sz >= HEADING_SIZE);
}

const align = (p: Element) => ALIGN[children(p, "a:pPr")[0]?.getAttribute("algn") ?? ""] as string | undefined;

function block(type: string, content: PMNode[], textAlign?: string, level?: number): PMNode {
  const attrs: Record<string, unknown> = {};
  if (level) attrs.level = level;
  if (textAlign) attrs.textAlign = textAlign;
  return { type, ...(Object.keys(attrs).length ? { attrs } : {}), content };
}

/** Paragraphs of a text body → ProseMirror nodes: paragraphs, headings, and (nested) lists. */
function textBody(body: Element, bulleted: boolean, ctx: Ctx = NO_CTX, subtitle = false): PMNode[] {
  const out: PMNode[] = [];
  let stack: { level: number; kind: string; node: PMNode }[] = []; // open lists, outermost first
  for (const p of els(body, "a:p")) {
    const content = runs(p, ctx);
    if (!plain(content).trim()) {
      stack = [];
      continue;
    }
    const ppr = children(p, "a:pPr")[0];
    const auto = ppr ? children(ppr, "a:buAutoNum")[0] : undefined;
    const explicit = !!(ppr && (children(ppr, "a:buChar")[0] || auto));
    const noBullet = !!(ppr && children(ppr, "a:buNone")[0]);
    if ((bulleted || explicit) && !noBullet) {
      const lvl = ppr?.getAttribute("lvl") ?? "0";
      const level = /^\d+$/.test(lvl) ? Math.min(+lvl, 8) : 0;
      const kind = auto ? "orderedList" : "bulletList";
      while (stack.length && stack[stack.length - 1].level > level) stack.pop();
      if (stack.length && stack[stack.length - 1].level === level && stack[stack.length - 1].kind !== kind) stack.pop();
      if (!stack.length || stack[stack.length - 1].level < level) {
        const start = auto?.getAttribute("startAt") ?? "";
        const list: PMNode = { type: kind, content: [], ...(/^\d+$/.test(start) && +start !== 1 ? { attrs: { start: +start } } : {}) };
        if (stack.length) stack[stack.length - 1].node.content!.at(-1)!.content!.push(list); // nested under the previous item
        else out.push(list);
        stack.push({ level, kind, node: list });
      }
      stack[stack.length - 1].node.content!.push({ type: "listItem", content: [block("paragraph", content, align(p))] });
    } else {
      stack = [];
      const heading = subtitle || (large(p) && plain(content).length <= 120);
      out.push(heading ? block("heading", content, align(p), 3) : block("paragraph", content, align(p)));
    }
  }
  return out;
}

function table(tbl: Element, ctx: Ctx = NO_CTX): PMNode {
  const pr = children(tbl, "a:tblPr")[0];
  const header = !pr || pr.getAttribute("firstRow") === "1";
  return {
    type: "table",
    content: els(tbl, "a:tr").map((tr, r) => ({
      type: "tableRow",
      content: children(tr, "a:tc")
        .filter((tc) => tc.getAttribute("hMerge") !== "1" && tc.getAttribute("vMerge") !== "1") // covered by a neighbor's span
        .map((tc) => {
          const paras = els(tc, "a:p").map((p) => block("paragraph", runs(p, ctx), align(p))).filter((x) => x.content!.length);
          const attrs: Record<string, number> = {};
          for (const [k, a] of [["colspan", "gridSpan"], ["rowspan", "rowSpan"]] as const) {
            const v = tc.getAttribute(a) ?? "1";
            if (/^\d+$/.test(v) && +v > 1) attrs[k] = +v;
          }
          return { type: header && r === 0 ? "tableHeader" : "tableCell", ...(Object.keys(attrs).length ? { attrs } : {}), content: paras.length ? paras : [{ type: "paragraph" }] };
        }),
    })),
  };
}

const MAX_CHART_ROWS = 200;
const MAX_CHART_SERIES = 20;

/** A chart's cached data as a table: a row per category, a column per series. */
function chartTable(doc: Document): PMNode[] {
  const titleEl = first(doc, "c:title");
  const title = titleEl ? els(titleEl, "a:t").map((t) => t.textContent ?? "").join(" ").trim() : "";
  const points = (el?: Element) => {
    const out = new Map<number, string>();
    for (const pt of el ? els(el, "c:pt") : []) {
      const v = first(pt, "c:v");
      if (/^\d+$/.test(pt.getAttribute("idx") ?? "") && v) out.set(+pt.getAttribute("idx")!, v.textContent ?? "");
    }
    return out;
  };
  let cats = new Map<number, string>();
  const series = els(doc, "c:ser")
    .slice(0, MAX_CHART_SERIES)
    .map((ser, i) => {
      const tx = children(ser, "c:tx")[0];
      const name = tx ? els(tx, "c:v").map((v) => v.textContent ?? "").join(" ").trim() : "";
      if (!cats.size) cats = points(children(ser, "c:cat")[0] ?? children(ser, "c:xVal")[0]);
      return { name: name || `Series ${i + 1}`, vals: points(children(ser, "c:val")[0] ?? children(ser, "c:yVal")[0]) };
    });
  if (!series.length) return [];
  const idxs = [...new Set([...cats.keys(), ...series.flatMap((s) => [...s.vals.keys()])])].sort((a, b) => a - b).slice(0, MAX_CHART_ROWS);
  const cell = (type: string, t: string): PMNode => ({ type, content: [{ type: "paragraph", ...(t ? { content: [{ type: "text", text: t }] } : {}) }] });
  const rows: PMNode[] = [
    { type: "tableRow", content: [cell("tableHeader", ""), ...series.map((s) => cell("tableHeader", s.name))] },
    ...idxs.map((i) => ({ type: "tableRow", content: [cell("tableCell", cats.get(i) ?? String(i + 1)), ...series.map((s) => cell("tableCell", s.vals.get(i) ?? ""))] })),
  ];
  const caption: PMNode[] = title ? [{ type: "paragraph", content: [{ type: "text", text: title, marks: [{ type: "bold" }] }] }] : [];
  return [...caption, { type: "table", content: rows }];
}

/** SmartArt node text, in document order, as a bullet list. */
function smartArt(doc: Document): PMNode[] {
  const items = els(doc, "dgm:pt")
    .filter((pt) => (pt.getAttribute("type") ?? "node") === "node")
    .map((pt) => {
      const t = children(pt, "dgm:t")[0];
      return t ? els(t, "a:t").map((x) => x.textContent ?? "").join(" ").trim() : "";
    })
    .filter(Boolean)
    .map((text) => ({ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text }] }] }));
  return items.length ? [{ type: "bulletList", content: items }] : [];
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

type Pos = [number, number]; // (y, x) in EMU

/** (y, x) of a shape's top-left corner, when the shape states it. */
function offset(el: Element): Pos | undefined {
  const xfrm = el.tagName === "p:graphicFrame" ? children(el, "p:xfrm")[0] : [children(el, "p:spPr")[0], children(el, "p:grpSpPr")[0]].map((pr) => pr && children(pr, "a:xfrm")[0]).find(Boolean);
  const off = xfrm ? children(xfrm, "a:off")[0] : undefined;
  const y = off?.getAttribute("y") ?? "";
  const x = off?.getAttribute("x") ?? "";
  return /^-?\d+$/.test(y) && /^-?\d+$/.test(x) ? [+y, +x] : undefined;
}

/** Placeholder positions on a layout or master, keyed "idx:N" and "type:T". */
async function placeholderOffsets(zip: JSZip, part: string | undefined): Promise<Map<string, Pos>> {
  const out = new Map<string, Pos>();
  const f = part ? zip.file(part) : null;
  if (!f) return out;
  for (const sp of els(xml(await f.async("string")), "p:sp")) {
    const ph = first(sp, "p:ph");
    const off = offset(sp);
    if (!ph || !off) continue;
    const idx = ph.getAttribute("idx");
    if (idx && !out.has(`idx:${idx}`)) out.set(`idx:${idx}`, off);
    const type = `type:${ph.getAttribute("type") ?? "body"}`;
    if (!out.has(type)) out.set(type, off);
  }
  return out;
}

async function parseSlide(zip: JSZip, part: string, n: number, slideHeight = 6_858_000): Promise<ParsedSlide> {
  const doc = xml(await zip.file(part)!.async("string"));
  const slideRels = await rels(zip, part);
  const byId = new Map(slideRels.map((r) => [r.id, r]));
  const ctx: Ctx = { theme: await themeColors(zip, part), links: Object.fromEntries(slideRels.filter((r) => r.type.endsWith("/hyperlink")).map((r) => [r.id, r.target])) };
  const layout = await relOf(zip, part, "slideLayout");
  const inherited = [await placeholderOffsets(zip, layout), await placeholderOffsets(zip, await relOf(zip, layout, "slideMaster"))];
  const warnings: string[] = [];
  const images: ParsedImage[] = [];
  const pieces: { pos?: Pos; part: SlidePart }[] = [];
  let title = "";

  const position = (el: Element): Pos | undefined => {
    const off = offset(el);
    const ph = off ? undefined : first(el, "p:ph");
    if (!ph) return off;
    const keys = [...(ph.getAttribute("idx") ? [`idx:${ph.getAttribute("idx")}`] : []), `type:${ph.getAttribute("type") ?? "body"}`];
    for (const src of inherited) for (const k of keys) if (src.has(k)) return src.get(k);
    return undefined;
  };
  const text = (el: Element, content: PMNode[]) => {
    if (content.length) pieces.push({ pos: position(el), part: { kind: "text", content } });
  };
  const partXml = async (target?: string) => (target && zip.file(target) ? xml(await zip.file(target)!.async("string")) : undefined);

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
        text(el, textBody(body, type === "body" || type === "obj", ctx, type === "subTitle"));
      } else if (el.tagName === "p:pic") {
        if (first(el, "a:videoFile") || first(el, "p14:media") || first(el, "a:audioFile")) {
          warnings.push("Video/audio not imported");
          continue;
        }
        const target = byId.get(first(el, "a:blip")?.getAttribute("r:embed") ?? "")?.target;
        if (!target) continue;
        const ext = target.split(".").pop()!.toLowerCase();
        const mime = MIME[ext];
        if (!mime) {
          warnings.push(`${ext.toUpperCase()} picture not supported (re-save it as PNG)`);
          continue;
        }
        const f = zip.file(target);
        if (f) {
          images.push({ name: `slide${n}-${target.split("/").pop()}`, blob: new Blob([await f.async("uint8array")], { type: mime }) });
          pieces.push({ pos: position(el), part: { kind: "image", index: images.length - 1 } });
        }
      } else if (el.tagName === "p:graphicFrame") {
        const uri = first(el, "a:graphicData")?.getAttribute("uri") ?? "";
        const tbl = first(el, "a:tbl");
        if (tbl) text(el, [table(tbl, ctx)]);
        else if (uri.includes("chart")) {
          const cd = await partXml(byId.get(first(el, "c:chart")?.getAttribute("r:id") ?? "")?.target);
          const nodes = cd ? chartTable(cd) : [];
          text(el, nodes);
          warnings.push(nodes.length ? "Chart imported as a table of its data" : "Chart not converted (export it as an image)");
        } else if (uri.includes("diagram")) {
          const dd = await partXml(byId.get(first(el, "dgm:relIds")?.getAttribute("r:dm") ?? "")?.target);
          const nodes = dd ? smartArt(dd) : [];
          text(el, nodes);
          warnings.push(nodes.length ? "SmartArt imported as a list" : "SmartArt not converted");
        } else warnings.push("Embedded object not converted");
      }
    }
  };
  const spTree = first(doc, "p:spTree");
  if (spTree) await walk(spTree);
  if (first(doc, "p:timing")) warnings.push("Animations not preserved");
  if (first(doc, "p:transition")) warnings.push("Slide transition not preserved");
  if (!title) warnings.push("No title on this slide");

  // Reading order: rows (shapes whose tops are within a band of each other), then left to right.
  if (pieces.length && pieces.every((p) => p.pos)) {
    const band = Math.max(1, Math.floor(slideHeight / 16));
    pieces.sort((a, b) => Math.floor(a.pos![0] / band) - Math.floor(b.pos![0] / band) || a.pos![1] - b.pos![1]);
  }
  const parts: SlidePart[] = [];
  for (const { part: p } of pieces) {
    const last = parts.at(-1);
    if (p.kind === "text" && last?.kind === "text") last.content.push(...p.content);
    else parts.push(p.kind === "text" ? { kind: "text", content: [...p.content] } : p);
  }
  const content = parts.flatMap((p) => (p.kind === "text" ? p.content : []));

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
  const ld = await partXml(layout);
  const isSectionHeader = ld?.documentElement.getAttribute("type") === "secHead";
  const textAll = `${title}\n${docText({ type: "doc", content })}`.trim();
  return { n, title, isSectionHeader, content, images, notes, text: textAll, date: guessDate(textAll), warnings, parts };
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
  const cy = first(pres, "p:sldSz")?.getAttribute("cy") ?? "";
  const height = /^\d+$/.test(cy) ? +cy : 6_858_000;
  const sectionOf = new Map<string, string>();
  for (const sec of els(pres, "p14:section")) for (const sid of els(sec, "p14:sldId")) sectionOf.set(sid.getAttribute("id") ?? "", sec.getAttribute("name") ?? "");
  const slides: ParsedSlide[] = [];
  for (let i = 0; i < order.length; i++) {
    const t = order[i].target;
    if (!t || !zip.file(t)) continue;
    const s = await parseSlide(zip, t, i + 1, height);
    s.section = sectionOf.get(order[i].id) || undefined;
    slides.push(s);
    onProgress?.((i + 1) / order.length);
  }
  if (!slides.length) throw new Error("This presentation has no slides.");
  return { slides, hasSections: sectionOf.size > 0 };
}
