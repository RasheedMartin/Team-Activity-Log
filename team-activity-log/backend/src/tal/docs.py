"""Document import (owner request): PDF and Word files become notebooks, through the same review and
commit flow as slides (tal.routes.imports). Each parser returns a ParsedDeck whose "slides" are the
document's units: PDF pages, or Word heading sections.

- PDF: each page is kept as a picture of the page (layout exactly as authored), with the page's
  text attached as that picture's text, so search finds it without OCR. A scanned page has no text
  layer: its picture goes to the OCR worker like any image. Bookmarks become sections.
- Word (.docx): headings split the document into pages; paragraphs (bold, italic, links), lists,
  tables, and pictures come across as editable text. Read with the standard library, like .pptx.
"""

from __future__ import annotations

import io
import re
import zipfile
from collections.abc import Callable
from xml.etree import ElementTree as ET

from .pptx import ParsedDeck, ParsedImage, ParsedSlide
from .prosemirror import PMNode, heading, text_node

PDF_SCALE_WIDTH = 1600  # page pictures, in pixels across


class DocumentError(ValueError):
    pass


def _lines(text: str) -> list[str]:
    return [re.sub(r"\s+", " ", ln).strip() for ln in text.replace("\r", "\n").splitlines() if ln.strip()]


def parse_pdf(data: bytes, on_progress: Callable[[float], None] | None = None) -> ParsedDeck:
    import pypdfium2 as pdfium

    try:
        pdf = pdfium.PdfDocument(data)
    except Exception as e:  # noqa: BLE001 - pdfium raises its own error types
        raise DocumentError("This isn't a readable PDF (it may be damaged or password-protected)") from e
    n = len(pdf)
    if not n:
        raise DocumentError("This PDF has no pages")
    # Top-level bookmarks name sections: each page belongs to the last one at or before it.
    marks: list[tuple[int, str]] = []
    for bm in pdf.get_toc(max_depth=2):
        dest = bm.get_dest()
        idx = dest.get_index() if dest else None
        title = (bm.get_title() or "").strip()
        if bm.level == 0 and idx is not None and title:
            marks.append((idx, title[:200]))
    marks.sort()
    deck = ParsedDeck(has_sections=bool(marks))
    for i in range(n):
        page = pdf[i]
        text = page.get_textpage().get_text_range() or ""
        lines = _lines(text)
        w = page.get_width() or 1
        bitmap = page.render(scale=PDF_SCALE_WIDTH / w)
        out = io.BytesIO()
        bitmap.to_pil().convert("RGB").save(out, "PNG", optimize=True)
        warnings = [] if lines else ["No text layer (a scan?): its text will be read from the picture"]
        section = next((t for at, t in reversed(marks) if at <= i), None)
        title = (lines[0][:200] if lines else "") or f"Page {i + 1}"
        deck.slides.append(
            ParsedSlide(
                n=i + 1,
                title=title,
                is_section_header=False,
                content=[],
                images=[ParsedImage(name=f"page-{i + 1}.png", data=out.getvalue(), mime="image/png", text="\n".join(lines) or None)],
                notes="",
                text="\n".join(lines),
                date=None,
                warnings=warnings,
                section=section,
                parts=[("image", 0)],
            )
        )
        if on_progress:
            on_progress((i + 1) / n)
    return deck


# ---------------------------------------------------------------- Word

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
A = "http://schemas.openxmlformats.org/drawingml/2006/main"
REL = "http://schemas.openxmlformats.org/package/2006/relationships"


def _w(tag: str) -> str:
    return f"{{{W}}}{tag}"


def _style_names(z: zipfile.ZipFile) -> dict[str, str]:
    try:
        root = ET.fromstring(z.read("word/styles.xml"))
    except KeyError:
        return {}
    out = {}
    for st in root.iter(_w("style")):
        sid = st.get(_w("styleId")) or ""
        name = st.find(_w("name"))
        out[sid] = (name.get(_w("val")) if name is not None else sid) or sid
    return out


def _heading_level(style: str) -> int | None:
    s = style.lower().replace(" ", "")
    if s == "title":
        return 1
    m = re.fullmatch(r"heading([1-6])", s)
    return int(m.group(1)) if m else None


def _runs(p: ET.Element, links: dict[str, str]) -> list[PMNode]:
    out: list[PMNode] = []

    def run(r: ET.Element, href: str | None) -> None:
        props = r.find(_w("rPr"))
        marks: list[dict] = []
        if props is not None:
            if props.find(_w("b")) is not None and props.find(_w("b")).get(_w("val")) not in ("0", "false"):
                marks.append({"type": "bold"})
            if props.find(_w("i")) is not None and props.find(_w("i")).get(_w("val")) not in ("0", "false"):
                marks.append({"type": "italic"})
        if href:
            marks.append({"type": "link", "attrs": {"href": href}})
        for child in r:
            if child.tag == _w("t") and child.text:
                out.append(text_node(child.text, marks or None))
            elif child.tag == _w("tab"):
                out.append(text_node("\t", marks or None))
            elif child.tag in (_w("br"), _w("cr")):
                out.append({"type": "hardBreak"})

    for child in p:
        if child.tag == _w("r"):
            run(child, None)
        elif child.tag == _w("hyperlink"):
            target = links.get(child.get(f"{{{R}}}id") or "")
            for r in child.iter(_w("r")):
                run(r, target if target and target.startswith(("http://", "https://", "mailto:")) else None)
    return out


def parse_docx(data: bytes, on_progress: Callable[[float], None] | None = None) -> ParsedDeck:
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
        body = ET.fromstring(z.read("word/document.xml")).find(_w("body"))
    except (zipfile.BadZipFile, KeyError, ET.ParseError) as e:
        raise DocumentError("This isn't a valid .docx file") from e
    if body is None:
        raise DocumentError("This document is empty")
    styles = _style_names(z)
    rels: dict[str, str] = {}
    try:
        for r in ET.fromstring(z.read("word/_rels/document.xml.rels")).iter(f"{{{REL}}}Relationship"):
            rels[r.get("Id") or ""] = r.get("Target") or ""
    except KeyError:
        pass

    # Walk the body into blocks: ("heading", level, text) | ("nodes", [PMNode]) | ("image", ParsedImage).
    blocks: list[tuple] = []
    list_items: list[PMNode] = []

    def flush_list() -> None:
        if list_items:
            blocks.append(("nodes", [{"type": "bulletList", "content": list(list_items)}]))
            list_items.clear()

    for el in list(body):
        if el.tag == _w("p"):
            ppr = el.find(_w("pPr"))
            style = ""
            if ppr is not None and ppr.find(_w("pStyle")) is not None:
                style = styles.get(ppr.find(_w("pStyle")).get(_w("val")) or "", "")
            for blip in el.iter(f"{{{A}}}blip"):
                target = rels.get(blip.get(f"{{{R}}}embed") or "", "")
                path = "word/" + target.lstrip("/").removeprefix("word/") if target else ""
                try:
                    img = z.read(path)
                except KeyError:
                    continue
                ext = path.rsplit(".", 1)[-1].lower()
                if ext in ("png", "jpg", "jpeg", "gif", "webp"):
                    flush_list()
                    blocks.append(("image", ParsedImage(name=path.rsplit("/", 1)[-1], data=img, mime=f"image/{'jpeg' if ext == 'jpg' else ext}")))
            content = _runs(el, rels)
            text = "".join(n.get("text", "") for n in content).strip()
            level = _heading_level(style)
            if level and text:
                flush_list()
                blocks.append(("heading", level, text))
            elif ppr is not None and ppr.find(_w("numPr")) is not None and text:
                list_items.append({"type": "listItem", "content": [{"type": "paragraph", "content": content}]})
            elif text:
                flush_list()
                blocks.append(("nodes", [{"type": "paragraph", "content": content}]))
        elif el.tag == _w("tbl"):
            flush_list()
            rows = []
            for tr in el.iter(_w("tr")):
                cells = []
                for tc in tr.findall(_w("tc")):
                    paras = [{"type": "paragraph", "content": c} if (c := _runs(p, rels)) else {"type": "paragraph"} for p in tc.findall(_w("p"))] or [{"type": "paragraph"}]
                    cells.append({"type": "tableHeader" if not rows else "tableCell", "content": paras})
                if cells:
                    rows.append({"type": "tableRow", "content": cells})
            if rows:
                blocks.append(("nodes", [{"type": "table", "content": rows}]))
    flush_list()

    # Split into pages at the top heading level used (Title/Heading 1, else Heading 2, …).
    levels = sorted({b[1] for b in blocks if b[0] == "heading"})
    split = levels[0] if levels else None
    units: list[dict] = [{"title": "", "parts": [], "images": [], "texts": []}]
    for b in blocks:
        if b[0] == "heading" and b[1] == split:
            units.append({"title": b[2][:200], "parts": [], "images": [], "texts": []})
            continue
        u = units[-1]
        if b[0] == "image":
            u["images"].append(b[1])
            u["parts"].append(("image", len(u["images"]) - 1))
        else:
            nodes = [heading(b[2], min(4, max(2, b[1] - (split or 0) + 2)))] if b[0] == "heading" else b[1]
            if u["parts"] and u["parts"][-1][0] == "text":
                u["parts"][-1][1].extend(nodes)  # adjacent text merges into one block
            else:
                u["parts"].append(("text", list(nodes)))
            u["texts"].append(" ".join(_plain(n) for n in nodes))
    units = [u for u in units if u["parts"] or u["title"]]
    if not units:
        raise DocumentError("No text or pictures found in this document")
    deck = ParsedDeck()
    for i, u in enumerate(units):
        text = "\n".join(t for t in u["texts"] if t)
        title = u["title"] or (_lines(text)[0][:200] if text else f"Part {i + 1}")
        deck.slides.append(
            ParsedSlide(n=i + 1, title=title, is_section_header=False, content=[], images=u["images"], notes="", text=text, date=None, warnings=[], parts=u["parts"])
        )
        if on_progress:
            on_progress((i + 1) / len(units))
    return deck


def _plain(node: PMNode) -> str:
    if node.get("type") == "text":
        return node.get("text", "")
    return " ".join(_plain(c) for c in node.get("content", []) or [])


PARSERS = {"pdf": parse_pdf, "docx": parse_docx}
