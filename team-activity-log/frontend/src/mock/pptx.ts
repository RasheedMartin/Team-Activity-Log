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
  /** The slide as designed (SlideDesign; image elements carry { image: index into designImages }). */
  design?: Record<string, unknown> & { elements: (Record<string, unknown> & { kind: string })[] };
  designImages: ParsedImage[];
  rich: boolean; // layout carries meaning (pictures, shapes, columns): keep it designed in "auto"
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
  // The master's color map says which scheme colors text and background use (dark themes swap them).
  const mf = master ? zip.file(master) : null;
  const cmap = mf ? first(xml(await mf.async("string")), "p:clrMap") : undefined;
  const pairs = cmap ? Array.from(cmap.attributes).map((a) => [a.name, a.value]) : Object.entries(SCHEME_ALIAS);
  for (const [k, v] of pairs) if (v in out) out[k] = out[v];
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
      base = theme[v] ?? theme[SCHEME_ALIAS[v] ?? v] ?? "";
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
  keepColors?: boolean; // designed slides keep every color; flowing text only clear ones
  headings?: boolean; // large text / subtitles become headings (flowing text only; default true)
  baseSize?: number; // a designed text box's size: runs that differ keep theirs
  fontScale?: number; // normAutofit shrink
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
        const style: Record<string, string> = {};
        const fg = color(children(pr, "a:solidFill")[0], ctx.theme);
        if (fg && (ctx.keepColors || distinct(fg))) style.color = fg;
        const sz = pr.getAttribute("sz") ?? "";
        if (ctx.baseSize && /^\d+$/.test(sz) && Math.abs(+sz / 100 - ctx.baseSize) >= 0.5) style.fontSize = `${Math.round((+sz / 100) * (ctx.fontScale ?? 1) * 10) / 10}px`; // 1 px = 1 pt on a slide
        if (Object.keys(style).length) marks.push({ type: "textStyle", attrs: style });
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
      const heading = ctx.headings !== false && (subtitle || (large(p) && plain(content).length <= 120));
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

// ---- designed slides ----
//
// The same slide as positioned elements (contract.ts SlideDesign), in points (1 pt = 12700 EMU).
// Shapes come from the master and layout (template art, unless showMasterSp="0"), then the slide.
// Placeholders inherit position, anchor, font size and color from the layout, then the master,
// then the master's text styles. Groups map child coordinates through chOff/chExt.

const EMU_PER_PT = 12_700;
const PRESET: Record<string, string> = { rect: "rect", roundRect: "roundRect", snipRoundRect: "roundRect", ellipse: "ellipse", triangle: "triangle", line: "line", straightConnector1: "line" };
const ANCHOR: Record<string, string> = { ctr: "middle", b: "bottom", t: "top" };
// Where PowerPoint's default template puts placeholders (fractions of the slide), used when neither
// the slide, its layout, nor its master says.
const DEFAULT_BOX: Record<string, [number, number, number, number]> = {
  title: [0.069, 0.053, 0.862, 0.193],
  ctrTitle: [0.125, 0.164, 0.75, 0.349],
  subTitle: [0.125, 0.526, 0.75, 0.242],
  body: [0.069, 0.266, 0.862, 0.635],
};
const STYLE_FOR: Record<string, string> = { title: "titleStyle", ctrTitle: "titleStyle", body: "bodyStyle", obj: "bodyStyle", subTitle: "bodyStyle" };

/** Direct child by local name, any namespace (slides use p:, SmartArt drawings dsp:). */
const kid = (el: Element | undefined | null, name: string) => (el ? Array.from(el.children).find((c) => c.localName === name) : undefined);
const pt = (v: number) => Math.round((v / EMU_PER_PT) * 100) / 100;
const round1 = (v: number) => Math.round(v * 10) / 10;
const digits = (v: string | null | undefined) => /^\d+$/.test(v ?? "");

type Box = [number, number, number, number];
/** Maps a group's child coordinates (EMU) to slide coordinates. */
class Xf {
  readonly ox: number;
  readonly oy: number;
  readonly sx: number;
  readonly sy: number;
  constructor(ox = 0, oy = 0, sx = 1, sy = 1) {
    this.ox = ox;
    this.oy = oy;
    this.sx = sx;
    this.sy = sy;
  }
  box(x: number, y: number, w: number, h: number): Box {
    return [this.ox + x * this.sx, this.oy + y * this.sy, w * this.sx, h * this.sy];
  }
}

function xfrmOf(el: Element): Element | undefined {
  if (el.localName === "graphicFrame") return kid(el, "xfrm");
  return kid(kid(el, "spPr") ?? kid(el, "grpSpPr"), "xfrm");
}

function geom(xfrm: Element | undefined): Box | undefined {
  const off = kid(xfrm, "off");
  const ext = kid(xfrm, "ext");
  if (!off || !ext) return undefined;
  const v = [off.getAttribute("x"), off.getAttribute("y"), ext.getAttribute("cx"), ext.getAttribute("cy")];
  return v.every((x) => /^-?\d+$/.test(x ?? "")) ? (v.map(Number) as Box) : undefined;
}

async function themeFonts(zip: JSZip, slidePart: string): Promise<{ heading?: string; body?: string }> {
  const layout = await relOf(zip, slidePart, "slideLayout");
  const master = await relOf(zip, layout, "slideMaster");
  const theme = await relOf(zip, master, "theme");
  const f = theme ? zip.file(theme) : null;
  if (!f) return {};
  const root = xml(await f.async("string"));
  const out: { heading?: string; body?: string } = {};
  for (const [key, tag] of [["heading", "a:majorFont"], ["body", "a:minorFont"]] as const) {
    const font = first(root, tag);
    const name = (font && children(font, "a:latin")[0]?.getAttribute("typeface")) ?? "";
    if (/^[\w .-]{1,64}$/.test(name)) out[key] = name;
  }
  return out;
}

/** [fill, line color, line width pt] from spPr, falling back to the shape's theme style refs. */
function fillOf(sp: Element, theme: Theme): [string | undefined, string | undefined, number | undefined] {
  const pr = kid(sp, "spPr");
  const style = kid(sp, "style");
  let fill: string | undefined;
  let line: string | undefined;
  let width: number | undefined;
  if (pr && !kid(pr, "noFill")) {
    const solid = kid(pr, "solidFill");
    const grad = kid(pr, "gradFill");
    const ref = kid(style, "fillRef");
    if (solid) fill = color(solid, theme);
    else if (grad) fill = color(els(grad, "a:gs")[0], theme);
    else if (ref && (ref.getAttribute("idx") ?? "0") !== "0") fill = color(ref, theme);
  }
  const ln = kid(pr, "ln");
  if (ln && digits(ln.getAttribute("w"))) width = pt(+ln.getAttribute("w")!);
  if (!ln || !kid(ln, "noFill")) {
    const solid = kid(ln, "solidFill");
    const ref = kid(style, "lnRef");
    if (ln && solid) line = color(solid, theme);
    else if (ref && (ref.getAttribute("idx") ?? "0") !== "0") {
      line = color(ref, theme);
      width = width || 0.75;
    }
  }
  return [fill, line, width];
}

/** [font size pt, text color, vertical anchor] for a text shape: its own lstStyle/bodyPr, then the
 *  inherited placeholders' (layout, master), then the master text style. */
function boxStyle(chain: Element[], txstyle: Element | undefined, theme: Theme): [number | undefined, string | undefined, string | undefined] {
  let size: number | undefined;
  let col: string | undefined;
  let anchor: string | undefined;
  for (const sp of chain) {
    const body = kid(sp, "txBody");
    const bpr = kid(body, "bodyPr");
    const a = bpr?.getAttribute("anchor") ?? "";
    if (anchor === undefined && ANCHOR[a]) anchor = ANCHOR[a];
    const dr = kid(kid(kid(body, "lstStyle"), "lvl1pPr"), "defRPr");
    if (dr) {
      if (size === undefined && digits(dr.getAttribute("sz"))) size = +dr.getAttribute("sz")! / 100;
      const solid = kid(dr, "solidFill");
      if (col === undefined && solid) col = color(solid, theme);
    }
  }
  const dr = kid(kid(txstyle, "lvl1pPr"), "defRPr");
  if (dr) {
    if (size === undefined && digits(dr.getAttribute("sz"))) size = +dr.getAttribute("sz")! / 100;
    const solid = kid(dr, "solidFill");
    if (col === undefined && solid) col = color(solid, theme);
  }
  return [size, col, anchor];
}

function dominantSize(body: Element): number | undefined {
  const sizes = new Map<string, number>();
  for (const r of els(body, "a:rPr")) {
    const sz = r.getAttribute("sz");
    if (digits(sz)) sizes.set(sz!, (sizes.get(sz!) ?? 0) + 1);
  }
  if (!sizes.size) return undefined;
  const best = [...sizes.entries()].reduce((a, b) => (b[1] > a[1] || (b[1] === a[1] && +b[0] > +a[0]) ? b : a));
  return +best[0] / 100;
}

type DesignElement = Record<string, unknown> & { kind: string };

/** Builds one slide's SlideDesign. Image elements carry { image: index into `images` }. */
class Designer {
  images: ParsedImage[] = [];
  elements: DesignElement[] = [];
  rich = false; // the slide itself has pictures, shapes, groups, charts, or several text boxes
  private textBoxes = 0;
  private n = 0;
  private layout?: string;
  private master?: string;
  private masterRoot?: Document;
  private inherit: Map<string, Element>[] = [];
  private relsCache = new Map<string, Awaited<ReturnType<typeof rels>>>();

  private zip: JSZip;
  private part: string;
  private w: number;
  private h: number;
  private ctx: Ctx;

  constructor(zip: JSZip, part: string, w: number, h: number, ctx: Ctx) {
    this.zip = zip;
    this.part = part;
    this.w = w;
    this.h = h;
    this.ctx = ctx;
  }

  private async rels(part: string) {
    if (!this.relsCache.has(part)) this.relsCache.set(part, await rels(this.zip, part));
    return this.relsCache.get(part)!;
  }
  private async doc(part?: string) {
    const f = part ? this.zip.file(part) : null;
    return f ? xml(await f.async("string")) : undefined;
  }

  private async placeholders(part?: string) {
    const out = new Map<string, Element>();
    const d = await this.doc(part);
    for (const sp of d ? els(d, "p:sp") : []) {
      const ph = first(sp, "p:ph");
      if (!ph) continue;
      const idx = ph.getAttribute("idx");
      if (idx && !out.has(`idx:${idx}`)) out.set(`idx:${idx}`, sp);
      const t = `type:${ph.getAttribute("type") ?? "body"}`;
      if (!out.has(t)) out.set(t, sp);
    }
    return out;
  }

  private inherited(ph: Element) {
    const keys = [...(ph.getAttribute("idx") ? [`idx:${ph.getAttribute("idx")}`] : []), `type:${ph.getAttribute("type") ?? "body"}`];
    return this.inherit.flatMap((src) => {
      const k = keys.find((x) => src.has(x));
      return k ? [src.get(k)!] : [];
    });
  }

  private id() {
    this.n += 1;
    return `e${this.n}`;
  }

  private boxOf([x, y, w, h]: Box) {
    return { x: pt(x), y: pt(y), w: pt(w), h: pt(h) };
  }

  /** Slide, then layout, then master background: a color, or a picture added as template art. */
  private async background(): Promise<string | undefined> {
    for (const part of [this.part, this.layout, this.master]) {
      const d = await this.doc(part);
      const bg = d ? first(d, "p:bg") : undefined;
      if (!bg) continue;
      const pr = kid(bg, "bgPr");
      const ref = kid(bg, "bgRef");
      if (pr) {
        const solid = kid(pr, "solidFill");
        const grad = kid(pr, "gradFill");
        const blip = first(pr, "a:blip");
        if (solid) return color(solid, this.ctx.theme);
        if (grad) return color(els(grad, "a:gs")[0], this.ctx.theme);
        if (blip) {
          await this.picture(blip.getAttribute("r:embed") ?? "", part!, [0, 0, this.w, this.h], true);
          return undefined;
        }
      }
      if (ref) return color(ref, this.ctx.theme);
    }
    const lt1 = this.ctx.theme.bg1 ?? this.ctx.theme.lt1;
    return lt1 ? `#${lt1.toLowerCase()}` : undefined;
  }

  async build() {
    this.layout = await relOf(this.zip, this.part, "slideLayout");
    this.master = await relOf(this.zip, this.layout, "slideMaster");
    this.masterRoot = await this.doc(this.master);
    this.inherit = [await this.placeholders(this.layout), await this.placeholders(this.master)];
    const background = await this.background();
    const sld = (await this.doc(this.part))!;
    const layoutRoot = await this.doc(this.layout);
    const showMaster = sld.documentElement.getAttribute("showMasterSp") !== "0";
    if (showMaster && this.masterRoot && layoutRoot?.documentElement.getAttribute("showMasterSp") !== "0") await this.walk(first(this.masterRoot, "p:spTree"), this.master, new Xf(), true);
    if (showMaster && layoutRoot) await this.walk(first(layoutRoot, "p:spTree"), this.layout, new Xf(), true);
    await this.walk(first(sld, "p:spTree"), this.part, new Xf(), false);
    this.rich = this.rich || this.textBoxes >= 2;
    return { size: { w: pt(this.w), h: pt(this.h) }, elements: this.elements, ...(background ? { background } : {}) } as Record<string, unknown>;
  }

  private async walk(tree: Element | undefined, part: string | undefined, xf: Xf, template: boolean): Promise<void> {
    if (!tree || !part) return;
    for (const el of Array.from(tree.children)) {
      const kind = el.localName;
      if (kind === "grpSp") {
        const g = geom(xfrmOf(el));
        const ch = xfrmOf(el);
        const choff = kid(ch, "chOff");
        const chext = kid(ch, "chExt");
        let inner = xf;
        if (g && choff && chext) {
          const [x, y, w, h] = xf.box(...g);
          const cw = +(chext.getAttribute("cx") || 0);
          const chh = +(chext.getAttribute("cy") || 0);
          const sx = cw ? w / cw : 1;
          const sy = chh ? h / chh : 1;
          inner = new Xf(x - +(choff.getAttribute("x") ?? 0) * sx, y - +(choff.getAttribute("y") ?? 0) * sy, sx, sy);
        }
        this.rich = this.rich || !template;
        await this.walk(el, part, inner, template);
      } else if (kind === "sp" || kind === "cxnSp") await this.shape(el, part, xf, template);
      else if (kind === "pic") {
        const g = geom(xfrmOf(el));
        const blip = first(el, "a:blip");
        if (g && blip && !first(el, "a:videoFile") && !first(el, "p14:media")) {
          this.rich = this.rich || !template;
          await this.picture(blip.getAttribute("r:embed") ?? "", part, xf.box(...g), template, this.rotation(el));
        }
      } else if (kind === "graphicFrame") await this.frame(el, part, xf, template);
    }
  }

  private rotation(el: Element) {
    const r = xfrmOf(el)?.getAttribute("rot") ?? "";
    return /^-?\d+$/.test(r) && +r ? Math.round((+r / 60000) * 100) / 100 : undefined;
  }

  private async picture(rid: string, part: string, box: Box, decorative: boolean, rot?: number) {
    const target = (await this.rels(part)).find((r) => r.id === rid)?.target;
    const mime = target ? MIME[target.split(".").pop()!.toLowerCase()] : undefined;
    const f = target ? this.zip.file(target) : null;
    if (!target || !mime || !f) return;
    this.images.push({ name: `slide-${target.split("/").pop()}`, blob: new Blob([await f.async("uint8array")], { type: mime }) });
    this.elements.push({ id: this.id(), kind: "image", ...this.boxOf(box), image: this.images.length - 1, ...(rot ? { rotation: rot } : {}), ...(decorative ? { decorative: true } : {}) });
  }

  private async links(part: string) {
    return Object.fromEntries((await this.rels(part)).filter((r) => r.type.endsWith("/hyperlink")).map((r) => [r.id, r.target]));
  }

  private async shape(sp: Element, part: string, xf: Xf, template: boolean) {
    const ph = first(sp, "p:ph");
    const typ = ph ? (ph.getAttribute("type") ?? "body") : undefined;
    if (template && ph) return; // placeholders on the master/layout only define what slides inherit
    if (typ === "sldNum" || typ === "dt" || typ === "ftr") return;
    const chain = [sp, ...(ph ? this.inherited(ph) : [])];
    let g = chain.map((s) => geom(xfrmOf(s))).find(Boolean);
    if (!g && ph) {
      const [fx, fy, fw, fh] = DEFAULT_BOX[typ ?? "body"] ?? DEFAULT_BOX.body;
      g = [Math.trunc(fx * this.w), Math.trunc(fy * this.h), Math.trunc(fw * this.w), Math.trunc(fh * this.h)];
    }
    if (!g) return;
    const body = kid(sp, "txBody");
    const styleName = ph ? (STYLE_FOR[typ ?? ""] ?? "otherStyle") : "otherStyle";
    const txstyle = this.masterRoot ? first(this.masterRoot, `p:${styleName}`) : undefined;
    const [size, col, anchor] = boxStyle(chain, txstyle, this.ctx.theme);
    const fit = kid(kid(body, "bodyPr"), "normAutofit");
    const scale = fit && digits(fit.getAttribute("fontScale")) ? +fit.getAttribute("fontScale")! / 100_000 : 1;
    const base = (body ? dominantSize(body) : undefined) ?? size ?? (typ === "title" || typ === "ctrTitle" ? 40 : 18);
    const ctx: Ctx = { theme: this.ctx.theme, links: await this.links(part), keepColors: true, headings: false, baseSize: base, fontScale: scale };
    const nodes = body ? textBody(body, typ === "body" || typ === "obj", ctx) : [];
    const pg = kid(kid(sp, "spPr"), "prstGeom");
    const prst = pg ? (pg.getAttribute("prst") ?? "rect") : sp.localName === "cxnSp" ? "line" : "rect";
    const [fill, line, lw] = fillOf(sp, this.ctx.theme);
    if (!nodes.length && !fill && !line) return;
    const el: DesignElement = { id: this.id(), kind: "text", ...this.boxOf(xf.box(...g)) };
    const x = xfrmOf(sp);
    const rot = this.rotation(sp);
    if (rot) el.rotation = rot;
    if ((prst === "rect" && !(fill || line)) || (ph && prst === "rect")) {
      el.kind = "text";
      if (fill) el.fill = fill;
      if (line) el.line = line;
    } else {
      let shape = PRESET[prst] ?? "rect";
      const ln = kid(kid(sp, "spPr"), "ln");
      if (shape === "line" && ln && ["tailEnd", "headEnd"].some((t) => kid(ln, t) && (kid(ln, t)!.getAttribute("type") ?? "none") !== "none")) shape = "arrow";
      el.kind = "shape";
      el.shape = shape;
      if (fill && shape !== "line" && shape !== "arrow") el.fill = fill;
      if (line) el.line = line;
      if (lw !== undefined) el.lineWidth = lw;
      for (const f of ["flipH", "flipV"]) if (x?.getAttribute(f) === "1") el[f] = true;
    }
    if (nodes.length) {
      el.doc = { type: "doc", content: nodes };
      el.fontSize = round1(base * scale);
      el.color = col ?? "#000000";
      if (anchor && anchor !== "top") el.valign = anchor;
      if (typ === "title" || typ === "ctrTitle") el.role = "title";
    }
    if (template) el.decorative = true;
    else {
      if (typ !== "title" && typ !== "ctrTitle" && nodes.length) this.textBoxes += 1;
      if (el.kind === "shape" || el.fill || el.line) this.rich = true;
    }
    this.elements.push(el);
  }

  private async frame(el: Element, part: string, xf: Xf, template: boolean) {
    const g = geom(xfrmOf(el));
    if (!g || template) return;
    const box = xf.box(...g);
    const relMap = new Map((await this.rels(part)).map((r) => [r.id, r]));
    const tbl = first(el, "a:tbl");
    let nodes: PMNode[] = [];
    let size = 18;
    const chartRef = first(el, "c:chart");
    const ids = first(el, "dgm:relIds");
    if (tbl) {
      nodes = [table(tbl, { theme: this.ctx.theme, links: await this.links(part), keepColors: true, headings: false })];
      size = dominantSize(tbl) ?? 18;
    } else if (chartRef) {
      const cd = await this.doc(relMap.get(chartRef.getAttribute("r:id") ?? "")?.target);
      nodes = cd ? chartTable(cd) : [];
      size = 12;
    } else if (ids) {
      if (await this.smartArt(ids, part, box)) {
        this.rich = true;
        return;
      }
      const dd = await this.doc(relMap.get(ids.getAttribute("r:dm") ?? "")?.target);
      nodes = dd ? smartArt(dd) : [];
    }
    if (nodes.length) {
      this.rich = true;
      this.elements.push({ id: this.id(), kind: "text", ...this.boxOf(box), doc: { type: "doc", content: nodes }, fontSize: size, color: "#000000" });
    }
  }

  /** SmartArt as drawn: PowerPoint caches the layout in a drawing part (dsp:drawing), linked from
   *  the data part's dataModelExt relId. Shapes there are relative to the frame. */
  private async smartArt(ids: Element, part: string, box: Box) {
    const relMap = new Map((await this.rels(part)).map((r) => [r.id, r]));
    const data = await this.doc(relMap.get(ids.getAttribute("r:dm") ?? "")?.target);
    const ext = data ? Array.from(data.getElementsByTagName("*")).find((e) => e.localName === "dataModelExt") : undefined;
    const drawing = await this.doc(relMap.get(ext?.getAttribute("relId") ?? "")?.target);
    const tree = drawing ? Array.from(drawing.getElementsByTagName("*")).find((e) => e.localName === "spTree") : undefined;
    const before = this.elements.length;
    await this.walk(tree, part, new Xf(box[0], box[1], 1, 1), false);
    return this.elements.length > before;
  }
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

async function parseSlide(zip: JSZip, part: string, n: number, size: [number, number] = [12_192_000, 6_858_000]): Promise<ParsedSlide> {
  const slideHeight = size[1];
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
  const designer = new Designer(zip, part, size[0], size[1], ctx);
  const design = (await designer.build()) as NonNullable<ParsedSlide["design"]>;
  const fonts = await themeFonts(zip, part);
  if (Object.keys(fonts).length) design.fonts = fonts;

  const textAll = `${title}\n${docText({ type: "doc", content })}`.trim();
  return { n, title, isSectionHeader, content, images, notes, text: textAll, date: guessDate(textAll), warnings, parts, design, designImages: designer.images, rich: designer.rich };
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
  const cx = first(pres, "p:sldSz")?.getAttribute("cx") ?? "";
  const cy = first(pres, "p:sldSz")?.getAttribute("cy") ?? "";
  const width = /^\d+$/.test(cx) ? +cx : 12_192_000;
  const height = /^\d+$/.test(cy) ? +cy : 6_858_000;
  const sectionOf = new Map<string, string>();
  for (const sec of els(pres, "p14:section")) for (const sid of els(sec, "p14:sldId")) sectionOf.set(sid.getAttribute("id") ?? "", sec.getAttribute("name") ?? "");
  const slides: ParsedSlide[] = [];
  for (let i = 0; i < order.length; i++) {
    const t = order[i].target;
    if (!t || !zip.file(t)) continue;
    const s = await parseSlide(zip, t, i + 1, [width, height]);
    s.section = sectionOf.get(order[i].id) || undefined;
    slides.push(s);
    onProgress?.((i + 1) / order.length);
  }
  if (!slides.length) throw new Error("This presentation has no slides.");
  return { slides, hasSections: sectionOf.size > 0 };
}
