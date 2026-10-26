import type { SheetCell, SheetChartSpec, SheetColumn } from "../api/contract";
import type { ChartData } from "./chartData";
import { colIndex } from "./sheetData";

// A saved chart is a spec over a tab ({type, x, y, agg, groupBy}); the picture is computed here
// from the tab's rows each time, so a chart in a post always matches its sheet.
//
// agg "none" plots rows as they are (sorted by X when X is a number or date). Any other agg makes
// one point per distinct X value, summarizing Y; groupBy splits Y into one series per value.

export const MAX_POINTS = 5000;
const MAX_GROUPS = 8;
const AGG_NAME: Record<SheetChartSpec["agg"], string> = { sum: "Total", avg: "Average", count: "Count", min: "Min", max: "Max", none: "" };

const sortable = (c?: SheetColumn) => c?.type === "number" || c?.type === "date";
const byValue = (a: SheetCell, b: SheetCell) => (typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true }));

function summarize(values: number[], agg: SheetChartSpec["agg"]): number | null {
  if (agg === "count") return values.length;
  if (!values.length) return null;
  if (agg === "sum") return values.reduce((a, b) => a + b, 0);
  if (agg === "avg") return values.reduce((a, b) => a + b, 0) / values.length;
  if (agg === "min") return Math.min(...values);
  if (agg === "max") return Math.max(...values);
  return values[0];
}

export interface SheetChartResult {
  data: ChartData;
  /** Said under the chart when not every row could be drawn. */
  note?: string;
}

export function sheetChartData(rows: SheetCell[][], columns: SheetColumn[], spec: SheetChartSpec, title = ""): SheetChartResult {
  const col = (k?: string) => columns.find((c) => c.key === k);
  const xc = col(spec.x);
  const xi = colIndex(spec.x);
  const ys = spec.y.filter((k) => col(k));
  const yName = (k: string) => (spec.agg === "none" ? col(k)!.name : `${AGG_NAME[spec.agg]} ${col(k)!.name}`);
  const usable = rows.filter((r) => r[xi] !== null && r[xi] !== "");

  if (spec.agg === "none") {
    const ordered = sortable(xc) ? [...usable].sort((a, b) => byValue(a[xi], b[xi])) : usable;
    const shown = ordered.slice(0, MAX_POINTS);
    return {
      data: { title, categories: shown.map((r) => String(r[xi])), series: ys.map((k) => ({ name: col(k)!.name, values: shown.map((r) => (typeof r[colIndex(k)] === "number" ? (r[colIndex(k)] as number) : null)) })) },
      note: ordered.length > MAX_POINTS ? `Showing the first ${MAX_POINTS.toLocaleString()} of ${ordered.length.toLocaleString()} rows. Summarize to see them all.` : undefined,
    };
  }

  // One point per distinct X: in X order for numbers and dates, else by first appearance.
  const keys: string[] = [];
  const firstOf = new Map<string, SheetCell>();
  for (const r of usable) {
    const k = String(r[xi]);
    if (!firstOf.has(k)) {
      firstOf.set(k, r[xi]);
      keys.push(k);
    }
  }
  if (sortable(xc)) keys.sort((a, b) => byValue(firstOf.get(a)!, firstOf.get(b)!));
  const at = new Map(keys.map((k, i) => [k, i]));
  const measure = (r: SheetCell[], k?: string) => (k === undefined ? 1 : typeof r[colIndex(k)] === "number" ? (r[colIndex(k)] as number) : null);

  let series: { name: string; pick: (r: SheetCell[]) => boolean; key?: string }[];
  let note: string | undefined;
  const gc = col(spec.groupBy);
  if (gc) {
    const gi = colIndex(gc.key);
    const counts = new Map<string, number>();
    for (const r of usable) if (r[gi] !== null) counts.set(String(r[gi]), (counts.get(String(r[gi])) ?? 0) + 1);
    const ranked = [...counts].sort((a, b) => b[1] - a[1]).map(([v]) => v);
    const top = ranked.slice(0, ranked.length > MAX_GROUPS ? MAX_GROUPS - 1 : MAX_GROUPS);
    const topSet = new Set(top);
    const key = ys[0];
    series = top.map((v) => ({ name: v, key, pick: (r) => String(r[gi]) === v }));
    if (ranked.length > top.length) {
      series.push({ name: "Other", key, pick: (r) => r[gi] !== null && !topSet.has(String(r[gi])) });
      note = `${gc.name} has ${ranked.length} values; the smallest ${ranked.length - top.length} are combined as Other.`;
    }
  } else if (ys.length) series = ys.map((k) => ({ name: yName(k), key: k, pick: () => true }));
  else series = [{ name: "Count", pick: () => true }];

  const buckets = series.map(() => keys.map(() => [] as number[]));
  for (const r of usable) {
    const i = at.get(String(r[xi]))!;
    series.forEach((s, si) => {
      if (!s.pick(r)) return;
      const v = spec.agg === "count" ? 1 : measure(r, s.key);
      if (v !== null) buckets[si][i].push(v);
    });
  }
  const shown = keys.slice(0, MAX_POINTS);
  if (keys.length > MAX_POINTS) note = `Showing the first ${MAX_POINTS.toLocaleString()} of ${keys.length.toLocaleString()} ${xc?.name ?? "X"} values.`;
  return {
    data: { title, categories: shown, series: series.map((s, si) => ({ name: s.name, values: shown.map((_, i) => (spec.agg === "count" ? buckets[si][i].length || null : summarize(buckets[si][i], spec.agg))) })) },
    note,
  };
}

/** A starting spec for a tab: first date/category column as X, first number column as Y. */
export function defaultSpec(columns: SheetColumn[]): SheetChartSpec | null {
  const x = columns.find((c) => c.type === "date") ?? columns.find((c) => c.type === "category") ?? columns[0];
  const y = columns.find((c) => c.type === "number" && c.key !== x?.key);
  if (!x) return null;
  if (!y) return { type: "column", x: x.key, y: [], agg: "count" };
  return { type: x.type === "date" || x.type === "number" ? "line" : "column", x: x.key, y: [y.key], agg: x.type === "category" ? "sum" : "none" };
}
