import PptxGenJS from "pptxgenjs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ID, ImageView, SlideDesign, SlideElement, Tag, User } from "../api/contract";
import { AnnotationLayer } from "../components/AnnotationLayer";
import { chartData, num } from "./chartData";
import { formatDay } from "./dates";
import { docText, type PMNode } from "./prosemirror";
import type { Slide } from "./slides";
import type { Theme } from "./themes";

// Export what Present shows as a real .pptx (slides step 4). Designed slides map element by
// element; automatic slides are laid out like Present's, in their theme. Text stays editable text,
// with its formatting; pictures carry their annotations; presenter notes come along.
// Loaded on demand (PptxGenJS is large), only when someone downloads.

type Run = PptxGenJS.TextProps;
type Opts = NonNullable<Run["options"]>;
const PT_PER_IN = 72;
const HEX = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i;
const inch = (pt: number) => pt / PT_PER_IN;

/** "#rrggbb" or "#rrggbbaa" → PptxGenJS color (no "#") and transparency (0-100). */
function color(c?: string): { color: string; transparency?: number } | undefined {
  const m = c ? HEX.exec(c) : null;
  if (!m) return undefined;
  return { color: m[1].toUpperCase(), ...(m[2] ? { transparency: Math.round(100 - (parseInt(m[2], 16) / 255) * 100) } : {}) };
}

// ---- rich text ----

function marksToOptions(n: PMNode, base: Opts, scale: number): Opts {
  const o: Opts = { ...base };
  for (const m of n.marks ?? []) {
    if (m.type === "bold") o.bold = true;
    else if (m.type === "italic") o.italic = true;
    else if (m.type === "underline") o.underline = { style: "sng" };
    else if (m.type === "strike") o.strike = "sngStrike";
    else if (m.type === "code") o.fontFace = "Courier New";
    else if (m.type === "link" && typeof m.attrs?.href === "string") o.hyperlink = { url: m.attrs.href };
    else if (m.type === "highlight" && color(m.attrs?.color as string)) o.highlight = color(m.attrs!.color as string)!.color;
    else if (m.type === "textStyle") {
      const c = color(m.attrs?.color as string);
      if (c) o.color = c.color;
      const size = /^(\d+(\.\d+)?)px$/.exec(String(m.attrs?.fontSize ?? ""));
      if (size) o.fontSize = Number(size[1]) * scale; // 1 px = 1 pt on a slide
      if (typeof m.attrs?.fontFamily === "string") o.fontFace = m.attrs.fontFamily;
    }
  }
  return o;
}

/** A ProseMirror doc (no tables) → PptxGenJS text runs, one paragraph per breakLine. */
function docToRuns(doc: unknown, base: Opts, headingFace?: string, headingColor?: string, scale = 1): Run[] {
  const runs: Run[] = [];
  const para = (inline: PMNode[], pOpts: Opts) => {
    const start = runs.length;
    for (const n of inline) {
      if (n.type === "text" && n.text) runs.push({ text: n.text, options: marksToOptions(n, pOpts, scale) });
      else if (n.type === "hardBreak") runs.push({ text: "", options: { ...pOpts, breakLine: true } });
      else if (n.type === "mention") runs.push({ text: `@${String(n.attrs?.label ?? "")}`, options: pOpts });
    }
    if (runs.length === start) runs.push({ text: "", options: pOpts }); // keep empty lines
    const last = runs[runs.length - 1];
    last.options = { ...last.options, breakLine: true };
    // Paragraph-level options belong on the paragraph's first run.
    runs[start].options = { ...pOpts, ...runs[start].options };
  };
  const align = (n: PMNode): Opts => {
    const a = n.attrs?.textAlign;
    return a === "center" || a === "right" || a === "justify" ? { align: a } : {};
  };
  const walk = (nodes: PMNode[], level: number, list?: { ordered: boolean; start: number }) => {
    for (const n of nodes) {
      if (n.type === "paragraph") para(n.content ?? [], { ...base, ...align(n), ...(list ? { bullet: list.ordered ? { type: "number", numberStartAt: list.start } : true, indentLevel: level } : {}) });
      else if (n.type === "heading")
        para(n.content ?? [], { ...base, ...align(n), bold: true, fontSize: (base.fontSize ?? 18) * (n.attrs?.level === 2 ? 1.3 : 1.15), ...(headingFace ? { fontFace: headingFace } : {}), ...(headingColor ? { color: headingColor } : {}) });
      else if (n.type === "bulletList" || n.type === "orderedList") {
        const items = n.content ?? [];
        items.forEach((li, i) => walk(li.content ?? [], list ? level + 1 : level, { ordered: n.type === "orderedList", start: Number(n.attrs?.start ?? 1) + i }));
      } else if (n.type === "blockquote") walk(n.content ?? [], level, list);
      else if (n.type === "codeBlock") para([{ type: "text", text: docText(n), marks: [{ type: "code" }] }], base);
      else if (n.type === "horizontalRule") para([{ type: "text", text: "—" }], base);
    }
  };
  walk(((doc as PMNode)?.content ?? []) as PMNode[], 0);
  if (runs.length) runs[runs.length - 1].options = { ...runs[runs.length - 1].options, breakLine: false };
  return runs;
}

/** A doc split into text runs and its tables (PowerPoint keeps tables as separate objects). */
function splitDoc(doc: unknown): { text: PMNode[]; tables: PMNode[] } {
  const nodes = ((doc as PMNode)?.content ?? []) as PMNode[];
  return { text: nodes.filter((n) => n.type !== "table"), tables: nodes.filter((n) => n.type === "table") };
}

function tableRows(table: PMNode, base: Opts): PptxGenJS.TableRow[] {
  return (table.content ?? []).map((row) =>
    (row.content ?? []).map((cell) => {
      const fill = color(cell.attrs?.background as string);
      const fg = color(cell.attrs?.color as string);
      const runs = docToRuns({ type: "doc", content: cell.content }, { ...base, ...(fg ? { color: fg.color } : {}), ...(cell.type === "tableHeader" ? { bold: true } : {}) });
      return {
        text: runs,
        options: { ...(fill ? { fill: { color: fill.color } } : {}), ...(Number(cell.attrs?.colspan) > 1 ? { colspan: Number(cell.attrs!.colspan) } : {}), ...(Number(cell.attrs?.rowspan) > 1 ? { rowspan: Number(cell.attrs!.rowspan) } : {}) },
      } as PptxGenJS.TableCell;
    }),
  );
}

function colWidths(table: PMNode): number[] | undefined {
  const cells = table.content?.[0]?.content ?? [];
  const w = cells.flatMap((c) => (Array.isArray(c.attrs?.colwidth) ? (c.attrs!.colwidth as unknown[]).map(Number) : [NaN]));
  return w.length && w.every((x) => Number.isFinite(x) && x > 0) ? w.map(inch) : undefined;
}

// ---- pictures (with their annotations baked in) ----

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Couldn't load ${src}`));
    img.src = src;
  });

async function pictureData(img: ImageView): Promise<string | undefined> {
  const a = img.asset;
  const url = (a.variants.find((v) => v.name === "original") ?? a.variants[a.variants.length - 1])?.url;
  if (!url) return undefined;
  const scale = Math.min(1, 2400 / Math.max(a.width, a.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(a.width * scale));
  canvas.height = Math.max(1, Math.round(a.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return undefined;
  ctx.drawImage(await loadImage(url), 0, 0, canvas.width, canvas.height);
  const shapes = img.annotation?.shapes ?? [];
  if (shapes.length) {
    const svg = renderToStaticMarkup(createElement(AnnotationLayer, { shapes, width: a.width, height: a.height })).replace("<svg", `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}"`);
    const blobUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    try {
      ctx.drawImage(await loadImage(blobUrl), 0, 0, canvas.width, canvas.height);
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  }
  return canvas.toDataURL(a.mime === "image/jpeg" && !shapes.length ? "image/jpeg" : "image/png", 0.92).replace(/^data:/, "");
}

// ---- slides ----

interface Ctx {
  pptx: PptxGenJS;
  W: number; // deck size, points
  H: number;
  pictures: Map<ID, Promise<string | undefined>>;
}

const picture = (ctx: Ctx, img: ImageView) => {
  if (!ctx.pictures.has(img.id)) ctx.pictures.set(img.id, pictureData(img).catch(() => undefined));
  return ctx.pictures.get(img.id)!;
};

async function addDesigned(ctx: Ctx, s: PptxGenJS.Slide, design: SlideDesign, images: Map<ID, ImageView>) {
  // A design of another size is scaled to fit the deck and centered.
  const k = Math.min(ctx.W / design.size.w, ctx.H / design.size.h);
  const ox = (ctx.W - design.size.w * k) / 2;
  const oy = (ctx.H - design.size.h * k) / 2;
  const box = (e: SlideElement) => ({ x: inch(ox + e.x * k), y: inch(oy + e.y * k), w: inch(Math.max(e.w * k, 0.01)), h: inch(Math.max(e.h * k, 0.01)) });
  const bg = color(design.background);
  s.background = { color: bg?.color ?? "FFFFFF" };
  for (const e of design.elements) {
    const pos = { ...box(e), ...(e.rotation ? { rotate: e.rotation } : {}) };
    if (e.kind === "image") {
      const img = images.get(e.imageInstanceId);
      const data = img ? await picture(ctx, img) : undefined;
      if (data) s.addImage({ data, ...pos, sizing: { type: "cover", w: pos.w, h: pos.h }, altText: img?.altText ?? img?.caption ?? "" });
      continue;
    }
    if (e.kind === "chart") {
      // A native PowerPoint chart: editable data, the deck's series colors (else the default palette).
      const d = chartData(e.doc);
      const type = ({ column: "bar", bar: "bar", line: "line", area: "area", pie: "pie", doughnut: "doughnut", scatter: "scatter" } as const satisfies Record<string, PptxGenJS.CHART_NAME>)[e.chartType];
      const series =
        e.chartType === "scatter"
          ? [{ name: "X", values: d.categories.map((c, i) => num(c) ?? i) }, ...d.series.map((x) => ({ name: x.name, values: x.values.map((v) => v ?? 0) }))]
          : d.series.map((x) => ({ name: x.name, labels: d.categories, values: x.values.map((v) => v ?? 0) }));
      const palette = ["2A78D6", "EB6834", "1BAF7A", "EDA100", "E87BA4", "008300", "6250D6", "E34948"];
      s.addChart(type, e.chartType === "pie" || e.chartType === "doughnut" ? series.slice(0, 1) : series, {
        ...pos,
        barDir: e.chartType === "bar" ? "bar" : "col",
        chartColors: (e.chartType === "pie" || e.chartType === "doughnut" ? d.categories : d.series).map((_, i) => color(e.colors?.[i] ?? undefined)?.color ?? palette[i % palette.length]),
        showLegend: d.series.length > 1 || e.chartType === "pie" || e.chartType === "doughnut",
        legendPos: "t",
        ...(d.title ? { showTitle: true, title: d.title, titleFontSize: (e.fontSize ?? 12) * k * 1.15 } : {}),
        catAxisLabelFontSize: (e.fontSize ?? 12) * k,
        valAxisLabelFontSize: (e.fontSize ?? 12) * k,
        legendFontSize: (e.fontSize ?? 12) * k,
      } as PptxGenJS.IChartOpts);
      continue;
    }
    const fill = color(e.fill);
    const line = color(e.line);
    if (e.kind === "shape") {
      const type = { rect: ctx.pptx.ShapeType.rect, roundRect: ctx.pptx.ShapeType.roundRect, ellipse: ctx.pptx.ShapeType.ellipse, triangle: ctx.pptx.ShapeType.triangle, line: ctx.pptx.ShapeType.line, arrow: ctx.pptx.ShapeType.line }[e.shape];
      s.addShape(type, {
        ...pos,
        ...(fill && e.shape !== "line" && e.shape !== "arrow" ? { fill: { color: fill.color, transparency: fill.transparency } } : { fill: { type: "none" } }),
        line: line ? { color: line.color, transparency: line.transparency, width: e.lineWidth ?? 1, ...(e.shape === "arrow" ? { endArrowType: "triangle" } : {}) } : { type: "none" },
        ...(e.flipH ? { flipH: true } : {}),
        ...(e.flipV ? { flipV: true } : {}),
        ...(e.shape === "roundRect" ? { rectRadius: 0.17 } : {}),
      } as PptxGenJS.ShapeProps);
    }
    if (!e.doc) continue;
    const base: Opts = { fontSize: (e.fontSize ?? 18) * k, color: color(e.color)?.color ?? "000000", fontFace: e.role === "title" ? (design.fonts?.heading ?? design.fonts?.body) : design.fonts?.body };
    const { text, tables } = splitDoc(e.doc);
    const runs = docToRuns({ type: "doc", content: text }, base, undefined, undefined, k);
    const valign = e.valign === "middle" ? "middle" : e.valign === "bottom" ? "bottom" : "top";
    if (runs.length && runs.some((r) => r.text)) {
      s.addText(runs, {
        ...pos,
        ...(tables.length ? { h: inch(Math.min(e.h * k, 30)) } : {}),
        valign,
        margin: [3.6, 7.2, 3.6, 7.2],
        ...(e.kind === "text" && fill ? { fill: { color: fill.color, transparency: fill.transparency } } : {}),
        ...(e.kind === "text" && line ? { line: { color: line.color, width: 1 } } : {}),
        fit: "none",
      } as PptxGenJS.TextPropsOptions);
    }
    let y = pos.y + (runs.some((r) => r.text) && tables.length ? inch(30) : 0);
    for (const t of tables) {
      const widths = colWidths(t);
      const border = color(t.attrs?.borderColor as string);
      s.addTable(tableRows(t, { ...base, fontSize: base.fontSize }), { x: pos.x, y, w: widths ? widths.reduce((a, b) => a + b, 0) : pos.w, ...(widths ? { colW: widths } : {}), fontSize: base.fontSize, fontFace: base.fontFace, border: { type: "solid", color: border?.color ?? "9AA1AB", pt: 0.75 } });
      y += inch(((t.content?.length ?? 1) * (base.fontSize ?? 18) * 1.6) + 6);
    }
  }
}

async function addAutomatic(ctx: Ctx, s: PptxGenJS.Slide, slide: Exclude<Slide, { kind: "designed" }>, theme: Theme, people: Map<ID, User>, tags: Map<ID, Tag>) {
  const W = inch(ctx.W);
  const H = inch(ctx.H);
  const c = (x: string) => x.replace("#", "").toUpperCase();
  s.background = { color: c(theme.background) };
  const body = { fontFace: theme.bodyFont, color: c(theme.text) };
  const heading = { fontFace: theme.headingFont ?? theme.bodyFont, color: c(theme.heading), bold: true };
  if (slide.kind === "title") {
    const x = W * 0.08;
    s.addShape(ctx.pptx.ShapeType.rect, { x, y: H * 0.28, w: 0.9, h: 0.06, fill: { color: c(theme.accent) }, line: { type: "none" } });
    const show = slide.show ?? { date: true, author: true, summary: true, tags: true };
    if (show.date) s.addText(formatDay(slide.workDate).toUpperCase(), { x, y: H * 0.31, w: W * 0.84, h: 0.4, fontSize: 14, bold: true, color: c(theme.accent), fontFace: theme.bodyFont, margin: 0 });
    s.addText(slide.title, { x, y: H * 0.38, w: W * 0.84, h: H * 0.25, fontSize: 40, ...heading, valign: "top", margin: 0, fit: "shrink" });
    const byline = [show.author ? people.get(slide.authorId)?.name : undefined, ...(show.tags ? slide.tagIds.map((id) => tags.get(id)?.name) : [])].filter(Boolean).join(" · ");
    const sub = [show.summary ? slide.summary : undefined, byline].filter(Boolean).join("\n");
    if (sub) s.addText(sub, { x, y: H * 0.64, w: W * 0.84, h: H * 0.2, fontSize: 18, ...body, valign: "top", margin: 0 });
  } else {
    const top = slide.heading ? 1.15 : 0.5;
    if (slide.heading) s.addText(slide.heading, { x: 0.5, y: 0.35, w: W - 1, h: 0.7, fontSize: 28, ...heading, valign: "bottom", margin: 0, fit: "shrink" });
    const hasText = slide.text.length > 0;
    const area = { x: 0.5, y: top, w: W - 1, h: H - top - 0.4 };
    let textArea = area;
    if (slide.image) {
      const a = slide.image.asset;
      const maxW = hasText ? area.w * 0.58 : area.w;
      const k = Math.min(maxW / a.width, area.h / a.height);
      const w = a.width * k;
      const h = a.height * k;
      const data = await picture(ctx, slide.image);
      if (data) s.addImage({ data, x: area.x, y: area.y + (area.h - h) / 2, w, h, altText: slide.image.altText ?? "" });
      textArea = { ...area, x: area.x + w + 0.35, w: area.w - w - 0.35 };
    }
    if (hasText) {
      const { text, tables } = splitDoc({ type: "doc", content: slide.text });
      const runs = docToRuns({ type: "doc", content: text }, { fontSize: slide.image ? 16 : 20, ...body, paraSpaceAfter: 6 } as Opts, heading.fontFace, heading.color);
      if (runs.length) s.addText(runs, { ...textArea, h: tables.length ? textArea.h / 2 : textArea.h, valign: slide.image ? "middle" : "top", margin: 0, fit: "shrink" });
      for (const t of tables) s.addTable(tableRows(t, { fontSize: 14, ...body }), { x: textArea.x, y: textArea.y + (runs.length ? textArea.h / 2 : 0), w: textArea.w, fontSize: 14, border: { type: "solid", color: "9AA1AB", pt: 0.75 } });
    }
  }
}

export interface ExportInput {
  fileName: string;
  title: string;
  author?: string;
  slides: { slide: Slide; theme: Theme }[];
  people: Map<ID, User>;
  tags: Map<ID, Tag>;
}

/** Build the deck and hand it to the browser as a download. */
export async function exportPptx({ fileName, title, author, slides, people, tags }: ExportInput): Promise<void> {
  const pptx = new PptxGenJS();
  // The deck takes the size of its designed slides (the most common one), else 16:9.
  const sizes = new Map<string, number>();
  for (const { slide } of slides) if (slide.kind === "designed") sizes.set(`${slide.design.size.w}x${slide.design.size.h}`, (sizes.get(`${slide.design.size.w}x${slide.design.size.h}`) ?? 0) + 1);
  const [W, H] = ([...sizes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "960x540").split("x").map(Number);
  pptx.defineLayout({ name: "TAL", width: inch(W), height: inch(H) });
  pptx.layout = "TAL";
  pptx.title = title;
  if (author) pptx.author = author;
  const ctx: Ctx = { pptx, W, H, pictures: new Map() };
  for (const { slide, theme } of slides) {
    const s = pptx.addSlide();
    if (slide.kind === "designed") await addDesigned(ctx, s, slide.design, slide.images);
    else await addAutomatic(ctx, s, slide, theme, people, tags);
    if (slide.notes) s.addNotes(slide.notes);
  }
  await pptx.writeFile({ fileName: fileName.replace(/[\\/:*?"<>|]+/g, " ").trim().replace(/(\.pptx)?$/i, ".pptx"), compression: true });
}
