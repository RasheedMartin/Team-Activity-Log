"""Files attached to posts (owner request): any document stays with the post that shares it, with
its original downloadable and its text searchable. Stored in object storage (tal.storage),
deduplicated per org by content. Text comes from PDF (text layer), Word, Excel, CSV, and plain text;
other files are kept but only their name is searchable.
"""

from __future__ import annotations

import asyncio
import hashlib
import io
import re
import uuid
import zipfile
from xml.etree import ElementTree as ET

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from . import models as m
from . import storage
from .ids import uuid7

MAX_TEXT = 200_000  # characters of a file's text that search reads
MB = 1024 * 1024
# Per-type size limits (owner request: a limit per file).
LIMITS = {"pdf": 100 * MB, "docx": 100 * MB, "xlsx": 25 * MB, "csv": 25 * MB}
DEFAULT_LIMIT = 50 * MB
BLOCKED = {"exe", "dll", "bat", "cmd", "com", "msi", "scr", "js", "vbs", "ps1", "sh", "app", "jar"}


def ext_of(filename: str) -> str:
    return filename.rsplit(".", 1)[-1].lower() if "." in filename else ""


def limit_for(filename: str) -> int:
    return LIMITS.get(ext_of(filename), DEFAULT_LIMIT)


def key(org_id: uuid.UUID, sha: str) -> str:
    return storage.user_key("attachments", str(org_id), sha)


def _xlsx_text(data: bytes) -> str:
    """Every cell's text across sheets (shared strings and inline values), row by row."""
    z = zipfile.ZipFile(io.BytesIO(data))
    ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    shared: list[str] = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).iter(f"{ns}si"):
            shared.append("".join(t.text or "" for t in si.iter(f"{ns}t")))
    out: list[str] = []
    for name in sorted(n for n in z.namelist() if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", n)):
        for row in ET.fromstring(z.read(name)).iter(f"{ns}row"):
            cells = []
            for c in row.iter(f"{ns}c"):
                v = c.find(f"{ns}v")
                if c.get("t") == "s" and v is not None and (v.text or "").isdigit() and int(v.text) < len(shared):
                    cells.append(shared[int(v.text)])
                elif c.get("t") == "inlineStr":
                    cells.append("".join(t.text or "" for t in c.iter(f"{ns}t")))
                elif v is not None and v.text:
                    cells.append(v.text)
            if cells:
                out.append(" ".join(cells))
    return "\n".join(out)


def extract_text(data: bytes, filename: str) -> str | None:
    """Best effort: a file we can't read is still attached, just not searchable inside."""
    ext = ext_of(filename)
    try:
        if ext == "pdf":
            import pypdfium2 as pdfium

            pdf = pdfium.PdfDocument(data)
            text = "\n".join(pdf[i].get_textpage().get_text_range() or "" for i in range(len(pdf)))
        elif ext == "docx":
            from .docs import parse_docx

            text = "\n".join(f"{s.title}\n{s.text}" for s in parse_docx(data).slides)
        elif ext == "xlsx":
            text = _xlsx_text(data)
        elif ext in ("csv", "tsv", "txt", "md", "json", "log"):
            text = data.decode("utf-8", errors="replace")
        else:
            return None
    except Exception:  # noqa: BLE001 - unreadable or damaged: keep the file, skip its text
        return None
    text = re.sub(r"[ \t]+", " ", text).strip()
    return text[:MAX_TEXT] or None


async def create(db: AsyncSession, org_id: uuid.UUID, data: bytes, filename: str, mime: str, user_id: uuid.UUID) -> m.Attachment:
    sha = hashlib.sha256(data).hexdigest()
    found = (await db.execute(select(m.Attachment).where(m.Attachment.org_id == org_id, m.Attachment.sha256 == sha))).scalar_one_or_none()
    if found:
        return found
    await storage.put_key(db, key(org_id, sha), mime or "application/octet-stream", data)
    text = await asyncio.to_thread(extract_text, data, filename)
    a = m.Attachment(id=uuid7(), org_id=org_id, sha256=sha, filename=filename, mime=mime or "application/octet-stream", bytes=len(data), text=text, created_by=user_id)
    db.add(a)
    await db.flush()
    return a


def view(a: m.Attachment) -> dict:
    return {"id": str(a.id), "filename": a.filename, "mime": a.mime, "bytes": a.bytes, "searchable": bool(a.text), "url": f"/v1/orgs/{a.org_id}/attachments/{a.id}"}


def block_attachment_ids(blocks: list | None) -> list[str]:
    return [b["attachmentId"] for b in blocks or [] if isinstance(b, dict) and b.get("type") == "file" and b.get("attachmentId")]
