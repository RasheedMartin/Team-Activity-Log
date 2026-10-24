"""Image intake (§B7): content-hash dedupe per org, real dimensions and dominant color, resized
variants, bytes stored in Postgres (asset_blobs). Same behavior as frontend/src/mock/assets.ts,
minus the canned OCR: real OCR is a later worker (ocrState "none" until then).
"""

from __future__ import annotations

import hashlib
import io
import re
import uuid
from xml.etree import ElementTree as ET

from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from . import models as m
from . import storage
from .errors import fail
from .ids import uuid7
from .timeutil import now

ALLOWED = {"image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"}
VARIANTS = (("thumb", 320), ("small", 640), ("medium", 1280))
Image.MAX_IMAGE_PIXELS = 80_000_000  # decompression-bomb guard


def guess_type(filename: str, mime: str) -> str:
    f = filename.lower()
    if re.search(r"screen ?shot|capture|screenshot", f):
        return "screenshot"
    if re.search(r"diagram|schematic|layout", f):
        return "diagram"
    if mime == "image/jpeg" or re.search(r"img_|dsc|photo", f):
        return "photo"
    return "chart"


def _svg_size(data: bytes) -> tuple[int, int]:
    try:
        root = ET.fromstring(data)
    except ET.ParseError:
        fail(415, "unsupported_type", "This SVG couldn't be read")
    num = lambda v: float(re.match(r"[\d.]+", v or "")[0]) if v and re.match(r"[\d.]+", v) else None  # noqa: E731
    w, h = num(root.get("width")), num(root.get("height"))
    if (not w or not h) and root.get("viewBox"):
        parts = [float(x) for x in re.split(r"[\s,]+", root.get("viewBox", "").strip()) if x]
        if len(parts) == 4:
            w, h = parts[2], parts[3]
    return int(w or 800), int(h or 600)


def _sniff(data: bytes) -> str | None:
    """Trust the bytes, not the client's MIME claim."""
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    head = data[:512].lstrip().lower()
    if head.startswith(b"<?xml") or head.startswith(b"<svg") or b"<svg" in head:
        return "image/svg+xml"
    return None


async def create_asset(
    db: AsyncSession, org_id: uuid.UUID, data: bytes, filename: str, source_kind: str, user_id: uuid.UUID | None = None, ocr_text: str | None = None
) -> tuple[m.Asset, bool]:
    """Create (or reuse, by content hash within the org) an image asset. Returns (asset, created)."""
    sha = hashlib.sha256(data).hexdigest()
    existing = (await db.execute(select(m.Asset).where(m.Asset.org_id == org_id, m.Asset.sha256 == sha))).scalar_one_or_none()
    if existing:
        return existing, False
    mime = _sniff(data)
    if mime not in ALLOWED:
        fail(415, "unsupported_type", "Only PNG, JPEG, GIF, WebP, and SVG images are supported")

    asset_id = uuid7()
    blobs: list[tuple[str, str, bytes]] = [("original", mime, data)]
    color = "#808080"
    exif: dict | None = None
    if mime == "image/svg+xml":
        width, height = _svg_size(data)
        variants = [{"name": n, "width": min(w, width), "height": round(height * min(w, width) / width)} for n, w in VARIANTS]
    else:
        try:
            img = Image.open(io.BytesIO(data))
            img.load()
        except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
            fail(415, "unsupported_type", "This image couldn't be read")
        try:
            raw_exif = img.getexif()
            taken = raw_exif.get(0x0132) or raw_exif.get_ifd(0x8769).get(0x9003)
            make, model = raw_exif.get(0x010F), raw_exif.get(0x0110)
            if taken or make or model:
                exif = {k: v for k, v in {"capturedAt": _exif_time(taken), "cameraMake": make, "cameraModel": model}.items() if v}
        except Exception:  # noqa: BLE001 - EXIF is best effort
            exif = None
        img = ImageOps.exif_transpose(img)  # also drops orientation (and GPS) from what we serve
        width, height = img.size
        rgb = img.convert("RGB")
        r, g, b = rgb.resize((1, 1), Image.Resampling.BOX).getpixel((0, 0))  # type: ignore[misc]
        color = f"#{r:02x}{g:02x}{b:02x}"
        variants = []
        for name, w in VARIANTS:
            vw = min(w, width)
            vh = round(height * vw / width)
            variants.append({"name": name, "width": vw, "height": vh})
            if vw < width:
                out = io.BytesIO()
                small = (rgb if mime == "image/jpeg" else img.convert("RGBA")).resize((vw, vh), Image.Resampling.LANCZOS)
                fmt, vmime = ("JPEG", "image/jpeg") if mime == "image/jpeg" else ("PNG", "image/png")
                small.save(out, fmt, **({"quality": 85} if fmt == "JPEG" else {"optimize": True}))
                blobs.append((name, vmime, out.getvalue()))
    variants.append({"name": "original", "width": width, "height": height})
    detected = guess_type(filename, mime)
    meta: dict = {"ocrState": "ready" if ocr_text else "none", "detectedType": detected, "sourceKind": source_kind}
    if ocr_text:
        meta["ocrText"] = ocr_text
    if exif:
        meta["exif"] = exif
    asset = m.Asset(
        id=asset_id,
        org_id=org_id,
        mime=mime,
        bytes=len(data),
        width=width,
        height=height,
        sha256=sha,
        original_filename=filename,
        dominant_colors=[color],
        processing="ready",
        metadata_=meta,
        variants=variants,
        created_by=user_id,
        created_at=now(),
    )
    # Two uploads of the same picture can race; the loser reuses the winner's asset.
    try:
        async with db.begin_nested():
            db.add(asset)
            await db.flush()
    except IntegrityError:
        winner = (await db.execute(select(m.Asset).where(m.Asset.org_id == org_id, m.Asset.sha256 == sha))).scalar_one()
        return winner, False
    for variant, vmime, vdata in blobs:
        await storage.put(db, org_id, asset_id, variant, vmime, vdata)
    await db.flush()
    return asset, True


def _exif_time(v: object) -> str | None:
    if not isinstance(v, str):
        return None
    mt = re.match(r"(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})", v)
    return f"{mt[1]}-{mt[2]}-{mt[3]}T{mt[4]}:{mt[5]}:{mt[6]}.000Z" if mt else None
