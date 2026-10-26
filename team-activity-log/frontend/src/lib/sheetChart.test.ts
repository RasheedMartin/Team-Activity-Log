import { describe, expect, it } from "vitest";
import type { SheetColumn } from "../api/contract";
import { defaultSpec, sheetChartData } from "./sheetChart";

const cols: SheetColumn[] = [
  { key: "c0", name: "Date", type: "date" },
  { key: "c1", name: "Channel", type: "category" },
  { key: "c2", name: "Gain", type: "number" },
];
const rows = [
  ["2026-03-02", "A", 2],
  ["2026-03-01", "A", 1],
  ["2026-03-01", "B", 3],
  ["2026-03-02", "B", null],
];

describe("sheet charts", () => {
  it("plots rows as they are, in X order", () => {
    const { data } = sheetChartData(rows, cols, { type: "line", x: "c0", y: ["c2"], agg: "none" });
    expect(data.categories).toEqual(["2026-03-01", "2026-03-01", "2026-03-02", "2026-03-02"]);
    expect(data.series).toEqual([{ name: "Gain", values: [1, 3, 2, null] }]);
  });

  it("summarizes rows with the same X", () => {
    const sum = sheetChartData(rows, cols, { type: "column", x: "c0", y: ["c2"], agg: "sum" }).data;
    expect(sum.categories).toEqual(["2026-03-01", "2026-03-02"]);
    expect(sum.series).toEqual([{ name: "Total Gain", values: [4, 2] }]);
    const count = sheetChartData(rows, cols, { type: "column", x: "c1", y: [], agg: "count" }).data;
    expect(count.series).toEqual([{ name: "Count", values: [2, 2] }]);
  });

  it("splits into a series per value, folding the rest into Other", () => {
    const { data } = sheetChartData(rows, cols, { type: "line", x: "c0", y: ["c2"], agg: "avg", groupBy: "c1" });
    expect(data.series).toEqual([
      { name: "A", values: [1, 2] },
      { name: "B", values: [3, null] },
    ]);
    const many = Array.from({ length: 10 }, (_, i) => ["2026-03-01", `ch${i}`, i]);
    const r = sheetChartData(many, cols, { type: "column", x: "c0", y: ["c2"], agg: "sum", groupBy: "c1" });
    expect(r.data.series).toHaveLength(8);
    expect(r.data.series[7].name).toBe("Other");
    expect(r.note).toMatch(/smallest 3 are combined as Other/);
  });

  it("starts from a sensible spec", () => {
    expect(defaultSpec(cols)).toEqual({ type: "line", x: "c0", y: ["c2"], agg: "none" });
    expect(defaultSpec([{ key: "c0", name: "Name", type: "category" }])).toEqual({ type: "column", x: "c0", y: [], agg: "count" });
  });
});
