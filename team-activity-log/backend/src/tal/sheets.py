"""Sheets (owner request): spreadsheets as small databases. An imported .xlsx or .csv becomes a sheet
with one table per tab; each column gets a type (number, date, text, category) so the app can sort,
filter, summarize, and chart it. Values only (formulas arrive as their computed results).

Read with the standard library, like .pptx and .docx. Limits keep a sheet browsable in the app.
"""

from __future__ import annotations

import csv
import datetime as dt
import io
import re
import zipfile
from dataclasses import dataclass, field
from xml.etree import ElementTree as ET

MAX_ROWS = 50_000  # per tab
MAX_COLS = 200
MAX_TABS = 30
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
PKG_REL = "{http://schemas.openxmlformats.org/package/2006/relationships}"
EXCEL_EPOCH = dt.date(1899, 12, 30)


class SheetError(ValueError):
    pass


@dataclass
class Tab:
    name: str
    columns: list[dict] = field(default_factory=list)  # [{key, name, type}]
    rows: list[list] = field(default_factory=list)  # values: number | "YYYY-MM-DD" | str | None
    truncated: bool = False


# ---------------------------------------------------------------- reading


def _col_index(ref: str) -> int:
    letters = re.match(r"[A-Z]+", ref or "")
    n = 0
    for ch in letters.group(0) if letters else "":
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def _date_styles(z: zipfile.ZipFile) -> set[int]:
    """Cell style indexes whose number format is a date (built-in 14–22, 45–47, or a custom y/m/d one)."""
    try:
        root = ET.fromstring(z.read("xl/styles.xml"))
    except KeyError:
        return set()
    custom = {}
    fmts = root.find(f"{NS}numFmts")
    for f in fmts if fmts is not None else []:
        custom[int(f.get("numFmtId", "0"))] = f.get("formatCode", "")
    out = set()
    xfs = root.find(f"{NS}cellXfs")
    for i, xf in enumerate(xfs if xfs is not None else []):
        fid = int(xf.get("numFmtId", "0"))
        code = re.sub(r'"[^"]*"|\[[^\]]*\]', "", custom.get(fid, "")).lower()
        if 14 <= fid <= 22 or 45 <= fid <= 47 or (fid in custom and re.search(r"[dy]", code) and not re.search(r"[h]", code.replace("mm", ""))):
            out.add(i)
    return out


def _xlsx(data: bytes) -> list[tuple[str, list[list]]]:
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
        wb = ET.fromstring(z.read("xl/workbook.xml"))
    except (zipfile.BadZipFile, KeyError, ET.ParseError) as e:
        raise SheetError("This isn't a valid .xlsx file") from e
    rels = {r.get("Id"): r.get("Target", "") for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels")).iter(f"{PKG_REL}Relationship")}
    shared: list[str] = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).iter(f"{NS}si"):
            shared.append("".join(t.text or "" for t in si.iter(f"{NS}t")))
    dates = _date_styles(z)
    out = []
    for sh in wb.iter(f"{NS}sheet"):
        target = rels.get(sh.get(f"{REL}id"), "")
        path = "xl/" + target.lstrip("/").removeprefix("xl/")
        try:
            root = ET.fromstring(z.read(path))
        except KeyError:
            continue
        grid: list[list] = []
        for row in root.iter(f"{NS}row"):
            r: list = []
            for c in row.iter(f"{NS}c"):
                i = _col_index(c.get("r", ""))
                if i < 0 or i >= MAX_COLS:
                    continue
                v = c.find(f"{NS}v")
                t = c.get("t")
                val: object = None
                if t == "s" and v is not None and (v.text or "").isdigit():
                    k = int(v.text)
                    val = shared[k] if k < len(shared) else None
                elif t == "inlineStr":
                    val = "".join(x.text or "" for x in c.iter(f"{NS}t"))
                elif t == "b" and v is not None:
                    val = "TRUE" if v.text == "1" else "FALSE"
                elif t in ("str", "e") and v is not None:
                    val = v.text
                elif v is not None and v.text not in (None, ""):
                    try:
                        num = float(v.text)
                        if int(c.get("s", "0") or 0) in dates and 0 < num < 2_958_466:
                            val = (EXCEL_EPOCH + dt.timedelta(days=int(num))).isoformat()
                        else:
                            val = int(num) if num.is_integer() and abs(num) < 2**53 else num
                    except ValueError:
                        val = v.text
                while len(r) <= i:
                    r.append(None)
                r[i] = val
            grid.append(r)
            if len(grid) > MAX_ROWS + 1:
                break
        out.append((sh.get("name") or f"Sheet {len(out) + 1}", grid))
        if len(out) >= MAX_TABS:
            break
    return out


def _csv(data: bytes) -> list[tuple[str, list[list]]]:
    text = data.decode("utf-8-sig", errors="replace")
    try:
        dialect = csv.Sniffer().sniff(text[:20_000], delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel
    rows = []
    for i, r in enumerate(csv.reader(io.StringIO(text), dialect)):
        rows.append([x.strip() if x.strip() else None for x in r[:MAX_COLS]])
        if i > MAX_ROWS:
            break
    return [("Data", rows)]


# ---------------------------------------------------------------- types

DATE_RE = re.compile(r"^(\d{4})-(\d{1,2})-(\d{1,2})|^(\d{1,2})/(\d{1,2})/(\d{2,4})$")


def _as_number(v: object) -> float | None:
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        s = v.replace(",", "").strip()
        if re.fullmatch(r"[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?%?", s):
            return float(s.rstrip("%")) / (100 if s.endswith("%") else 1)
    return None


def _as_date(v: object) -> str | None:
    if not isinstance(v, str):
        return None
    m = DATE_RE.match(v.strip())
    if not m:
        return None
    try:
        if m.group(1):
            return dt.date(int(m.group(1)), int(m.group(2)), int(m.group(3))).isoformat()
        y = int(m.group(6))
        return dt.date(y + 2000 if y < 100 else y, int(m.group(4)), int(m.group(5))).isoformat()
    except ValueError:
        return None


def _infer(values: list) -> str:
    present = [v for v in values if v not in (None, "")]
    if not present:
        return "text"
    if all(_as_number(v) is not None for v in present):
        return "number"
    if all(_as_date(v) for v in present):
        return "date"
    distinct = {str(v) for v in present}
    if len(distinct) <= max(12, len(present) // 20):
        return "category"
    return "text"


def _table(name: str, grid: list[list]) -> Tab | None:
    grid = [r for r in grid if any(v not in (None, "") for v in r)]
    if not grid:
        return None
    width = max(len(r) for r in grid)
    header, body = grid[0], grid[1:]
    # A first row of all-text above data that isn't all text is a header; else make names up.
    def is_data(v: object) -> bool:
        return v is not None and (_as_number(v) is not None or _as_date(v) is not None)

    labels = [h for h in header if h not in (None, "")]
    looks_like_header = bool(labels) and not any(is_data(h) for h in labels) and any(any(is_data(v) for v in r) for r in body[:20])
    if not looks_like_header:
        header, body = [None] * width, grid
    names, seen = [], set()
    for i in range(width):
        n = (str(header[i]).strip() if i < len(header) and header[i] not in (None, "") else "") or f"Column {i + 1}"
        base, k = n, 2
        while n.lower() in seen:
            n, k = f"{base} ({k})", k + 1
        seen.add(n.lower())
        names.append(n)
    rows = [[r[i] if i < len(r) else None for i in range(width)] for r in body]
    t = Tab(name=name, truncated=len(rows) > MAX_ROWS)
    rows = rows[:MAX_ROWS]
    for i, n in enumerate(names):
        kind = _infer([r[i] for r in rows])
        t.columns.append({"key": f"c{i}", "name": n, "type": kind})
        for r in rows:  # normalize to the column's type
            v = r[i]
            if kind == "number":
                r[i] = _as_number(v)
            elif kind == "date":
                r[i] = _as_date(v)
            elif v is not None:
                r[i] = str(v)
    t.rows = rows
    return t


def parse_sheet(data: bytes, filename: str) -> list[Tab]:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext == "xlsx":
        raw = _xlsx(data)
    elif ext in ("csv", "tsv", "txt"):
        raw = _csv(data)
    else:
        raise SheetError("Choose an Excel (.xlsx) or CSV file")
    tabs = [t for name, grid in raw if (t := _table(name, grid))]
    if not tabs:
        raise SheetError("No data found in this file")
    return tabs


def search_text(tabs: list[Tab], limit: int = 500_000) -> str:
    """Tab and column names plus distinct cell text, for search."""
    parts: list[str] = []
    for t in tabs:
        parts.append(t.name)
        parts += [c["name"] for c in t.columns]
        seen: set[str] = set()
        for r in t.rows:
            for v in r:
                if isinstance(v, str) and v not in seen:
                    seen.add(v)
                    parts.append(v)
    return "\n".join(parts)[:limit]
