"""Read a .pptx into slides (port of frontend/src/mock/pptx.ts; the rules are the import spec).

A .pptx is a zip of OOXML parts:

    order      ppt/presentation.xml <p:sldIdLst>, resolved through presentation.xml.rels
    sections   <p14:sectionLst> in presentation.xml extLst (PowerPoint "Sections")
    title      the shape whose placeholder type is "title" or "ctrTitle"
    order      shapes in reading order (top to bottom, then left to right) by their <a:off>,
               placeholders inheriting their position from the layout, then the master;
               z-order when any shape has no position
    text       every other text shape; bulleted when it is a body/object placeholder or a
               paragraph has <a:buChar>/<a:buAutoNum> (numbered); <a:pPr lvl> nests lists
    formatting bold, italic, underline, strike, links (<a:hlinkClick>), text color and highlight
               (srgbClr / schemeClr through the theme, with lumMod/lumOff), alignment (algn);
               colors are kept only when clearly colored, so black/white/gray text follows the
               app theme. A subtitle placeholder, or a short paragraph whose runs are all
               >= 28 pt, becomes a heading.
    tables     <a:tbl> inside a graphicFrame -> table block; header row when firstRow is set
               (or no tblPr); gridSpan/rowSpan kept, merged-away cells skipped
    charts     the chart part's cached series data -> a table (categories x series)
    SmartArt   the diagram data part's node text -> a bullet list
    pictures   <p:pic> -> <a:blip r:embed> -> slide rels -> ppt/media/* (PNG/JPEG/GIF/SVG/WebP)
    notes      the slide's notesSlide part, body placeholder text
    headers    slides whose layout type is "secHead" start a section when no Sections exist
    warnings   charts/SmartArt converted (or not), EMF/WMF pictures, video/audio, animations,
               transitions, slides without a title

Pure standard library (zipfile + ElementTree), so it runs anywhere without system packages.
"""

from __future__ import annotations

import colorsys
import io
import posixpath
import re
import zipfile
from collections.abc import Callable
from dataclasses import dataclass, field
from xml.etree import ElementTree as ET

from .prosemirror import PMNode, doc_text

NS = {
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "p14": "http://schemas.microsoft.com/office/powerpoint/2010/main",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
    "c": "http://schemas.openxmlformats.org/drawingml/2006/chart",
    "dgm": "http://schemas.openxmlformats.org/drawingml/2006/diagram",
}
MIME = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif", "svg": "image/svg+xml", "webp": "image/webp"}
MAX_PARTS = 5000  # zip-bomb guards: a real deck has far fewer parts…
MAX_UNCOMPRESSED = 1024**3  # …unpacks to well under 1 GB…
MAX_PART = 200 * 1024**2  # …and no single part (slide XML, picture) is bigger than this
MAX_RATIO = 200  # compression ratios beyond this are bombs, not slides


def q(name: str) -> str:
    """'a:t' -> '{namespace}t'."""
    prefix, local = name.split(":")
    return f"{{{NS[prefix]}}}{local}"


class PptxError(ValueError):
    """A readable message for the person who uploaded the file."""


@dataclass
class ParsedImage:
    name: str
    data: bytes
    mime: str
    text: str | None = None  # text already known (a PDF page's text layer): searchable without OCR


@dataclass
class ParsedSlide:
    n: int
    title: str
    is_section_header: bool
    content: list[PMNode]
    images: list[ParsedImage]
    notes: str
    text: str
    date: str | None
    warnings: list[str]
    section: str | None = None
    # Reading order: ("text", [nodes]) and ("image", index into images), adjacent text merged.
    parts: list[tuple[str, list[PMNode] | int]] = field(default_factory=list)
    # The slide as designed (SlideDesign; image elements carry {"image": index into design_images}).
    design: dict | None = None
    design_images: list[ParsedImage] = field(default_factory=list)
    rich: bool = False  # layout carries meaning (pictures, shapes, columns): keep it designed in "auto"
    look: dict = field(default_factory=dict)  # the slide's theme: background, heading, text, accent, fonts


@dataclass
class ParsedDeck:
    slides: list[ParsedSlide] = field(default_factory=list)
    has_sections: bool = False


def _els(root: ET.Element, tag: str) -> list[ET.Element]:
    """Descendants with this qualified name (DOM getElementsByTagName semantics)."""
    return list(root.iter(q(tag)))


def _first(root: ET.Element, tag: str) -> ET.Element | None:
    return next(root.iter(q(tag)), None)


def _resolve(from_part: str, target: str) -> str:
    if target.startswith("/"):
        return target[1:]
    return posixpath.normpath(posixpath.join(posixpath.dirname(from_part), target))


class _Package:
    def __init__(self, data: bytes):
        try:
            self.zip = zipfile.ZipFile(io.BytesIO(data))
            names = self.zip.namelist()
        except (zipfile.BadZipFile, OSError) as e:
            raise PptxError("This file isn't a valid .pptx (it couldn't be opened as a PowerPoint package). Re-save it from PowerPoint and try again.") from e
        if len(names) > MAX_PARTS:
            raise PptxError("This file has too many parts to be a presentation.")
        infos = self.zip.infolist()
        if sum(i.file_size for i in infos) > MAX_UNCOMPRESSED or any(
            i.file_size > MAX_PART or (i.compress_size and i.file_size / i.compress_size > MAX_RATIO and i.file_size > 10 * 1024**2) for i in infos
        ):
            raise PptxError("This file unpacks to an unreasonable size, so it can't be imported.")
        self.names = set(names)

    def has(self, part: str) -> bool:
        return part in self.names

    def xml(self, part: str) -> ET.Element:
        return ET.fromstring(self.zip.read(part))

    def bytes(self, part: str) -> bytes:
        return self.zip.read(part)

    def rels(self, part: str) -> list[dict[str, str]]:
        """Relationships of a part. External targets (hyperlinks) are kept as written."""
        rel_part = posixpath.join(posixpath.dirname(part), "_rels", posixpath.basename(part) + ".rels")
        if not self.has(rel_part):
            return []
        return [
            {
                "id": r.get("Id", ""),
                "type": r.get("Type", ""),
                "target": r.get("Target", "") if r.get("TargetMode") == "External" else _resolve(part, r.get("Target", "")),
            }
            for r in self.xml(rel_part).iter(f"{{{NS['rel']}}}Relationship")
        ]

    def rel(self, part: str, kind: str) -> str | None:
        """Target of the first relationship of this kind ("slideLayout", "theme", ...)."""
        return next((r["target"] for r in self.rels(part) if r["type"].endswith("/" + kind)), None)


# ---- colors ----

_SCHEME_ALIAS = {"tx1": "dk1", "bg1": "lt1", "tx2": "dk2", "bg2": "lt2"}
_HEX = re.compile(r"^[0-9a-fA-F]{6}$")


def _theme_colors(pkg: _Package, slide_part: str) -> dict[str, str]:
    """The deck theme's color scheme (slide -> layout -> master -> theme), name -> RRGGBB."""
    layout = pkg.rel(slide_part, "slideLayout")
    master = pkg.rel(layout, "slideMaster") if layout else None
    theme = pkg.rel(master, "theme") if master else None
    if not theme or not pkg.has(theme):
        return {}
    scheme = _first(pkg.xml(theme), "a:clrScheme")
    out: dict[str, str] = {}
    for c in list(scheme) if scheme is not None else []:
        name = c.tag.rsplit("}", 1)[-1]
        v = next(iter(c), None)
        val = (v.get("val") if v is not None and v.tag == q("a:srgbClr") else v.get("lastClr") if v is not None else None) or ""
        if _HEX.match(val):
            out[name] = val
    # The master's color map says which scheme colors text and background use (dark themes swap them).
    cmap = _first(pkg.xml(master), "p:clrMap") if pkg.has(master) else None
    for k, v in (cmap.attrib if cmap is not None else _SCHEME_ALIAS).items():
        if v in out:
            out[k] = out[v]
    return out


def _color(fill: ET.Element | None, theme: dict[str, str], alpha: bool = False) -> str | None:
    """'#rrggbb' from a fill element's srgbClr/schemeClr/sysClr child, with lumMod/lumOff/tint/shade
    applied. With `alpha`, a transparent color comes back as '#rrggbbaa'."""
    for c in list(fill) if fill is not None else []:
        if c.tag == q("a:srgbClr"):
            base = c.get("val", "")
        elif c.tag == q("a:schemeClr"):
            v = c.get("val", "")
            base = theme.get(v) or theme.get(_SCHEME_ALIAS.get(v, v), "")
        elif c.tag == q("a:sysClr"):
            base = c.get("lastClr", "")
        else:
            continue
        if not _HEX.match(base):
            return None
        r, g, b = (int(base[i : i + 2], 16) / 255 for i in (0, 2, 4))
        h, light, sat = colorsys.rgb_to_hls(r, g, b)
        opacity = 1.0
        for mod in list(c):
            val = int(mod.get("val", "0")) / 100_000 if mod.get("val", "").isdigit() else None
            if val is None:
                continue
            if mod.tag == q("a:lumMod"):
                light *= val
            elif mod.tag == q("a:lumOff"):
                light += val
            elif mod.tag == q("a:tint"):
                light = light * val + (1 - val)  # toward white
            elif mod.tag == q("a:shade"):
                light *= val  # toward black
            elif mod.tag == q("a:alpha"):
                opacity = val
        r, g, b = colorsys.hls_to_rgb(h, min(1.0, max(0.0, light)), sat)
        out = "#" + "".join(f"{round(x * 255):02x}" for x in (r, g, b))
        return out + f"{round(opacity * 255):02x}" if alpha and opacity < 0.995 else out
    return None


def _distinct(color: str) -> bool:
    """Clearly colored (not black, white or gray), so it carries meaning worth keeping."""
    r, g, b = (int(color[i : i + 2], 16) / 255 for i in (1, 3, 5))
    _, light, sat = colorsys.rgb_to_hls(r, g, b)
    return sat >= 0.25 and 0.18 <= light <= 0.82


# ---- text ----


@dataclass
class _Ctx:
    """What text conversion needs from the slide: its theme colors and hyperlink targets."""

    theme: dict[str, str] = field(default_factory=dict)
    links: dict[str, str] = field(default_factory=dict)
    keep_colors: bool = False  # designed slides keep every color; flowing text only clear ones
    headings: bool = True  # large text / subtitles become headings (flowing text only)
    base_size: float | None = None  # a designed text box's size: runs that differ keep theirs
    font_scale: float = 1.0  # normAutofit shrink
    fonts: dict[str, str] = field(default_factory=dict)  # theme heading/body fonts ("+mj-lt"/"+mn-lt")
    base_font: str | None = None  # a designed text box's font: runs in another typeface keep theirs
    table_styles: dict[str, ET.Element] = field(default_factory=dict)  # designed slides: PowerPoint table styles
    design: bool = False  # designed slide: keep table geometry and styling


_SAFE_HREF = re.compile(r"^(https?://|mailto:)", re.I)
_FONT_NAME = re.compile(r"[\w .-]{1,64}")
_ALIGN = {"ctr": "center", "r": "right", "just": "justify"}
HEADING_SIZE = 2800  # hundredths of a point: 28 pt and up reads as a heading


def _runs(p: ET.Element, ctx: _Ctx | None = None) -> list[PMNode]:
    ctx = ctx or _Ctx()
    out: list[PMNode] = []
    for c in list(p):
        if c.tag in (q("a:r"), q("a:fld")):
            t_el = _first(c, "a:t")
            t = t_el.text if t_el is not None and t_el.text else ""
            if not t:
                continue
            pr = c.find(q("a:rPr"))
            marks: list[dict] = []
            if pr is not None:
                if pr.get("b") == "1":
                    marks.append({"type": "bold"})
                if pr.get("i") == "1":
                    marks.append({"type": "italic"})
                if pr.get("u") and pr.get("u") != "none":
                    marks.append({"type": "underline"})
                if pr.get("strike") in ("sngStrike", "dblStrike"):
                    marks.append({"type": "strike"})
                link = pr.find(q("a:hlinkClick"))
                href = ctx.links.get(link.get(q("r:id"), "")) if link is not None else None
                if href and _SAFE_HREF.match(href):
                    marks.append({"type": "link", "attrs": {"href": href}})
                style: dict[str, str] = {}
                color = _color(pr.find(q("a:solidFill")), ctx.theme)
                if color and (ctx.keep_colors or _distinct(color)):
                    style["color"] = color
                sz = pr.get("sz", "")
                if ctx.base_size and sz.isdigit() and abs(int(sz) / 100 - ctx.base_size) >= 0.5:
                    style["fontSize"] = f"{round(int(sz) / 100 * ctx.font_scale, 1):g}px"  # 1 px = 1 pt on a slide
                latin = pr.find(q("a:latin"))
                face = latin.get("typeface", "") if latin is not None and ctx.design else ""
                face = {"+mj-lt": ctx.fonts.get("heading", ""), "+mn-lt": ctx.fonts.get("body", "")}.get(face, face)
                if face and face != ctx.base_font and _FONT_NAME.fullmatch(face):
                    style["fontFamily"] = face
                if style:
                    marks.append({"type": "textStyle", "attrs": style})
                hl = _color(pr.find(q("a:highlight")), ctx.theme)
                if hl:
                    marks.append({"type": "highlight", "attrs": {"color": hl}})
            out.append({"type": "text", "text": t, **({"marks": marks} if marks else {})})
        elif c.tag == q("a:br"):
            out.append({"type": "hardBreak"})
    return out


def _plain(nodes: list[PMNode]) -> str:
    return "".join("\n" if n["type"] == "hardBreak" else n.get("text", "") for n in nodes)


def _large(p: ET.Element) -> bool:
    """Every run with text is explicitly sized at heading size."""
    sizes = [
        (r.find(q("a:rPr")).get("sz") if r.find(q("a:rPr")) is not None else None)
        for r in p
        if r.tag in (q("a:r"), q("a:fld")) and (_first(r, "a:t") is not None and (_first(r, "a:t").text or "").strip())
    ]
    return bool(sizes) and all(sz and sz.isdigit() and int(sz) >= HEADING_SIZE for sz in sizes)


def _align(p: ET.Element) -> str | None:
    ppr = p.find(q("a:pPr"))
    return _ALIGN.get(ppr.get("algn", "")) if ppr is not None else None


def _block(kind: str, content: list[PMNode], align: str | None, level: int | None = None) -> PMNode:
    attrs: dict = {}
    if level:
        attrs["level"] = level
    if align:
        attrs["textAlign"] = align
    return {"type": kind, **({"attrs": attrs} if attrs else {}), "content": content}


def _text_body(body: ET.Element, bulleted: bool, ctx: _Ctx | None = None, subtitle: bool = False) -> list[PMNode]:
    out: list[PMNode] = []
    stack: list[tuple[int, str, PMNode]] = []  # open lists: (level, kind, node), outermost first
    for p in _els(body, "a:p"):
        content = _runs(p, ctx)
        if not _plain(content).strip():
            stack = []
            continue
        ppr = p.find(q("a:pPr"))
        auto = ppr.find(q("a:buAutoNum")) if ppr is not None else None
        explicit = ppr is not None and (ppr.find(q("a:buChar")) is not None or auto is not None)
        no_bullet = ppr is not None and ppr.find(q("a:buNone")) is not None
        align = _align(p)
        if (bulleted or explicit) and not no_bullet:
            lvl = ppr.get("lvl", "0") if ppr is not None else "0"
            level = min(int(lvl), 8) if lvl.isdigit() else 0
            kind = "orderedList" if auto is not None else "bulletList"
            while stack and stack[-1][0] > level:
                stack.pop()
            if stack and stack[-1][0] == level and stack[-1][1] != kind:
                stack.pop()
            if not stack or stack[-1][0] < level:
                lst: PMNode = {"type": kind, "content": []}
                start = auto.get("startAt", "") if auto is not None else ""
                if start.isdigit() and int(start) != 1:
                    lst["attrs"] = {"start": int(start)}
                if stack:
                    stack[-1][2]["content"][-1]["content"].append(lst)  # nested under the previous item
                else:
                    out.append(lst)
                stack.append((level, kind, lst))
            stack[-1][2]["content"].append({"type": "listItem", "content": [_block("paragraph", content, align)]})
        else:
            stack = []
            heading = (ctx is None or ctx.headings) and (subtitle or (_large(p) and len(_plain(content)) <= 120))
            out.append(_block("heading", content, align, 3) if heading else _block("paragraph", content, align))
    return out


def _table_style_regions(style: ET.Element | None, theme: dict[str, str]) -> tuple[dict[str, dict], str | None]:
    """A PowerPoint table style's regions (wholeTbl, firstRow, band1H, …) as {fill, color, bold},
    and the style's border color."""
    regions: dict[str, dict] = {}
    border = None
    for reg in list(style) if style is not None else []:
        out: dict = {}
        tc = reg.find(q("a:tcStyle"))
        fill = tc.find(q("a:fill")) if tc is not None else None
        solid = fill.find(q("a:solidFill")) if fill is not None else None
        if solid is not None and (c := _color(solid, theme)):
            out["fill"] = c
        tx = reg.find(q("a:tcTxStyle"))
        if tx is not None:
            if c := _color(tx, theme):
                out["color"] = c
            if tx.get("b") == "on":
                out["bold"] = True
        if border is None and tc is not None and (bdr := tc.find(q("a:tcBdr"))) is not None:
            border = next((c for ln in bdr.iter(q("a:ln")) if (c := _color(ln.find(q("a:solidFill")), theme))), None)
        regions[_local(reg)] = out
    return regions, border


def _with_mark(nodes: list[PMNode], mark: dict) -> list[PMNode]:
    """Add a mark to every text node that doesn't already have one of its type."""
    out = []
    for n in nodes:
        if n.get("type") == "text" and not any(m["type"] == mark["type"] for m in n.get("marks", [])):
            n = {**n, "marks": [*n.get("marks", []), mark]}
        elif n.get("content"):
            n = {**n, "content": _with_mark(n["content"], mark)}
        out.append(n)
    return out


def _table(tbl: ET.Element, ctx: _Ctx | None = None) -> PMNode:
    ctx = ctx or _Ctx()
    pr = tbl.find(q("a:tblPr"))
    flag = lambda k: pr is not None and pr.get(k) == "1"  # noqa: E731
    header = pr is None or flag("firstRow")
    widths = [_pt(int(g.get("w", "0"))) for g in _els(tbl, "a:gridCol") if g.get("w", "").isdigit()] if ctx.design else []
    style_id = pr.find(q("a:tableStyleId")) if pr is not None else None
    regions, border = _table_style_regions(ctx.table_styles.get((style_id.text or "").strip()) if style_id is not None else None, ctx.theme) if ctx.design else ({}, None)
    trs = _els(tbl, "a:tr")
    rows = []
    for r, tr in enumerate(trs):
        cells = []
        col = 0
        for tc in [c for c in list(tr) if c.tag == q("a:tc")]:
            span = int(tc.get("gridSpan", "1")) if tc.get("gridSpan", "1").isdigit() else 1
            if tc.get("hMerge") == "1" or tc.get("vMerge") == "1":
                col += 1
                continue  # covered by a neighbor's span
            paras = [_block("paragraph", _runs(p, ctx), _align(p)) for p in _els(tc, "a:p")]
            paras = [x for x in paras if x["content"]] or [{"type": "paragraph"}]
            attrs: dict = {k: int(tc.get(a, "1")) for k, a in (("colspan", "gridSpan"), ("rowspan", "rowSpan")) if tc.get(a, "1").isdigit() and int(tc.get(a, "1")) > 1}
            if ctx.design:
                if widths[col : col + span]:
                    attrs["colwidth"] = [round(w) for w in widths[col : col + span]]
                # Style regions, most specific last; then the cell's own fill.
                names = ["wholeTbl"]
                if flag("bandRow") and not (header and r == 0):
                    names.append("band1H" if (r - (1 if header else 0)) % 2 == 0 else "band2H")
                if flag("firstCol") and col == 0:
                    names.append("firstCol")
                if flag("lastRow") and r == len(trs) - 1:
                    names.append("lastRow")
                if header and r == 0:
                    names.append("firstRow")
                look: dict = {}
                for name in names:
                    look.update(regions.get(name, {}))
                tcpr = tc.find(q("a:tcPr"))
                if tcpr is not None and tcpr.find(q("a:noFill")) is not None:
                    look.pop("fill", None)
                elif tcpr is not None and (own := _color(tcpr.find(q("a:solidFill")), ctx.theme)):
                    look["fill"] = own
                if look.get("fill"):
                    attrs["background"] = look["fill"]
                if look.get("color"):
                    attrs["color"] = look["color"]
                if look.get("bold"):
                    paras = _with_mark(paras, {"type": "bold"})
            cells.append({"type": "tableHeader" if header and r == 0 else "tableCell", **({"attrs": attrs} if attrs else {}), "content": paras})
            col += span
        rows.append({"type": "tableRow", "content": cells})
    return {"type": "table", **({"attrs": {"borderColor": border}} if border else {}), "content": rows}


MAX_CHART_ROWS = 200
MAX_CHART_SERIES = 20


def _chart(pkg: _Package, part: str) -> list[PMNode]:
    """A chart's cached data as a table: a row per category, a column per series."""
    root = pkg.xml(part)
    title_el = _first(root, "c:title")
    title = " ".join(t.text or "" for t in title_el.iter(q("a:t"))).strip() if title_el is not None else ""

    def points(el: ET.Element | None) -> dict[int, str]:
        if el is None:
            return {}
        return {int(pt.get("idx", "0")): (_first(pt, "c:v").text or "") for pt in el.iter(q("c:pt")) if pt.get("idx", "").isdigit() and _first(pt, "c:v") is not None}

    series = []
    cats: dict[int, str] = {}
    for ser in _els(root, "c:ser")[:MAX_CHART_SERIES]:
        tx = ser.find(q("c:tx"))
        name = " ".join(v.text or "" for v in tx.iter(q("c:v"))).strip() if tx is not None else ""
        cats = cats or points(ser.find(q("c:cat")) if ser.find(q("c:cat")) is not None else ser.find(q("c:xVal")))
        vals = points(ser.find(q("c:val")) if ser.find(q("c:val")) is not None else ser.find(q("c:yVal")))
        series.append((name or f"Series {len(series) + 1}", vals))
    if not series:
        return []
    idxs = sorted(set(cats) | {i for _, v in series for i in v})[:MAX_CHART_ROWS]
    cell = lambda kind, t: {"type": kind, "content": [{"type": "paragraph", **({"content": [{"type": "text", "text": t}]} if t else {})}]}  # noqa: E731
    rows = [{"type": "tableRow", "content": [cell("tableHeader", ""), *(cell("tableHeader", n) for n, _ in series)]}]
    rows += [{"type": "tableRow", "content": [cell("tableCell", cats.get(i, str(i + 1))), *(cell("tableCell", v.get(i, "")) for _, v in series)]} for i in idxs]
    caption = [{"type": "paragraph", "content": [{"type": "text", "text": title, "marks": [{"type": "bold"}]}]}] if title else []
    return [*caption, {"type": "table", "content": rows}]


_CHART_TYPES = {
    "barChart": "column", "bar3DChart": "column", "lineChart": "line", "line3DChart": "line", "areaChart": "area", "area3DChart": "area",
    "pieChart": "pie", "pie3DChart": "pie", "ofPieChart": "pie", "doughnutChart": "doughnut", "scatterChart": "scatter",
}  # fmt: skip


def _chart_style(pkg: _Package, part: str, theme: dict[str, str]) -> tuple[str, list[str | None]]:
    """A chart's type (column, bar, line, area, pie, doughnut, scatter) and its series colors
    (None where the deck leaves it to the theme)."""
    root = pkg.xml(part)
    plot = _first(root, "c:plotArea")
    kind = "column"
    for el in list(plot) if plot is not None else []:
        if _local(el) in _CHART_TYPES:
            kind = _CHART_TYPES[_local(el)]
            bar_dir = el.find(q("c:barDir"))
            if kind == "column" and bar_dir is not None and bar_dir.get("val") == "bar":
                kind = "bar"
            break
    colors: list[str | None] = []
    for ser in _els(root, "c:ser")[:MAX_CHART_SERIES]:
        pr = ser.find(q("c:spPr"))
        colors.append((_color(pr.find(q("a:solidFill")), theme) or _color(_first(pr, "a:solidFill"), theme)) if pr is not None else None)
    return kind, colors if any(colors) else []


def _smartart(pkg: _Package, part: str) -> list[PMNode]:
    """SmartArt node text, in document order, as a bullet list."""
    items = []
    for pt in _els(pkg.xml(part), "dgm:pt"):
        if pt.get("type", "node") != "node":
            continue
        t = pt.find(q("dgm:t"))
        text = " ".join(x.text or "" for x in t.iter(q("a:t"))).strip() if t is not None else ""
        if text:
            items.append({"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}]})
    return [{"type": "bulletList", "content": items}] if items else []


# ---- dates ----

_MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]


def guess_date(text: str) -> str | None:
    """First plausible date in the text (ISO, US numeric, '12 Mar 2024', 'March 12, 2024')."""

    def valid(y: int, m: int, d: int) -> bool:
        return 1990 <= y <= 2100 and 1 <= m <= 12 and 1 <= d <= 31

    m = re.search(r"\b(\d{4})-(\d{1,2})-(\d{1,2})\b", text)
    if m and valid(int(m[1]), int(m[2]), int(m[3])):
        return f"{m[1]}-{int(m[2]):02d}-{int(m[3]):02d}"
    m = re.search(r"\b(\d{1,2})/(\d{1,2})/(\d{4})\b", text)
    if m and valid(int(m[3]), int(m[1]), int(m[2])):
        return f"{m[3]}-{int(m[1]):02d}-{int(m[2]):02d}"
    m = re.search(r"\b(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})\b", text)
    if m:
        mo = _MONTHS.index(m[2][:3].lower()) + 1 if m[2][:3].lower() in _MONTHS else 0
        if mo and valid(int(m[3]), mo, int(m[1])):
            return f"{m[3]}-{mo:02d}-{int(m[1]):02d}"
    m = re.search(r"\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b", text)
    if m:
        mo = _MONTHS.index(m[1][:3].lower()) + 1 if m[1][:3].lower() in _MONTHS else 0
        if mo and valid(int(m[3]), mo, int(m[2])):
            return f"{m[3]}-{mo:02d}-{int(m[2]):02d}"
    return None


# ---- designed slides ----
#
# The same slide as positioned elements (contract.ts SlideDesign), in points (1 pt = 12700 EMU).
# Shapes come from the master and layout (template art, unless showMasterSp="0"), then the slide.
# Placeholders inherit position, anchor, font size and color from the layout, then the master,
# then the master's text styles. Groups map child coordinates through chOff/chExt.

EMU_PER_PT = 12_700
_PRESET = {"rect": "rect", "roundRect": "roundRect", "snipRoundRect": "roundRect", "ellipse": "ellipse", "triangle": "triangle", "line": "line", "straightConnector1": "line"}
_ANCHOR = {"ctr": "middle", "b": "bottom", "t": "top"}
# Where PowerPoint's default template puts placeholders (fractions of the slide), used when neither
# the slide, its layout, nor its master says.
_DEFAULT_BOX = {
    "title": (0.069, 0.053, 0.862, 0.193),
    "ctrTitle": (0.125, 0.164, 0.75, 0.349),
    "subTitle": (0.125, 0.526, 0.75, 0.242),
    "body": (0.069, 0.266, 0.862, 0.635),
}
_STYLE_FOR = {"title": "titleStyle", "ctrTitle": "titleStyle", "body": "bodyStyle", "obj": "bodyStyle", "subTitle": "bodyStyle"}


def _local(el: ET.Element) -> str:
    return el.tag.rsplit("}", 1)[-1]


def _kid(el: ET.Element | None, name: str) -> ET.Element | None:
    """Direct child by local name, any namespace (slides use p:, SmartArt drawings dsp:)."""
    return next((c for c in el if _local(c) == name), None) if el is not None else None


def _pt(v: float) -> float:
    return round(v / EMU_PER_PT, 2)


@dataclass
class _Xf:
    """Maps a group's child coordinates (EMU) to slide coordinates."""

    ox: float = 0
    oy: float = 0
    sx: float = 1
    sy: float = 1

    def box(self, x: float, y: float, w: float, h: float) -> tuple[float, float, float, float]:
        return self.ox + x * self.sx, self.oy + y * self.sy, w * self.sx, h * self.sy


def _xfrm(el: ET.Element) -> ET.Element | None:
    if _local(el) == "graphicFrame":
        return _kid(el, "xfrm")
    pr = _kid(el, "spPr")
    return _kid(pr if pr is not None else _kid(el, "grpSpPr"), "xfrm")


def _geom(xfrm: ET.Element | None) -> tuple[int, int, int, int] | None:
    off, ext = _kid(xfrm, "off"), _kid(xfrm, "ext")
    try:
        return (int(off.get("x", "")), int(off.get("y", "")), int(ext.get("cx", "")), int(ext.get("cy", ""))) if off is not None and ext is not None else None
    except ValueError:
        return None


def _theme_fonts(pkg: _Package, slide_part: str) -> dict[str, str]:
    layout = pkg.rel(slide_part, "slideLayout")
    master = pkg.rel(layout, "slideMaster") if layout else None
    theme = pkg.rel(master, "theme") if master else None
    if not theme or not pkg.has(theme):
        return {}
    root = pkg.xml(theme)
    out = {}
    for key, tag in (("heading", "a:majorFont"), ("body", "a:minorFont")):
        f = _first(root, tag)
        latin = f.find(q("a:latin")) if f is not None else None
        name = latin.get("typeface", "") if latin is not None else ""
        if re.fullmatch(r"[\w .-]{1,64}", name):
            out[key] = name
    return out


def _fill(sp: ET.Element, theme: dict[str, str]) -> tuple[str | None, str | None, float | None]:
    """(fill, line color, line width pt) from spPr, falling back to the shape's theme style refs."""
    pr = _kid(sp, "spPr")
    style = _kid(sp, "style")
    fill = line = None
    width = None
    if pr is not None and _kid(pr, "noFill") is None:
        if (solid := _kid(pr, "solidFill")) is not None:
            fill = _color(solid, theme, alpha=True)
        elif (grad := _kid(pr, "gradFill")) is not None:
            stop = next(grad.iter(q("a:gs")), None)
            fill = _color(stop, theme)
        elif style is not None and (ref := _kid(style, "fillRef")) is not None and ref.get("idx", "0") != "0":
            fill = _color(ref, theme)
    ln = _kid(pr, "ln")
    if ln is not None and ln.get("w", "").isdigit():
        width = _pt(int(ln.get("w", "0")))
    if ln is None or _kid(ln, "noFill") is None:
        if ln is not None and (solid := _kid(ln, "solidFill")) is not None:
            line = _color(solid, theme, alpha=True)
        elif style is not None and (ref := _kid(style, "lnRef")) is not None and ref.get("idx", "0") != "0":
            line = _color(ref, theme)
            width = width or 0.75
    return fill, line, width


def _box_style(chain: list[ET.Element], txstyle: ET.Element | None, theme: dict[str, str]) -> tuple[float | None, str | None, str | None]:
    """(font size pt, text color, vertical anchor) for a text shape: its own lstStyle/bodyPr, then
    the inherited placeholders' (layout, master), then the master text style."""
    size = color = anchor = None
    for sp in chain:
        body = _kid(sp, "txBody")
        bpr = _kid(body, "bodyPr")
        if anchor is None and bpr is not None and bpr.get("anchor") in _ANCHOR:
            anchor = _ANCHOR[bpr.get("anchor", "")]
        lvl1 = _kid(_kid(body, "lstStyle"), "lvl1pPr")
        dr = _kid(lvl1, "defRPr")
        if dr is not None:
            if size is None and dr.get("sz", "").isdigit():
                size = int(dr.get("sz", "0")) / 100
            if color is None and (solid := _kid(dr, "solidFill")) is not None:
                color = _color(solid, theme)
    dr = _kid(_kid(txstyle, "lvl1pPr"), "defRPr")
    if dr is not None:
        if size is None and dr.get("sz", "").isdigit():
            size = int(dr.get("sz", "0")) / 100
        if color is None and (solid := _kid(dr, "solidFill")) is not None:
            color = _color(solid, theme)
    return size, color, anchor


def _default_size(pkg: _Package) -> float:
    """The deck's default text size (presentation.xml defaultTextStyle), else PowerPoint's 18 pt."""
    pres = pkg.xml("ppt/presentation.xml")
    dts = _first(pres, "p:defaultTextStyle")
    lvl1 = dts.find(q("a:lvl1pPr")) if dts is not None else None
    dr = lvl1.find(q("a:defRPr")) if lvl1 is not None else None
    return int(dr.get("sz", "")) / 100 if dr is not None and dr.get("sz", "").isdigit() else 18.0


def _dominant_size(body: ET.Element) -> float | None:
    sizes: dict[str, int] = {}
    for r in body.iter(q("a:rPr")):
        if r.get("sz", "").isdigit():
            sizes[r.get("sz", "")] = sizes.get(r.get("sz", ""), 0) + 1
    return int(max(sizes, key=lambda k: (sizes[k], int(k)))) / 100 if sizes else None


class _Design:
    """Builds one slide's SlideDesign. Image elements carry {"image": index into self.images}."""

    def __init__(self, pkg: _Package, part: str, size: tuple[int, int], ctx: _Ctx):
        self.pkg, self.part, self.ctx = pkg, part, ctx
        self.fonts = _theme_fonts(pkg, part)
        self.default_size = _default_size(pkg)
        styles = pkg.xml("ppt/tableStyles.xml") if pkg.has("ppt/tableStyles.xml") else None
        self.table_styles = {s.get("styleId", ""): s for s in styles.iter(q("a:tblStyle"))} if styles is not None else {}
        self.w, self.h = size
        self.images: list[ParsedImage] = []
        self.elements: list[dict] = []
        self.rich = False  # the slide itself has pictures, shapes, groups, charts, or several text boxes
        self.look: dict = {}
        self.text_boxes = 0
        self.layout = pkg.rel(part, "slideLayout")
        self.master = pkg.rel(self.layout, "slideMaster") if self.layout else None
        self.master_root = pkg.xml(self.master) if self.master and pkg.has(self.master) else None
        self.inherit = [self._placeholders(self.layout), self._placeholders(self.master)]
        self.n = 0

    def _placeholders(self, part: str | None) -> dict[str, ET.Element]:
        out: dict[str, ET.Element] = {}
        if not part or not self.pkg.has(part):
            return out
        for sp in _els(self.pkg.xml(part), "p:sp"):
            ph = _first(sp, "p:ph")
            if ph is None:
                continue
            if ph.get("idx"):
                out.setdefault(f"idx:{ph.get('idx')}", sp)
            out.setdefault(f"type:{ph.get('type') or 'body'}", sp)
        return out

    def _inherited(self, ph: ET.Element) -> list[ET.Element]:
        keys = ([f"idx:{ph.get('idx')}"] if ph.get("idx") else []) + [f"type:{ph.get('type') or 'body'}"]
        out = []
        for src in self.inherit:
            sp = next((src[k] for k in keys if k in src), None)
            if sp is not None:
                out.append(sp)
        return out

    def _id(self) -> str:
        self.n += 1
        return f"e{self.n}"

    def background(self) -> str | None:
        """Slide, then layout, then master background: a color, or a picture added as template art."""
        for part in (self.part, self.layout, self.master):
            if not part or not self.pkg.has(part):
                continue
            bg = _first(self.pkg.xml(part), "p:bg")
            if bg is None:
                continue
            pr, ref = _kid(bg, "bgPr"), _kid(bg, "bgRef")
            if pr is not None:
                if (solid := _kid(pr, "solidFill")) is not None:
                    return _color(solid, self.ctx.theme)
                if (grad := _kid(pr, "gradFill")) is not None:
                    return _color(next(grad.iter(q("a:gs")), None), self.ctx.theme)
                if (blip := _first(pr, "a:blip")) is not None:
                    self._picture(blip.get(q("r:embed"), ""), part, (0, 0, self.w, self.h), decorative=True)
                    return None
            if ref is not None:
                return _color(ref, self.ctx.theme)
        lt1 = self.ctx.theme.get("bg1") or self.ctx.theme.get("lt1")
        return f"#{lt1.lower()}" if lt1 else None

    def build(self) -> dict:
        background = self.background()
        sld = self.pkg.xml(self.part)
        layout_root = self.pkg.xml(self.layout) if self.layout and self.pkg.has(self.layout) else None
        show_master = sld.get("showMasterSp") != "0"
        if show_master and self.master_root is not None and (layout_root is None or layout_root.get("showMasterSp") != "0"):
            self.walk(_first(self.master_root, "p:spTree"), self.master, _Xf(), template=True)
        if show_master and layout_root is not None:
            self.walk(_first(layout_root, "p:spTree"), self.layout, _Xf(), template=True)
        self.walk(_first(sld, "p:spTree"), self.part, _Xf(), template=False)
        self.rich = self.rich or self.text_boxes >= 2
        out: dict = {"size": {"w": _pt(self.w), "h": _pt(self.h)}, "elements": self.elements}
        if background:
            out["background"] = background
        # The slide's look, for presenting its text-only neighbors the same way (post themes).
        title = next((e for e in self.elements if e.get("role") == "title"), None)
        body = next((e for e in self.elements if e["kind"] != "image" and e.get("doc") and not e.get("role") and not e.get("decorative")), None)
        accent = self.ctx.theme.get("accent1")
        self.look = {
            k: v
            for k, v in {
                "background": background,
                "heading": title.get("color") if title else None,
                "text": body.get("color") if body else None,
                "accent": f"#{accent.lower()}" if accent else None,
                "headingFont": self.fonts.get("heading"),
                "bodyFont": self.fonts.get("body"),
            }.items()
            if v
        }
        return out

    def walk(self, tree: ET.Element | None, part: str | None, xf: _Xf, template: bool) -> None:
        if tree is None or not part:
            return
        for el in list(tree):
            kind = _local(el)
            if kind == "grpSp":
                g = _geom(_xfrm(el))
                ch = _xfrm(el)
                choff, chext = _kid(ch, "chOff"), _kid(ch, "chExt")
                inner = xf
                if g and choff is not None and chext is not None:
                    x, y, w, h = xf.box(*g)
                    cw, chh = int(chext.get("cx", "0") or 0), int(chext.get("cy", "0") or 0)
                    sx, sy = (w / cw if cw else 1), (h / chh if chh else 1)
                    inner = _Xf(x - int(choff.get("x", "0")) * sx, y - int(choff.get("y", "0")) * sy, sx, sy)
                self.rich = self.rich or not template
                self.walk(el, part, inner, template)
            elif kind in ("sp", "cxnSp"):
                self.shape(el, part, xf, template)
            elif kind == "pic":
                g = _geom(_xfrm(el))
                blip = _first(el, "a:blip")
                if g and blip is not None and _first(el, "a:videoFile") is None and _first(el, "p14:media") is None:
                    self.rich = self.rich or not template
                    self._picture(blip.get(q("r:embed"), ""), part, xf.box(*g), decorative=template, rot=self._rotation(el))
            elif kind == "graphicFrame":
                self.frame(el, part, xf, template)

    def _rotation(self, el: ET.Element) -> float | None:
        x = _xfrm(el)
        r = x.get("rot", "") if x is not None else ""
        return round(int(r) / 60000, 2) if r.lstrip("-").isdigit() and int(r) else None

    def _picture(self, rid: str, part: str, box: tuple[float, float, float, float], decorative: bool, rot: float | None = None) -> None:
        target = next((r["target"] for r in self.pkg.rels(part) if r["id"] == rid), None)
        mime = MIME.get(target.rsplit(".", 1)[-1].lower()) if target else None
        if not target or not mime or not self.pkg.has(target):
            return
        self.images.append(ParsedImage(name=f"slide-{posixpath.basename(target)}", data=self.pkg.bytes(target), mime=mime))
        el = {"id": self._id(), "kind": "image", **self._box(box), "image": len(self.images) - 1}
        if rot:
            el["rotation"] = rot
        if decorative:
            el["decorative"] = True
        self.elements.append(el)

    def _box(self, box: tuple[float, float, float, float]) -> dict:
        x, y, w, h = box
        return {"x": _pt(x), "y": _pt(y), "w": _pt(w), "h": _pt(h)}

    def shape(self, sp: ET.Element, part: str, xf: _Xf, template: bool) -> None:
        ph = _first(sp, "p:ph")
        typ = (ph.get("type") or "body") if ph is not None else None
        if template and ph is not None:
            return  # placeholders on the master/layout only define what slides inherit
        if typ in ("sldNum", "dt", "ftr"):
            return
        chain = [sp, *(self._inherited(ph) if ph is not None else [])]
        g = next((g for g in (_geom(_xfrm(s)) for s in chain) if g), None)
        if not g and ph is not None:
            fx, fy, fw, fh = _DEFAULT_BOX.get(typ or "body", _DEFAULT_BOX["body"])
            g = (int(fx * self.w), int(fy * self.h), int(fw * self.w), int(fh * self.h))
        if not g:
            return
        body = _kid(sp, "txBody")
        style_name = _STYLE_FOR.get(typ or "", "otherStyle") if ph is not None else "otherStyle"
        # Master text styles apply to placeholders; a plain text box takes the deck's default size.
        txstyle = _first(self.master_root, f"p:{style_name}") if self.master_root is not None and ph is not None else None
        size, color, anchor = _box_style(chain, txstyle, self.ctx.theme)
        bpr = _kid(body, "bodyPr")
        scale = 1.0
        fit = _kid(bpr, "normAutofit")
        if fit is not None and fit.get("fontScale", "").isdigit():
            scale = int(fit.get("fontScale", "100000")) / 100_000
        base = (_dominant_size(body) if body is not None else None) or size or (40.0 if typ in ("title", "ctrTitle") else self.default_size)
        role_font = self.fonts.get("heading" if typ in ("title", "ctrTitle") else "body") or self.fonts.get("body")
        ctx = _Ctx(theme=self.ctx.theme, links=self._links(part), keep_colors=True, headings=False, base_size=base, font_scale=scale, fonts=self.fonts, base_font=role_font, design=True)
        nodes = _text_body(body, typ in ("body", "obj"), ctx) if body is not None else []
        geom = _kid(_kid(sp, "spPr"), "prstGeom")
        prst = geom.get("prst", "rect") if geom is not None else ("line" if _local(sp) == "cxnSp" else "rect")
        fill, line, lw = _fill(sp, self.ctx.theme)
        if not nodes and not fill and not line:
            return
        el: dict = {"id": self._id(), **self._box(xf.box(*g))}
        x = _xfrm(sp)
        if rot := self._rotation(sp):
            el["rotation"] = rot
        if prst == "rect" and not (fill or line) or (ph is not None and prst == "rect"):
            el["kind"] = "text"
            if fill:
                el["fill"] = fill
            if line:
                el["line"] = line
        else:
            shape = _PRESET.get(prst, "rect")
            ln = _kid(_kid(sp, "spPr"), "ln")
            if shape == "line" and ln is not None and any((e := _kid(ln, t)) is not None and e.get("type", "none") != "none" for t in ("tailEnd", "headEnd")):
                shape = "arrow"
            el.update(kind="shape", shape=shape)
            if fill and shape not in ("line", "arrow"):
                el["fill"] = fill
            if line:
                el["line"] = line
            if lw is not None:
                el["lineWidth"] = lw
            for f in ("flipH", "flipV"):
                if x is not None and x.get(f) == "1":
                    el[f] = True
        if nodes:
            el["doc"] = {"type": "doc", "content": nodes}
            el["fontSize"] = round(base * scale, 1)
            el["color"] = color or "#000000"
            if anchor and anchor != "top":
                el["valign"] = anchor
            if typ in ("title", "ctrTitle"):
                el["role"] = "title"
        if template:
            el["decorative"] = True
        else:
            if typ not in ("title", "ctrTitle") and nodes:
                self.text_boxes += 1
            if el["kind"] == "shape" or el.get("fill") or el.get("line"):
                self.rich = True
        self.elements.append(el)

    def _links(self, part: str) -> dict[str, str]:
        return {r["id"]: r["target"] for r in self.pkg.rels(part) if r["type"].endswith("/hyperlink")}

    def frame(self, el: ET.Element, part: str, xf: _Xf, template: bool) -> None:
        g = _geom(_xfrm(el))
        if not g or template:
            return
        box = xf.box(*g)
        rels = {r["id"]: r for r in self.pkg.rels(part)}
        tbl = _first(el, "a:tbl")
        nodes: list[PMNode] = []
        size = self.default_size
        if tbl is not None:
            ctx = _Ctx(theme=self.ctx.theme, links=self._links(part), keep_colors=True, headings=False, fonts=self.fonts, base_font=self.fonts.get("body"), table_styles=self.table_styles, design=True)
            nodes = [_table(tbl, ctx)]
            size = _dominant_size(tbl) or self.default_size
        elif (ref := _first(el, "c:chart")) is not None:
            target = rels.get(ref.get(q("r:id"), ""), {}).get("target")
            nodes = _chart(self.pkg, target) if target and self.pkg.has(target) else []
            if nodes:
                # Drawn from its data table (the doc), so editing the numbers redraws it.
                kind, colors = _chart_style(self.pkg, target, self.ctx.theme)  # type: ignore[arg-type]
                self.rich = True
                el_ = {"id": self._id(), "kind": "chart", **self._box(box), "chartType": kind, "doc": {"type": "doc", "content": nodes}, "fontSize": 12.0, "color": "#000000"}
                self.elements.append({**el_, "colors": colors} if colors else el_)
                return
        elif (ids := _first(el, "dgm:relIds")) is not None:
            if self.smartart(ids, part, box):
                self.rich = True
                return
            target = rels.get(ids.get(q("r:dm"), ""), {}).get("target")
            nodes = _smartart(self.pkg, target) if target and self.pkg.has(target) else []
        if nodes:
            self.rich = True
            self.elements.append({"id": self._id(), "kind": "text", **self._box(box), "doc": {"type": "doc", "content": nodes}, "fontSize": size, "color": "#000000"})

    def smartart(self, ids: ET.Element, part: str, box: tuple[float, float, float, float]) -> bool:
        """SmartArt as drawn: PowerPoint caches the layout in a drawing part (dsp:drawing),
        linked from the data part's dataModelExt relId. Shapes there are relative to the frame."""
        rels = {r["id"]: r for r in self.pkg.rels(part)}
        data = rels.get(ids.get(q("r:dm"), ""), {}).get("target")
        if not data or not self.pkg.has(data):
            return False
        ext = next((e for e in self.pkg.xml(data).iter() if _local(e) == "dataModelExt"), None)
        drawing = rels.get(ext.get("relId", ""), {}).get("target") if ext is not None else None
        if not drawing or not self.pkg.has(drawing):
            return False
        tree = next((e for e in self.pkg.xml(drawing).iter() if _local(e) == "spTree"), None)
        before = len(self.elements)
        self.walk(tree, part, _Xf(box[0], box[1], 1, 1), template=False)
        return len(self.elements) > before


# ---- slides ----


def _offset(el: ET.Element) -> tuple[int, int] | None:
    """(y, x) of a shape's top-left corner in EMU, when the shape states it."""
    xfrm = (
        el.find(q("p:xfrm"))
        if el.tag == q("p:graphicFrame")
        else next((x for pr in (el.find(q("p:spPr")), el.find(q("p:grpSpPr"))) if pr is not None for x in [pr.find(q("a:xfrm"))] if x is not None), None)
    )
    off = xfrm.find(q("a:off")) if xfrm is not None else None
    try:
        return (int(off.get("y", "")), int(off.get("x", ""))) if off is not None else None
    except ValueError:
        return None


def _placeholder_offsets(pkg: _Package, part: str | None) -> dict[str, tuple[int, int]]:
    """Placeholder positions on a layout or master, keyed "idx:N" and "type:T"."""
    out: dict[str, tuple[int, int]] = {}
    if not part or not pkg.has(part):
        return out
    for sp in _els(pkg.xml(part), "p:sp"):
        ph = _first(sp, "p:ph")
        off = _offset(sp)
        if ph is None or off is None:
            continue
        if ph.get("idx"):
            out.setdefault(f"idx:{ph.get('idx')}", off)
        out.setdefault(f"type:{ph.get('type') or 'body'}", off)
    return out


def _parse_slide(pkg: _Package, part: str, n: int, size: tuple[int, int] = (12_192_000, 6_858_000)) -> ParsedSlide:
    slide_height = size[1]
    root = pkg.xml(part)
    slide_rels = pkg.rels(part)
    by_id = {r["id"]: r for r in slide_rels}
    ctx = _Ctx(theme=_theme_colors(pkg, part), links={r["id"]: r["target"] for r in slide_rels if r["type"].endswith("/hyperlink")})
    layout = pkg.rel(part, "slideLayout")
    inherited = [_placeholder_offsets(pkg, layout), _placeholder_offsets(pkg, pkg.rel(layout, "slideMaster") if layout else None)]
    warnings: list[str] = []
    images: list[ParsedImage] = []
    pieces: list[tuple[tuple[int, int] | None, str, list[PMNode] | int]] = []  # (position, kind, payload)
    title = ""

    def position(el: ET.Element) -> tuple[int, int] | None:
        off = _offset(el)
        ph = _first(el, "p:ph") if off is None else None
        if ph is not None:
            keys = [f"idx:{ph.get('idx')}"] if ph.get("idx") else []
            keys.append(f"type:{ph.get('type') or 'body'}")
            off = next((src[k] for src in inherited for k in keys if k in src), None)
        return off

    def text(el: ET.Element, nodes: list[PMNode]) -> None:
        if nodes:
            pieces.append((position(el), "text", nodes))

    def walk(tree: ET.Element) -> None:
        nonlocal title
        for el in list(tree):
            if el.tag == q("p:grpSp"):
                walk(el)
            elif el.tag == q("p:sp"):
                ph = _first(el, "p:ph")
                typ = (ph.get("type") or "body") if ph is not None else None
                body = _first(el, "p:txBody")
                if body is None:
                    continue
                if typ in ("title", "ctrTitle") and not title:
                    title = re.sub(r"\s+", " ", " ".join(_plain(_runs(p)) for p in _els(body, "a:p"))).strip()
                    continue
                if typ in ("sldNum", "dt", "ftr"):
                    continue  # slide chrome, not content
                text(el, _text_body(body, typ in ("body", "obj"), ctx, subtitle=typ == "subTitle"))
            elif el.tag == q("p:pic"):
                if _first(el, "a:videoFile") is not None or _first(el, "p14:media") is not None or _first(el, "a:audioFile") is not None:
                    warnings.append("Video/audio not imported")
                    continue
                blip = _first(el, "a:blip")
                embed = blip.get(q("r:embed")) if blip is not None else None
                target = by_id[embed]["target"] if embed in by_id else None
                if not target:
                    continue
                ext = target.rsplit(".", 1)[-1].lower()
                mime = MIME.get(ext)
                if not mime:
                    warnings.append(f"{ext.upper()} picture not supported (re-save it as PNG)")
                    continue
                if pkg.has(target):
                    images.append(ParsedImage(name=f"slide{n}-{posixpath.basename(target)}", data=pkg.bytes(target), mime=mime))
                    pieces.append((position(el), "image", len(images) - 1))
            elif el.tag == q("p:graphicFrame"):
                gd = _first(el, "a:graphicData")
                uri = gd.get("uri", "") if gd is not None else ""
                tbl = _first(el, "a:tbl")
                if tbl is not None:
                    text(el, [_table(tbl, ctx)])
                elif "chart" in uri:
                    ref = _first(el, "c:chart")
                    target = by_id.get(ref.get(q("r:id"), "") if ref is not None else "", {}).get("target")
                    nodes = _chart(pkg, target) if target and pkg.has(target) else []
                    text(el, nodes)
                    warnings.append("Chart imported as a table of its data" if nodes else "Chart not converted (export it as an image)")
                elif "diagram" in uri:
                    ids = _first(el, "dgm:relIds")
                    target = by_id.get(ids.get(q("r:dm"), "") if ids is not None else "", {}).get("target")
                    nodes = _smartart(pkg, target) if target and pkg.has(target) else []
                    text(el, nodes)
                    warnings.append("SmartArt imported as a list" if nodes else "SmartArt not converted")
                else:
                    warnings.append("Embedded object not converted")

    sp_tree = _first(root, "p:spTree")
    if sp_tree is not None:
        walk(sp_tree)
    if _first(root, "p:timing") is not None:
        warnings.append("Animations not preserved")
    if _first(root, "p:transition") is not None:
        warnings.append("Slide transition not preserved")
    if not title:
        warnings.append("No title on this slide")

    # Reading order: rows (shapes whose tops are within a band of each other), then left to right.
    if pieces and all(pos is not None for pos, _, _ in pieces):
        band = max(1, slide_height // 16)
        pieces = sorted(pieces, key=lambda x: (x[0][0] // band, x[0][1]))  # type: ignore[index]
    parts: list[tuple[str, list[PMNode] | int]] = []
    for _, kind, payload in pieces:
        if kind == "text" and parts and parts[-1][0] == "text":
            parts[-1][1].extend(payload)  # type: ignore[union-attr, arg-type]
        else:
            parts.append((kind, list(payload) if kind == "text" else payload))  # type: ignore[arg-type]
    content = [node for kind, payload in parts if kind == "text" for node in payload]  # type: ignore[union-attr]

    notes = ""
    notes_rel = next((r for r in slide_rels if r["type"].endswith("/notesSlide")), None)
    if notes_rel and pkg.has(notes_rel["target"]):
        nd = pkg.xml(notes_rel["target"])
        lines = []
        for sp in _els(nd, "p:sp"):
            ph = _first(sp, "p:ph")
            if ph is not None and ph.get("type") == "body":
                lines.extend(_plain(_runs(p)) for p in _els(sp, "a:p"))
        notes = "\n".join(lines).strip()

    is_header = bool(layout and pkg.has(layout) and pkg.xml(layout).get("type") == "secHead")

    designer = _Design(pkg, part, size, ctx)
    design = designer.build()
    if fonts := _theme_fonts(pkg, part):
        design["fonts"] = fonts

    text_all = f"{title}\n{doc_text({'type': 'doc', 'content': content})}".strip()
    return ParsedSlide(
        n=n, title=title, is_section_header=is_header, content=content, images=images, notes=notes, text=text_all, date=guess_date(text_all), warnings=warnings, parts=parts,
        design=design, design_images=designer.images, rich=designer.rich, look=designer.look,
    )  # fmt: skip


def deck_look(slides: list[ParsedSlide]) -> dict:
    """The deck's look for presenting: the first content slide with both a heading and body text
    (title slides are often styled differently), else the first slide."""
    full = [s.look for s in slides if {"heading", "text"} <= s.look.keys()]
    return dict(full[0] if full else (slides[0].look if slides else {}))


def parse_pptx(data: bytes, on_progress: Callable[[float], None] | None = None) -> ParsedDeck:
    """Parse a .pptx. Raises PptxError with a readable message if it isn't one."""
    pkg = _Package(data)
    if not pkg.has("ppt/presentation.xml"):
        raise PptxError("This file isn't a PowerPoint presentation (no ppt/presentation.xml). Is it a Word or Excel file?")
    try:
        pres = pkg.xml("ppt/presentation.xml")
        pres_rels = pkg.rels("ppt/presentation.xml")
        order = [{"id": s.get("id", ""), "target": next((r["target"] for r in pres_rels if r["id"] == s.get(q("r:id"))), None)} for s in _els(pres, "p:sldId")]
        section_of: dict[str, str] = {}
        for sec in _els(pres, "p14:section"):
            for sid in _els(sec, "p14:sldId"):
                section_of[sid.get("id", "")] = sec.get("name", "")
        sz = _first(pres, "p:sldSz")
        width = int(sz.get("cx", "")) if sz is not None and sz.get("cx", "").isdigit() else 12_192_000
        height = int(sz.get("cy", "")) if sz is not None and sz.get("cy", "").isdigit() else 6_858_000
        deck = ParsedDeck(has_sections=bool(section_of))
        for i, o in enumerate(order):
            t = o["target"]
            if not t or not pkg.has(t):
                continue
            s = _parse_slide(pkg, t, i + 1, (width, height))
            s.section = section_of.get(o["id"]) or None
            deck.slides.append(s)
            if on_progress:
                on_progress((i + 1) / len(order))
    except ET.ParseError as e:
        raise PptxError("Part of this presentation is damaged and couldn't be read. Re-save it from PowerPoint and try again.") from e
    if not deck.slides:
        raise PptxError("This presentation has no slides.")
    return deck
