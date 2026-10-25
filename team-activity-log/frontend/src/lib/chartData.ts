import { docText, type PMNode } from "./prosemirror";

// A chart element's data lives in its doc as a table: the header row names the series, the first
// column names the categories (contract.ts, kind "chart"). Read by the renderer and the exporter.

export interface ChartData {
  title: string;
  categories: string[];
  series: { name: string; values: (number | null)[] }[];
}

const cellText = (c: PMNode) => docText({ type: "doc", content: c.content ?? [] }).trim();
export const num = (s: string) => {
  const v = Number(s.replace(/[,\s%$€£]/g, ""));
  return s.trim() && Number.isFinite(v) ? v : null;
};

export function chartData(doc: unknown): ChartData {
  const nodes = ((doc as PMNode)?.content ?? []) as PMNode[];
  const table = nodes.find((n) => n.type === "table");
  const title = nodes
    .filter((n) => n.type !== "table")
    .map((n) => docText({ type: "doc", content: [n] }))
    .join(" ")
    .trim();
  const rows = (table?.content ?? []).map((r) => (r.content ?? []).map(cellText));
  const [head = [], ...body] = rows;
  return {
    title,
    categories: body.map((r) => r[0] ?? ""),
    series: head.slice(1).map((name, i) => ({ name: name || `Series ${i + 1}`, values: body.map((r) => num(r[i + 1] ?? "")) })),
  };
}

