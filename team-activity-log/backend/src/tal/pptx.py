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
    return out


def _color(fill: ET.Element | None, theme: dict[str, str]) -> str | None:
    """'#rrggbb' from a fill element's srgbClr/schemeClr/sysClr child, with lumMod/lumOff applied."""
    for c in list(fill) if fill is not None else []:
        if c.tag == q("a:srgbClr"):
            base = c.get("val", "")
        elif c.tag == q("a:schemeClr"):
            v = c.get("val", "")
            base = theme.get(_SCHEME_ALIAS.get(v, v), "")
        elif c.tag == q("a:sysClr"):
            base = c.get("lastClr", "")
        else:
            continue
        if not _HEX.match(base):
            return None
        r, g, b = (int(base[i : i + 2], 16) / 255 for i in (0, 2, 4))
        h, light, sat = colorsys.rgb_to_hls(r, g, b)
        for mod in list(c):
            val = int(mod.get("val", "0")) / 100_000 if mod.get("val", "").isdigit() else None
            if val is None:
                continue
            if mod.tag == q("a:lumMod"):
                light *= val
            elif mod.tag == q("a:lumOff"):
                light += val
        r, g, b = colorsys.hls_to_rgb(h, min(1.0, max(0.0, light)), sat)
        return "#" + "".join(f"{round(x * 255):02x}" for x in (r, g, b))
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


_SAFE_HREF = re.compile(r"^(https?://|mailto:)", re.I)
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
                color = _color(pr.find(q("a:solidFill")), ctx.theme)
                if color and _distinct(color):
                    marks.append({"type": "textStyle", "attrs": {"color": color}})
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
            heading = subtitle or (_large(p) and len(_plain(content)) <= 120)
            out.append(_block("heading", content, align, 3) if heading else _block("paragraph", content, align))
    return out


def _table(tbl: ET.Element, ctx: _Ctx | None = None) -> PMNode:
    pr = tbl.find(q("a:tblPr"))
    header = pr is None or pr.get("firstRow") == "1"
    rows = []
    for r, tr in enumerate(_els(tbl, "a:tr")):
        cells = []
        for tc in [c for c in list(tr) if c.tag == q("a:tc")]:
            if tc.get("hMerge") == "1" or tc.get("vMerge") == "1":
                continue  # covered by a neighbor's span
            paras = [_block("paragraph", _runs(p, ctx), _align(p)) for p in _els(tc, "a:p")]
            paras = [x for x in paras if x["content"]] or [{"type": "paragraph"}]
            attrs = {k: int(tc.get(a, "1")) for k, a in (("colspan", "gridSpan"), ("rowspan", "rowSpan")) if tc.get(a, "1").isdigit() and int(tc.get(a, "1")) > 1}
            cells.append({"type": "tableHeader" if header and r == 0 else "tableCell", **({"attrs": attrs} if attrs else {}), "content": paras})
        rows.append({"type": "tableRow", "content": cells})
    return {"type": "table", "content": rows}


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


def _parse_slide(pkg: _Package, part: str, n: int, slide_height: int = 6_858_000) -> ParsedSlide:
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

    text_all = f"{title}\n{doc_text({'type': 'doc', 'content': content})}".strip()
    return ParsedSlide(n=n, title=title, is_section_header=is_header, content=content, images=images, notes=notes, text=text_all, date=guess_date(text_all), warnings=warnings, parts=parts)


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
        size = _first(pres, "p:sldSz")
        height = int(size.get("cy", "")) if size is not None and size.get("cy", "").isdigit() else 6_858_000
        deck = ParsedDeck(has_sections=bool(section_of))
        for i, o in enumerate(order):
            t = o["target"]
            if not t or not pkg.has(t):
                continue
            s = _parse_slide(pkg, t, i + 1, height)
            s.section = section_of.get(o["id"]) or None
            deck.slides.append(s)
            if on_progress:
                on_progress((i + 1) / len(order))
    except ET.ParseError as e:
        raise PptxError("Part of this presentation is damaged and couldn't be read. Re-save it from PowerPoint and try again.") from e
    if not deck.slides:
        raise PptxError("This presentation has no slides.")
    return deck
