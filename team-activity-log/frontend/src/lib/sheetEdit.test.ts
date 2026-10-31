import { describe, expect, it } from "vitest";
import { applyRowEdit } from "../api/hooks";
import type { SheetColumn } from "../api/contract";
import { toCsv } from "./csv";

const columns: SheetColumn[] = [
  { key: "c0", name: "Run", type: "number" },
  { key: "c1", name: "Note", type: "text" },
];
const base = { columns, ids: [1, 2, 3], rows: [[1, "a"], [2, "b"], [3, "c"]] };
const result = { rows: [], inserted: [], deleted: [], columns, rowCount: 3, retyped: false };

describe("applying an edit to cached rows", () => {
  it("changes, inserts, and deletes only what the server says", () => {
    const r = applyRowEdit(base, { ...result, rows: [{ id: 2, cells: [2, "B"] }], deleted: [3], inserted: [{ id: 9, cells: [9, null], after: 1 }] });
    expect(r.ids).toEqual([1, 9, 2]);
    expect(r.rows).toEqual([[1, "a"], [9, null], [2, "B"]]);
  });

  it("places rows first, and rows that follow other new rows", () => {
    // The server lists each new row's predecessor in the final order, in op order.
    const r = applyRowEdit(base, { ...result, inserted: [{ id: 7, cells: [7, null], after: null }, { id: 9, cells: [9, null], after: 8 }, { id: 8, cells: [8, null], after: 3 }] });
    expect(r.ids).toEqual([7, 1, 2, 3, 8, 9]);
  });
});

describe("CSV", () => {
  it("quotes what needs quoting", () => {
    expect(toCsv(columns, [[1, 'said "hi", then left'], [null, "line\nbreak"]])).toBe('Run,Note\r\n1,"said ""hi"", then left"\r\n,"line\nbreak"\r\n');
  });
});
