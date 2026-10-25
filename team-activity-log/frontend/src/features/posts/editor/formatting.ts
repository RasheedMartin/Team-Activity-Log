import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { Color, FontFamily, FontSize, TextStyle } from "@tiptap/extension-text-style";

// Text color, highlight, and alignment (§C1). Stored as plain hex on the textStyle/highlight marks
// and textAlign on paragraphs/headings — the backend sanitizer accepts nothing else. Colors render
// through CSS variables (--tc, --hl) so prose styles can keep them readable in dark mode.

const HEX = /^#[0-9a-f]{6}$/i;

/** "#abc", "#aabbcc" or "rgb(…)" (pasted HTML) → "#aabbcc"; anything else → null. */
export function toHex(v: string | null | undefined): string | null {
  const s = (v ?? "").trim().toLowerCase();
  if (HEX.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${[...s.slice(1)].map((c) => c + c).join("")}`;
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(s);
  return m ? `#${m.slice(1, 4).map((n) => Math.min(255, +n).toString(16).padStart(2, "0")).join("")}` : null;
}

const TextColor = Color.extend({
  addGlobalAttributes() {
    return [
      {
        types: ["textStyle"],
        attributes: {
          color: {
            default: null,
            parseHTML: (el) => toHex(el.style.getPropertyValue("--tc") || el.style.color),
            renderHTML: (a) => (a.color ? { "data-tc": "", style: `--tc: ${a.color}` } : {}),
          },
        },
      },
    ];
  },
});

const HighlightColor = Highlight.extend({
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (el) => toHex(el.getAttribute("data-color") || el.style.backgroundColor),
        renderHTML: (a) => (a.color ? { "data-hl": "", "data-color": a.color, style: `--hl: ${a.color}` } : { "data-hl": "" }),
      },
    };
  },
}).configure({ multicolor: true });

/** A hex attribute kept on a node and shown as a style (cell fills, cell text color, table borders). */
const hexAttr = (name: string, css: (v: string) => string) => ({
  default: null,
  parseHTML: (el: HTMLElement) => toHex(el.getAttribute(`data-${name}`)),
  renderHTML: (a: Record<string, unknown>) => (typeof a[name] === "string" && HEX.test(a[name] as string) ? { [`data-${name}`]: a[name], style: css(a[name] as string) } : {}),
});
const cellAttrs = { background: hexAttr("background", (v) => `background: ${v}`), color: hexAttr("color", (v) => `color: ${v}`) };

/** Tables that keep imported styling (column widths come with TipTap's cells). */
export const tableExtensions = [
  Table.extend({ addAttributes: () => ({ borderColor: hexAttr("borderColor", (v) => `--tb: ${v}`) }) }).configure({ resizable: false }),
  TableRow,
  TableHeader.extend({ addAttributes() { return { ...this.parent?.(), ...cellAttrs }; } }),
  TableCell.extend({ addAttributes() { return { ...this.parent?.(), ...cellAttrs }; } }),
]; // prettier-ignore

/** What designed-slide text adds: per-run sizes and typefaces from the deck. */
export const slideTextExtensions = [FontSize, FontFamily];

export const formattingExtensions = [TextStyle, TextColor, HighlightColor, TextAlign.configure({ types: ["heading", "paragraph"] })];

// Mid-tone text colors read on both themes (dark mode lightens them; see proseSx).
export const TEXT_COLORS = [
  { name: "Red", value: "#c62828" },
  { name: "Orange", value: "#d84315" },
  { name: "Amber", value: "#b26a00" },
  { name: "Green", value: "#2e7d32" },
  { name: "Teal", value: "#00796b" },
  { name: "Blue", value: "#1565c0" },
  { name: "Purple", value: "#6a1b9a" },
  { name: "Gray", value: "#616161" },
];
export const HIGHLIGHTS = [
  { name: "Yellow", value: "#fff176" },
  { name: "Green", value: "#c5e1a5" },
  { name: "Blue", value: "#bbdefb" },
  { name: "Pink", value: "#f8bbd0" },
  { name: "Orange", value: "#ffe0b2" },
];
