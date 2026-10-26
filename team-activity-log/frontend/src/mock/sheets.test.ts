import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { columnStats, view } from "../lib/sheetData";
import { parseSheet, searchText } from "./sheets";

// Same expectations as backend/tests/test_sheets.py, so the mock and the real import agree.
const bytes = (s: string) => new TextEncoder().encode(s);
const CSV = "run,date,channel,gain\n4512,2026-03-01,A,1.02\n4513,2026-03-02,A,1.04\n4514,2026-03-03,B,0.99\n";

describe("sheet parser", () => {
  it("types a CSV's columns and finds its header", async () => {
    const [t] = await parseSheet(bytes(CSV), "runs.csv");
    expect(t.columns.map((c) => [c.name, c.type])).toEqual([["run", "number"], ["date", "date"], ["channel", "category"], ["gain", "number"]]);
    expect(t.rows[0]).toEqual([4512, "2026-03-01", "A", 1.02]);
  });

  it("reads every tab of a workbook, with Excel dates as dates", async () => {
    const tabs = await parseSheet(new Uint8Array(readFileSync(join(__dirname, "../../e2e/fixtures/Gain_Runs.xlsx"))), "Gain_Runs.xlsx");
    expect(tabs.map((t) => t.name)).toEqual(["Runs", "Calibration"]);
    expect(tabs[0].columns.map((c) => c.type)).toEqual(["number", "date", "category", "number", "number"]);
    expect(tabs[0].rows).toHaveLength(40);
    expect(tabs[0].rows[0].slice(0, 3)).toEqual([4500, "2026-03-01", "A"]);
    expect(tabs[1].rows[0]).toEqual(["Spectrometer", "2026-02-10", "Dana"]);
    expect(searchText(tabs)).toContain("Thermocouple");
  });

  it("handles quoted cells, semicolons, and a missing header", async () => {
    const [t] = await parseSheet(bytes('name;note\n"Smith, J";"said ""hi"""\nLee;ok\n'), "x.csv");
    // All text, so (like the backend) the first row isn't taken as a header.
    expect(t.rows[1]).toEqual(["Smith, J", 'said "hi"']);
    const [n] = await parseSheet(bytes("1,2\n3,4\n"), "n.csv");
    expect(n.columns.map((c) => c.name)).toEqual(["Column 1", "Column 2"]);
    expect(n.rows).toHaveLength(2);
  });

  it("refuses other files", async () => {
    await expect(parseSheet(bytes("x"), "deck.pptx")).rejects.toThrow("Choose an Excel (.xlsx) or CSV file");
  });
});

describe("sheet data", () => {
  const rows = [[3, "b"], [1, "a"], [null, "a"], [2, "c"]];
  it("sorts with empties last and filters by any cell", () => {
    expect(view(rows, "", { key: "c0", dir: "asc" })).toEqual([1, 3, 0, 2]);
    expect(view(rows, "", { key: "c0", dir: "desc" })).toEqual([0, 3, 1, 2]);
    expect(view(rows, "a", null)).toEqual([1, 2]);
  });
  it("summarizes a column", () => {
    expect(columnStats(rows, { key: "c0", name: "n", type: "number" })).toMatchObject({ filled: 3, empty: 1, min: 1, max: 3, sum: 6, avg: 2 });
    expect(columnStats(rows, { key: "c1", name: "s", type: "category" }).top?.[0]).toEqual({ value: "a", count: 2 });
  });
});
