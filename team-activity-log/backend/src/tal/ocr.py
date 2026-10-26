"""Text in images (OCR): read the words in every uploaded or imported picture, so search finds them.

- Engine: Tesseract, built in and on by default (runs on this server; images never leave it). On
  Business and Enterprise an org can switch to a cloud engine with its own key: Google Cloud
  Vision, Azure AI Vision, or AWS Textract (better on photos and handwriting). Keys are stored
  encrypted (Organization.ocr_secret) and never sent back to the browser.
- Flow: intake marks a new asset's ocrState "pending" (tal.images); the OCR worker (run_ocr,
  started with the indexer) reads it, stores ocrText / ocrEngine, and queues the posts that show
  the picture for reindexing. States: pending → running → ready (text found) | empty | failed;
  "edited" when a person corrected the text (never overwritten by a re-read).
- Missing Tesseract binary (e.g. a dev laptop): assets stay pending until it's installed.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import io
import json
import logging
import re
import shutil
import uuid
from datetime import timedelta
from typing import Any

import httpx
from PIL import Image, ImageDraw, ImageFont, ImageOps
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from . import models as m
from . import outbox, plans, storage
from .config import get_settings
from .timeutil import iso, now

log = logging.getLogger("tal.ocr")

PROVIDERS: dict[str, dict[str, Any]] = {
    "tesseract": {"name": "Built-in (Tesseract)", "cloud": False, "fields": []},
    "google": {"name": "Google Cloud Vision", "cloud": True, "fields": ["apiKey"]},
    "azure": {"name": "Azure AI Vision", "cloud": True, "fields": ["endpoint", "apiKey"]},
    "aws": {"name": "AWS Textract", "cloud": True, "fields": ["accessKeyId", "secretAccessKey", "region"]},
}
MAX_TEXT = 20_000  # characters kept per image
STALE = timedelta(minutes=10)  # a "running" image older than this is retried (worker restarted)


class OcrError(Exception):
    pass


# ---------------------------------------------------------------- secrets


def _fernet():
    from cryptography.fernet import Fernet

    s = get_settings()
    secret = s.secret_key or ("dev-only-secret" if s.env != "production" else None)
    if not secret:
        raise OcrError("Set SECRET_KEY on the server before saving a cloud OCR key")
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(secret.encode()).digest()))


def seal(creds: dict[str, str]) -> str:
    return _fernet().encrypt(json.dumps(creds).encode()).decode()


def unseal(token: str | None) -> dict[str, dict[str, str]]:
    """{provider: {field: value}} for every cloud engine the org has a key for."""
    if not token:
        return {}
    try:
        return json.loads(_fernet().decrypt(token.encode()))
    except Exception:  # noqa: BLE001 - a rotated SECRET_KEY makes old keys unreadable: treat as unset
        log.warning("couldn't decrypt an org's OCR keys (SECRET_KEY changed?)")
        return {}


def hint(value: str) -> str:
    return f"…{value[-4:]}" if len(value) > 6 else "set"


# ---------------------------------------------------------------- choosing the engine


def cloud_allowed(org: m.Organization) -> bool:
    return plans.plan_of(org).cloud_ocr


def provider_of(org: m.Organization) -> str:
    """The engine this org's images go to: its cloud choice if its plan and key allow, else Tesseract."""
    chosen = ((org.settings or {}).get("ocr") or {}).get("provider", "tesseract")
    if chosen != "tesseract" and (not cloud_allowed(org) or chosen not in unseal(org.ocr_secret)):
        return "tesseract"
    return chosen if chosen in PROVIDERS else "tesseract"


def tesseract_available() -> bool:
    return shutil.which(get_settings().tesseract_cmd) is not None


# ---------------------------------------------------------------- engines


def _prepare(data: bytes, max_side: int, max_bytes: int, min_width: int = 0) -> bytes:
    """A clean RGB image the engines accept: upright, not huge, small ones enlarged (Tesseract reads
    text best at roughly 30px letters), as PNG unless that's too big, then JPEG."""
    img = ImageOps.exif_transpose(Image.open(io.BytesIO(data)))
    img = img.convert("RGBA")
    flat = Image.new("RGB", img.size, "white")  # transparent → white, not black
    flat.paste(img, mask=img.getchannel("A"))
    w, h = flat.size
    scale = min(max_side / max(w, h), 1.0)
    if min_width and w < min_width:
        scale = min(min_width / w, 3.0, max_side / max(w, h))
    if scale != 1.0:
        flat = flat.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.Resampling.LANCZOS)
    out = io.BytesIO()
    flat.save(out, "PNG", optimize=True)
    if out.tell() <= max_bytes:
        return out.getvalue()
    for q in (90, 80, 70):
        out = io.BytesIO()
        flat.save(out, "JPEG", quality=q)
        if out.tell() <= max_bytes:
            return out.getvalue()
    raise OcrError("Image too large to read")


async def _tesseract(data: bytes, _: dict[str, str]) -> str:
    s = get_settings()
    if not tesseract_available():
        raise OcrError("Tesseract isn't installed on this server")
    png = _prepare(data, 4000, 50_000_000, min_width=1400)
    proc = await asyncio.create_subprocess_exec(s.tesseract_cmd, "stdin", "stdout", "-l", s.ocr_languages, "--psm", "3", stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    try:
        out, err = await asyncio.wait_for(proc.communicate(png), timeout=120)
    except TimeoutError:
        proc.kill()
        raise OcrError("Tesseract took too long") from None
    if proc.returncode:
        raise OcrError(f"Tesseract failed: {err.decode(errors='replace').strip()[:200]}")
    return out.decode(errors="replace")


async def _google(data: bytes, c: dict[str, str]) -> str:
    body = {"requests": [{"image": {"content": base64.b64encode(_prepare(data, 4000, 10_000_000)).decode()}, "features": [{"type": "DOCUMENT_TEXT_DETECTION"}]}]}
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.post("https://vision.googleapis.com/v1/images:annotate", params={"key": c["apiKey"]}, json=body)
    j = r.json() if r.content else {}
    err = (j.get("error") or (j.get("responses") or [{}])[0].get("error") or {}).get("message")
    if r.status_code >= 400 or err:
        raise OcrError(f"Google Cloud Vision: {err or r.status_code}")
    return ((j.get("responses") or [{}])[0].get("fullTextAnnotation") or {}).get("text", "")


async def _azure(data: bytes, c: dict[str, str]) -> str:
    url = c["endpoint"].rstrip("/") + "/computervision/imageanalysis:analyze"
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.post(url, params={"features": "read", "api-version": "2024-02-01"}, headers={"Ocp-Apim-Subscription-Key": c["apiKey"], "Content-Type": "application/octet-stream"}, content=_prepare(data, 10_000, 20_000_000))
    j = r.json() if r.content else {}
    if r.status_code >= 400:
        raise OcrError(f"Azure AI Vision: {(j.get('error') or {}).get('message') or r.status_code}")
    blocks = ((j.get("readResult") or {}).get("blocks")) or []
    return "\n".join(line.get("text", "") for b in blocks for line in b.get("lines", []))


async def _aws(data: bytes, c: dict[str, str]) -> str:
    import boto3
    from botocore.exceptions import BotoCoreError, ClientError

    def call() -> str:
        client = boto3.client("textract", region_name=c["region"], aws_access_key_id=c["accessKeyId"], aws_secret_access_key=c["secretAccessKey"])
        res = client.detect_document_text(Document={"Bytes": _prepare(data, 10_000, 5_000_000)})
        return "\n".join(b["Text"] for b in res.get("Blocks", []) if b.get("BlockType") == "LINE")

    try:
        return await asyncio.to_thread(call)
    except (BotoCoreError, ClientError) as e:
        raise OcrError(f"AWS Textract: {e}") from None


ENGINES = {"tesseract": _tesseract, "google": _google, "azure": _azure, "aws": _aws}


def clean(text: str) -> str:
    """Trim each line, drop blank runs and lines that are only stray marks (OCR noise)."""
    lines = [re.sub(r"\s+", " ", ln).strip() for ln in text.splitlines()]
    kept = [ln for ln in lines if re.search(r"[\w]", ln)]
    return "\n".join(kept)[:MAX_TEXT]


async def read(provider: str, data: bytes, creds: dict[str, str]) -> str:
    return clean(await ENGINES[provider](data, creds))


def sample_image() -> bytes:
    """A picture with known words, to check a key works before saving it."""
    img = Image.new("RGB", (900, 220), "white")
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.load_default(size=72)
    except TypeError:  # very old Pillow without sized default font
        font = ImageFont.load_default()
    draw.text((40, 60), "Detector 42 OK", fill="black", font=font)
    out = io.BytesIO()
    img.save(out, "PNG")
    return out.getvalue()


async def check(provider: str, creds: dict[str, str]) -> None:
    """Raise OcrError with the engine's own message unless it reads the sample."""
    text = await read(provider, sample_image(), creds)
    if "42" not in text:
        raise OcrError(f"{PROVIDERS[provider]['name']} answered but didn't read the test image")


# ---------------------------------------------------------------- state on assets


def set_state(asset: m.Asset, state: str, **fields: Any) -> None:
    meta = dict(asset.metadata_ or {})
    meta["ocrState"] = state
    for k, v in fields.items():
        if v is None:
            meta.pop(k, None)
        else:
            meta[k] = v
    asset.metadata_ = meta  # reassign: JSONB changes in place aren't tracked


async def reindex_posts_with(db: AsyncSession, asset: m.Asset) -> None:
    ids = (await db.execute(select(m.ImageInstance.post_id).where(m.ImageInstance.asset_id == asset.id, m.ImageInstance.post_id.is_not(None)).distinct())).scalars().all()
    if ids:
        outbox.enqueue(db, asset.org_id, ids)


_state = m.Asset.metadata_["ocrState"].astext


async def requeue(db: AsyncSession, org_id: uuid.UUID, which: str) -> int:
    """Re-read the org's images: "failed" ones, or "all" (except text people corrected)."""
    states = ["failed"] if which == "failed" else ["failed", "ready", "empty", "none"]
    if which != "failed":
        states.append("pending")
    assets = (await db.execute(select(m.Asset).where(m.Asset.org_id == org_id, or_(_state.in_(states), _state.is_(None))))).scalars().all()
    for a in assets:
        set_state(a, "pending", ocrError=None)
    return len(assets)


async def stats(db: AsyncSession, org_id: uuid.UUID) -> dict[str, int]:
    from sqlalchemy import func

    rows = await db.execute(select(_state, func.count()).where(m.Asset.org_id == org_id).group_by(_state))
    return {(k or "none"): n for k, n in rows}


# ---------------------------------------------------------------- worker

_warned_missing = False


async def ocr_once(limit: int = 4) -> int:
    """Claim a few pending images, read them, store the text. Returns how many were handled."""
    global _warned_missing
    from .db import sessionmaker

    async with sessionmaker()() as db:
        # Retry images a crashed worker left "running".
        stale = (await db.execute(select(m.Asset).where(_state == "running").limit(50))).scalars().all()
        for a in stale:
            started = (a.metadata_ or {}).get("ocrStartedAt")
            if not started or started < iso(now() - STALE):
                set_state(a, "pending")
        claimed = (await db.execute(select(m.Asset).where(_state == "pending").order_by(m.Asset.created_at).limit(limit).with_for_update(skip_locked=True))).scalars().all()
        orgs = {a.org_id: await db.get(m.Organization, a.org_id) for a in claimed}
        work = []
        for a in claimed:
            org = orgs[a.org_id]
            provider = provider_of(org) if org else "tesseract"
            if provider == "tesseract" and not tesseract_available():
                if not _warned_missing:
                    log.warning("OCR is waiting: Tesseract isn't installed (images stay pending until it is)")
                    _warned_missing = True
                continue
            set_state(a, "running", ocrStartedAt=iso(now()))
            work.append((a.id, a.org_id, provider, unseal(org.ocr_secret).get(provider, {}) if org else {}))
        await db.commit()

    for asset_id, _org_id, provider, creds in work:
        async with sessionmaker()() as db:
            a = await db.get(m.Asset, asset_id)
            if not a:
                continue
            got = await storage.get(db, a, "original")
            try:
                if not got:
                    raise OcrError("The original image is missing")
                text = await read(provider, got[1], creds)
                set_state(a, "ready" if text else "empty", ocrText=text or None, ocrEngine=provider, ocrAt=iso(now()), ocrError=None, ocrStartedAt=None)
            except Exception as e:  # noqa: BLE001 - one bad image mustn't stop the queue
                log.info("OCR failed for asset %s: %s", asset_id, e)
                set_state(a, "failed", ocrEngine=provider, ocrAt=iso(now()), ocrError=str(e)[:300] if isinstance(e, OcrError) else "Couldn't read this image", ocrStartedAt=None)
            await reindex_posts_with(db, a)
            await db.commit()
    return len(work)


async def run_ocr(stop: asyncio.Event) -> None:
    if not get_settings().ocr_enabled:
        return
    while not stop.is_set():
        busy = 0
        try:
            busy = await ocr_once()
        except Exception:  # noqa: BLE001
            log.exception("OCR loop error")
        if busy:
            continue  # more may be waiting
        try:
            await asyncio.wait_for(stop.wait(), timeout=3)
        except TimeoutError:
            pass
