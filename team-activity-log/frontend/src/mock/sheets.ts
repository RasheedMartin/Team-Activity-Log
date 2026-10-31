import JSZip from "jszip";
import type { SheetColumn } from "../api/contract";

// Mirrors backend/src/tal/sheets.py: an .xlsx or .csv becomes one typed table per tab (number,
// date, category, text). Values only; dates as YYYY-MM-DD. Same limits and the same type rules,
// so the mock and the real import agree.

export const MAX_ROWS = 50_000;
const MAX_COLS = 200;
const MAX_TABS = 30;
const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

export type Cell = number | string | null;
export interface ParsedTab {
  name: string;
  columns: SheetColumn[];
  rows: Cell[][];
  truncated: boolean;
}

export class SheetError extends Error {}

const xml = (s: string) => new DOMParser().parseFromString(s, "application/xml");
const els = (el: Element | Document, tag: string) => Array.from(el.getElementsByTagNameNS(NS, tag));

function colIndex(ref: string) {
  const letters = /^[A-Z]+/.exec(ref ?? "")?.[0] ?? "";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function dateStyles(doc: Document | null): Set<number> {
  const out = new Set<number>();
  if (!doc) return out;
  const custom = new Map<number, string>();
  for (const f of els(doc, "numFmt")) custom.set(Number(f.getAttribute("numFmtId") ?? 0), f.getAttribute("formatCode") ?? "");
  const xfs = els(doc, "cellXfs")[0];
  els(xfs ?? doc.createElement("x"), "xf").forEach((xf, i) => {
    const fid = Number(xf.getAttribute("numFmtId") ?? 0);
    const code = (custom.get(fid) ?? "").replace(/"[^"]*"|\[[^\]]*\]/g, "").toLowerCase();
    if ((fid >= 14 && fid <= 22) || (fid >= 45 && fid <= 47) || (custom.has(fid) && /[dy]/.test(code) && !/h/.test(code.replace(/mm/g, "")))) out.add(i);
  });
  return out;
}

async function readXlsx(blob: Blob | Uint8Array): Promise<[string, Cell[][]][]> {
  let z: JSZip;
  let wb: Document;
  try {
    z = await JSZip.loadAsync(blob);
    wb = xml(await z.file("xl/workbook.xml")!.async("string"));
  } catch {
    throw new SheetError("This isn't a valid .xlsx file");
  }
  const rels: Record<string, string> = {};
  const rf = z.file("xl/_rels/workbook.xml.rels");
  if (rf) for (const r of Array.from(xml(await rf.async("string")).getElementsByTagName("Relationship"))) rels[r.getAttribute("Id") ?? ""] = r.getAttribute("Target") ?? "";
  const shared: string[] = [];
  const sf = z.file("xl/sharedStrings.xml");
  if (sf) for (const si of els(xml(await sf.async("string")), "si")) shared.push(els(si, "t").map((t) => t.textContent ?? "").join(""));
  const st = z.file("xl/styles.xml");
  const dates = dateStyles(st ? xml(await st.async("string")) : null);
  const out: [string, Cell[][]][] = [];
  for (const sh of els(wb, "sheet")) {
    const target = rels[sh.getAttributeNS(REL, "id") ?? ""] ?? "";
    const f = z.file("xl/" + target.replace(/^\//, "").replace(/^xl\//, ""));
    if (!f) continue;
    const grid: Cell[][] = [];
    for (const row of els(xml(await f.async("string")), "row")) {
      const r: Cell[] = [];
      for (const c of els(row, "c")) {
        const i = colIndex(c.getAttribute("r") ?? "");
        if (i < 0 || i >= MAX_COLS) continue;
        const v = els(c, "v")[0]?.textContent ?? null;
        const t = c.getAttribute("t");
        let val: Cell = null;
        if (t === "s" && v && /^\d+$/.test(v)) val = shared[Number(v)] ?? null;
        else if (t === "inlineStr") val = els(c, "t").map((x) => x.textContent ?? "").join("");
        else if (t === "b" && v !== null) val = v === "1" ? "TRUE" : "FALSE";
        else if ((t === "str" || t === "e") && v !== null) val = v;
        else if (v) {
          const num = Number(v);
          if (Number.isNaN(num)) val = v;
          else if (dates.has(Number(c.getAttribute("s") ?? 0)) && num > 0 && num < 2_958_466) val = new Date(EXCEL_EPOCH + Math.floor(num) * 86_400_000).toISOString().slice(0, 10);
          else val = num;
        }
        while (r.length <= i) r.push(null);
        r[i] = val;
      }
      grid.push(r);
      if (grid.length > MAX_ROWS + 1) break;
    }
    out.push([sh.getAttribute("name") || `Sheet ${out.length + 1}`, grid]);
    if (out.length >= MAX_TABS) break;
  }
  return out;
}

/** RFC 4180 rows with the delimiter guessed from the first lines (like csv.Sniffer). */
function readCsv(text: string): [string, Cell[][]][] {
  text = text.replace(/^\uFEFF/, "");
  const head = text.slice(0, 20_000).split(/\r?\n/).slice(0, 20);
  const delim = [",", ";", "\t", "|"].map((d) => ({ d, n: head.map((l) => l.split(d).length - 1) })).filter((x) => x.n[0] > 0).sort((a, b) => new Set(a.n).size - new Set(b.n).size || b.n[0] - a.n[0])[0]?.d ?? ",";
  const rows: Cell[][] = [];
  let row: Cell[] = [];
  let cell = "";
  let quoted = false;
  const endCell = () => {
    if (row.length < MAX_COLS) row.push(cell.trim() || null);
    cell = "";
  };
  for (let i = 0; i < text.length && rows.length <= MAX_ROWS + 1; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && !cell.trim()) quoted = true;
    else if (ch === delim) endCell();
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endCell();
      rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell || row.length) {
    endCell();
    rows.push(row);
  }
  return [["Data", rows]];
}

// ---------------------------------------------------------------- types

const DATE_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})|^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/;

export function asNumber(v: Cell): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const s = v.replace(/,/g, "").trim();
    if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?%?$/.test(s)) return parseFloat(s) / (s.endsWith("%") ? 100 : 1);
  }
  return null;
}

export function asDate(v: Cell): string | null {
  if (typeof v !== "string") return null;
  const m = DATE_RE.exec(v.trim());
  if (!m) return null;
  const [yy, mo, d] = m[1] ? [+m[1], +m[2], +m[3]] : [+m[6], +m[4], +m[5]];
  const y = !m[1] && yy < 100 ? yy + 2000 : yy;
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return t.toISOString().slice(0, 10);
}

export function infer(values: Cell[]): SheetColumn["type"] {
  const present = values.filter((v) => v !== null && v !== "");
  if (!present.length) return "text";
  if (present.every((v) => asNumber(v) !== null)) return "number";
  if (present.every((v) => asDate(v))) return "date";
  if (new Set(present.map(String)).size <= Math.max(12, Math.floor(present.length / 20))) return "category";
  return "text";
}

// ---------------------------------------------------------------- edits (tal/sheets.py: coerce)

export const TYPE_WORD: Partial<Record<SheetColumn["type"], string>> = { number: "a number", date: "a date (like 2026-03-01)" };

/** A cell as text: 4512 reads "4512". */
export function asText(v: Cell | undefined): string | null {
  if (v === null || v === undefined || v === "") return null;
  return String(v).trim() || null;
}

/** [ok, value] for a cell typed into a column of this type; empty is always fine. */
export function coerce(v: Cell | undefined, kind: SheetColumn["type"]): [boolean, Cell] {
  const text = asText(v);
  if (text === null) return [true, null];
  if (kind === "number") {
    const n = asNumber(v ?? null);
    return [n !== null, n];
  }
  if (kind === "date") {
    const d = asDate(text);
    return [d !== null, d];
  }
  return [true, text];
}

function table(name: string, grid: Cell[][]): ParsedTab | null {
  grid = grid.filter((r) => r.some((v) => v !== null && v !== ""));
  if (!grid.length) return null;
  const width = Math.max(...grid.map((r) => r.length));
  let header: Cell[] = grid[0];
  let body = grid.slice(1);
  // A first row of all-text above data that isn't all text is a header; else make names up.
  const isData = (v: Cell) => v !== null && (asNumber(v) !== null || asDate(v) !== null);
  const labels = header.filter((h) => h !== null && h !== "");
  if (!(labels.length && !labels.some(isData) && body.slice(0, 20).some((r) => r.some(isData)))) {
    header = Array(width).fill(null);
    body = grid;
  }
  const seen = new Set<string>();
  const names: string[] = [];
  for (let i = 0; i < width; i++) {
    let n = (header[i] !== null && header[i] !== undefined && header[i] !== "" ? String(header[i]).trim() : "") || `Column ${i + 1}`;
    const base = n;
    for (let k = 2; seen.has(n.toLowerCase()); k++) n = `${base} (${k})`;
    seen.add(n.toLowerCase());
    names.push(n);
  }
  let rows = body.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? null));
  const t: ParsedTab = { name, columns: [], rows: [], truncated: rows.length > MAX_ROWS };
  rows = rows.slice(0, MAX_ROWS);
  names.forEach((n, i) => {
    const kind = infer(rows.map((r) => r[i]));
    t.columns.push({ key: `c${i}`, name: n, type: kind });
    for (const r of rows) {
      const v = r[i];
      r[i] = kind === "number" ? asNumber(v) : kind === "date" ? asDate(v) : v === null ? null : String(v);
    }
  });
  t.rows = rows;
  return t;
}

/** `input` is the file (tests pass raw bytes: jsdom's Blob can't be read). */
export async function parseSheet(input: Blob | Uint8Array, filename: string): Promise<ParsedTab[]> {
  const ext = filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : "";
  let raw: [string, Cell[][]][];
  if (ext === "xlsx") raw = await readXlsx(input);
  else if (["csv", "tsv", "txt"].includes(ext)) raw = readCsv("text" in input ? await input.text() : new TextDecoder().decode(input));
  else throw new SheetError("Choose an Excel (.xlsx) or CSV file");
  const tabs = raw.map(([n, g]) => table(n, g)).filter((t): t is ParsedTab => !!t);
  if (!tabs.length) throw new SheetError("No data found in this file");
  return tabs;
}

/** Tab and column names plus distinct cell text, for search. */
export function searchText(tabs: ParsedTab[], limit = 500_000) {
  const parts: string[] = [];
  for (const t of tabs) {
    parts.push(t.name, ...t.columns.map((c) => c.name));
    const seen = new Set<string>();
    for (const r of t.rows) for (const v of r) if (typeof v === "string" && !seen.has(v)) {
          seen.add(v);
          parts.push(v);
        }
  }
  return parts.join("\n").slice(0, limit);
}
