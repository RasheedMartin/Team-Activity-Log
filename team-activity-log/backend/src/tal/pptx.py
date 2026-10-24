"""Read a .pptx into slides (port of frontend/src/mock/pptx.ts; the rules are the import spec).

A .pptx is a zip of OOXML parts:

    order      ppt/presentation.xml <p:sldIdLst>, resolved through presentation.xml.rels
    sections   <p14:sectionLst> in presentation.xml extLst (PowerPoint "Sections")
    title      the shape whose placeholder type is "title" or "ctrTitle"
    text       every other text shape, in z-order; bulleted when it is a body/object placeholder
               or a paragraph has <a:buChar>/<a:buAutoNum>; bold/italic/underline kept
    tables     <a:tbl> inside a graphicFrame -> table block
    pictures   <p:pic> -> <a:blip r:embed> -> slide rels -> ppt/media/* (PNG/JPEG/GIF/SVG/WebP)
    notes      the slide's notesSlide part, body placeholder text
    headers    slides whose layout type is "secHead" start a section when no Sections exist
    warnings   charts, SmartArt, EMF/WMF pictures, video/audio, animations, transitions,
               slides without a title

Pure standard library (zipfile + ElementTree), so it runs anywhere without system packages.
"""

from __future__ import annotations

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
}
MIME = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif", "svg": "image/svg+xml", "webp": "image/webp"}
MAX_PARTS = 5000  # zip-bomb guard: a real deck has far fewer parts


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
            raise PptxError(
                "This file isn't a valid .pptx (it couldn't be opened as a PowerPoint package). Re-save it from PowerPoint and try again."
            ) from e
        if len(names) > MAX_PARTS:
            raise PptxError("This file has too many parts to be a presentation.")
        self.names = set(names)

    def has(self, part: str) -> bool:
        return part in self.names

    def xml(self, part: str) -> ET.Element:
        return ET.fromstring(self.zip.read(part))

    def bytes(self, part: str) -> bytes:
        return self.zip.read(part)

    def rels(self, part: str) -> list[dict[str, str]]:
        rel_part = posixpath.join(posixpath.dirname(part), "_rels", posixpath.basename(part) + ".rels")
        if not self.has(rel_part):
            return []
        return [
            {"id": r.get("Id", ""), "type": r.get("Type", ""), "target": _resolve(part, r.get("Target", ""))}
            for r in self.xml(rel_part).iter(f"{{{NS['rel']}}}Relationship")
        ]


# ---- text ----


def _runs(p: ET.Element) -> list[PMNode]:
    out: list[PMNode] = []
    for c in list(p):
        if c.tag in (q("a:r"), q("a:fld")):
            t_el = _first(c, "a:t")
            t = t_el.text if t_el is not None and t_el.text else ""
            if not t:
                continue
            pr = _first(c, "a:rPr")
            marks: list[dict] = []
            if pr is not None and pr.get("b") == "1":
                marks.append({"type": "bold"})
            if pr is not None and pr.get("i") == "1":
                marks.append({"type": "italic"})
            u = pr.get("u") if pr is not None else None
            if u and u != "none":
                marks.append({"type": "underline"})
            out.append({"type": "text", "text": t, **({"marks": marks} if marks else {})})
        elif c.tag == q("a:br"):
            out.append({"type": "hardBreak"})
    return out


def _plain(nodes: list[PMNode]) -> str:
    return "".join("\n" if n["type"] == "hardBreak" else n.get("text", "") for n in nodes)


def _text_body(body: ET.Element, bulleted: bool) -> list[PMNode]:
    out: list[PMNode] = []
    lst: PMNode | None = None
    for p in _els(body, "a:p"):
        content = _runs(p)
        if not _plain(content).strip():
            lst = None
            continue
        ppr = _first(p, "a:pPr")
        explicit = ppr is not None and (_first(ppr, "a:buChar") is not None or _first(ppr, "a:buAutoNum") is not None)
        no_bullet = ppr is not None and _first(ppr, "a:buNone") is not None
        if (bulleted or explicit) and not no_bullet:
            if lst is None:
                lst = {"type": "bulletList", "content": []}
                out.append(lst)
            lst["content"].append({"type": "listItem", "content": [{"type": "paragraph", "content": content}]})
        else:
            lst = None
            out.append({"type": "paragraph", "content": content})
    return out


def _table(tbl: ET.Element) -> PMNode:
    rows = []
    for r, tr in enumerate(_els(tbl, "a:tr")):
        cells = []
        for tc in [c for c in list(tr) if c.tag == q("a:tc")]:
            p = _first(tc, "a:p")
            cells.append({"type": "tableHeader" if r == 0 else "tableCell", "content": [{"type": "paragraph", "content": _runs(p if p is not None else tc)}]})
        rows.append({"type": "tableRow", "content": cells})
    return {"type": "table", "content": rows}


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


def _parse_slide(pkg: _Package, part: str, n: int) -> ParsedSlide:
    root = pkg.xml(part)
    slide_rels = pkg.rels(part)
    warnings: list[str] = []
    content: list[PMNode] = []
    images: list[ParsedImage] = []
    title = ""

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
                content.extend(_text_body(body, typ in ("body", "obj")))
            elif el.tag == q("p:pic"):
                if _first(el, "a:videoFile") is not None or _first(el, "p14:media") is not None or _first(el, "a:audioFile") is not None:
                    warnings.append("Video/audio not imported")
                    continue
                blip = _first(el, "a:blip")
                embed = blip.get(q("r:embed")) if blip is not None else None
                target = next((r["target"] for r in slide_rels if r["id"] == embed), None)
                if not target:
                    continue
                ext = target.rsplit(".", 1)[-1].lower()
                mime = MIME.get(ext)
                if not mime:
                    warnings.append(f"{ext.upper()} picture not supported (re-save it as PNG)")
                    continue
                if pkg.has(target):
                    images.append(ParsedImage(name=f"slide{n}-{posixpath.basename(target)}", data=pkg.bytes(target), mime=mime))
            elif el.tag == q("p:graphicFrame"):
                gd = _first(el, "a:graphicData")
                uri = gd.get("uri", "") if gd is not None else ""
                tbl = _first(el, "a:tbl")
                if tbl is not None:
                    content.append(_table(tbl))
                elif "chart" in uri:
                    warnings.append("Chart not converted (export it as an image)")
                elif "diagram" in uri:
                    warnings.append("SmartArt not converted")
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

    is_header = False
    layout_rel = next((r for r in slide_rels if r["type"].endswith("/slideLayout")), None)
    if layout_rel and pkg.has(layout_rel["target"]):
        is_header = pkg.xml(layout_rel["target"]).get("type") == "secHead"

    text = f"{title}\n{doc_text({'type': 'doc', 'content': content})}".strip()
    return ParsedSlide(n=n, title=title, is_section_header=is_header, content=content, images=images, notes=notes, text=text, date=guess_date(text), warnings=warnings)


def parse_pptx(data: bytes, on_progress: Callable[[float], None] | None = None) -> ParsedDeck:
    """Parse a .pptx. Raises PptxError with a readable message if it isn't one."""
    pkg = _Package(data)
    if not pkg.has("ppt/presentation.xml"):
        raise PptxError("This file isn't a PowerPoint presentation (no ppt/presentation.xml). Is it a Word or Excel file?")
    try:
        pres = pkg.xml("ppt/presentation.xml")
        pres_rels = pkg.rels("ppt/presentation.xml")
        order = [
            {"id": s.get("id", ""), "target": next((r["target"] for r in pres_rels if r["id"] == s.get(q("r:id"))), None)}
            for s in _els(pres, "p:sldId")
        ]
        section_of: dict[str, str] = {}
        for sec in _els(pres, "p14:section"):
            for sid in _els(sec, "p14:sldId"):
                section_of[sid.get("id", "")] = sec.get("name", "")
        deck = ParsedDeck(has_sections=bool(section_of))
        for i, o in enumerate(order):
            t = o["target"]
            if not t or not pkg.has(t):
                continue
            s = _parse_slide(pkg, t, i + 1)
            s.section = section_of.get(o["id"]) or None
            deck.slides.append(s)
            if on_progress:
                on_progress((i + 1) / len(order))
    except ET.ParseError as e:
        raise PptxError("Part of this presentation is damaged and couldn't be read. Re-save it from PowerPoint and try again.") from e
    if not deck.slides:
        raise PptxError("This presentation has no slides.")
    return deck
