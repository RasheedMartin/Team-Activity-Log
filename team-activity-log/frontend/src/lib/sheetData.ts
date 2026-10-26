import type { SheetCell, SheetColumn } from "../api/contract";

// Sheets in the browser: a tab's rows arrive once (up to 50,000), then sorting, filtering, and
// column stats run here. Rows are positional: column "c3" is index 3.

export const colIndex = (key: string) => Number(key.slice(1));

export type Sort = { key: string; dir: "asc" | "desc" } | null;

const cmp = (a: SheetCell, b: SheetCell) => {
  if (a === null) return b === null ? 0 : 1; // empties last either way
  if (b === null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
};

/** Row indexes (into `rows`) that contain `q` in any cell, ordered by `sort`. */
export function view(rows: SheetCell[][], q: string, sort: Sort): number[] {
  const needle = q.trim().toLowerCase();
  let idx = rows.map((_, i) => i);
  if (needle) idx = idx.filter((i) => rows[i].some((v) => v !== null && String(v).toLowerCase().includes(needle)));
  if (sort) {
    const c = colIndex(sort.key);
    const sign = sort.dir === "asc" ? 1 : -1;
    idx.sort((x, y) => {
      const a = rows[x][c];
      const b = rows[y][c];
      if (a === null || b === null) return cmp(a, b); // empties stay last when descending too
      return sign * cmp(a, b) || x - y;
    });
  }
  return idx;
}

export interface ColumnStats {
  filled: number;
  empty: number;
  distinct: number;
  min?: SheetCell;
  max?: SheetCell;
  sum?: number;
  avg?: number;
  top?: { value: string; count: number }[];
}

export function columnStats(rows: SheetCell[][], col: SheetColumn, only?: number[]): ColumnStats {
  const c = colIndex(col.key);
  const values = (only ?? rows.map((_, i) => i)).map((i) => rows[i][c]);
  const present = values.filter((v): v is number | string => v !== null && v !== "");
  const counts = new Map<string, number>();
  for (const v of present) counts.set(String(v), (counts.get(String(v)) ?? 0) + 1);
  const s: ColumnStats = { filled: present.length, empty: values.length - present.length, distinct: counts.size };
  if (!present.length) return s;
  if (col.type === "number" || col.type === "date") {
    const sorted = [...present].sort(cmp);
    s.min = sorted[0];
    s.max = sorted[sorted.length - 1];
  }
  if (col.type === "number") {
    s.sum = (present as number[]).reduce((a, b) => a + b, 0);
    s.avg = s.sum / present.length;
  }
  if (col.type === "category" || col.type === "text") {
    s.top = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([value, count]) => ({ value, count }));
  }
  return s;
}

const NUM = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
export const fmtCell = (v: SheetCell | undefined, type?: SheetColumn["type"]) => (v === null || v === undefined ? "" : type === "number" && typeof v === "number" ? NUM.format(v) : String(v));
