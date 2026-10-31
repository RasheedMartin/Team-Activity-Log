import type { SheetCell, SheetColumn } from "../api/contract";
import { colIndex } from "./sheetData";

/** RFC 4180 CSV of a tab as it is now (a header row of column names, then the rows). */
export function toCsv(columns: SheetColumn[], rows: SheetCell[][]): string {
  const q = (v: SheetCell | string | undefined) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map((c) => q(c.name)).join(",")];
  for (const r of rows) lines.push(columns.map((c) => q(r[colIndex(c.key)])).join(","));
  return lines.join("\r\n") + "\r\n";
}

export function downloadText(text: string, fileName: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob(["﻿", text], { type })); // BOM: Excel reads UTF-8
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
