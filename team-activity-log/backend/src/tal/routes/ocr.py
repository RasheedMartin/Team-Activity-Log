"""Text in images (OCR) settings, re-reading, and correcting one image's text. See tal.ocr."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Body, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models as m
from .. import ocr
from ..context import org_ctx, require_user
from ..db import get_db
from ..errors import fail
from ..timeutil import iso, now

router = APIRouter()


async def _view(db: AsyncSession, org: m.Organization) -> dict:
    keys = ocr.unseal(org.ocr_secret)
    chosen = ((org.settings or {}).get("ocr") or {}).get("provider", "tesseract")
    return {
        "provider": chosen,
        "active": ocr.provider_of(org),  # differs from provider when the plan or key no longer allows it
        "cloudAllowed": ocr.cloud_allowed(org),
        "builtInReady": ocr.tesseract_available(),
        "providers": [{"id": k, "name": v["name"], "cloud": v["cloud"], "fields": v["fields"]} for k, v in ocr.PROVIDERS.items()],
        # Which keys are saved, as hints only: secrets never come back.
        "saved": {p: {f: ocr.hint(v) if f in ("apiKey", "secretAccessKey", "accessKeyId") else v for f, v in c.items()} for p, c in keys.items()},
        "counts": await ocr.stats(db, org.id),
    }


@router.get("/orgs/{org}/ocr")
async def get_ocr(org: str, u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await org_ctx(db, u, org, "admin")
    return await _view(db, ctx.org)


@router.put("/orgs/{org}/ocr")
async def put_ocr(org: str, body: dict = Body(...), u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    """Choose the engine. A cloud engine needs Business or Enterprise and a key, which is checked
    on a test image before it's saved. `forget: true` removes that engine's saved key."""
    ctx = await org_ctx(db, u, org, "admin")
    provider = body.get("provider")
    if provider not in ocr.PROVIDERS:
        fail(422, "invalid", "Choose an OCR engine")
    keys = ocr.unseal(ctx.org.ocr_secret)
    if body.get("forget"):
        keys.pop(provider, None)
        provider = "tesseract"
    elif ocr.PROVIDERS[provider]["cloud"]:
        if not ocr.cloud_allowed(ctx.org):
            fail(402, "plan_limit", "Cloud OCR engines are on the Business plan. The built-in engine is included on every plan.")
        given = body.get("credentials") or {}
        if given:
            fields = ocr.PROVIDERS[provider]["fields"]
            creds = {f: str(given.get(f, "")).strip() for f in fields}
            missing = [f for f in fields if not creds[f]]
            if missing:
                fail(422, "invalid", f"Missing {', '.join(missing)}")
            if provider == "azure" and not creds["endpoint"].startswith("https://"):
                fail(422, "invalid", "The Azure endpoint starts with https://")
            try:
                await ocr.check(provider, creds)
            except ocr.OcrError as e:
                fail(422, "ocr_key_failed", f"That key didn't work. {e}")
            except Exception:  # noqa: BLE001 - network trouble, bad region, …
                fail(422, "ocr_key_failed", "Couldn't reach the service with that key. Check it and try again.")
            keys[provider] = creds
        elif provider not in keys:
            fail(422, "invalid", "Add a key for this engine first")
    try:
        ctx.org.ocr_secret = ocr.seal(keys) if keys else None
    except ocr.OcrError as e:
        fail(409, "no_secret_key", str(e))
    ctx.org.settings = {**(ctx.org.settings or {}), "ocr": {"provider": provider}}
    return await _view(db, ctx.org)


@router.post("/orgs/{org}/ocr/reread")
async def reread(org: str, body: dict = Body(default={}), u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    """Queue images to be read again: "failed" ones, or "all" (e.g. after switching engine).
    Text a person corrected is kept."""
    ctx = await org_ctx(db, u, org, "admin")
    n = await ocr.requeue(db, ctx.org.id, "all" if body.get("which") == "all" else "failed")
    return {"queued": n}


@router.put("/orgs/{org}/assets/{asset_id}/ocr")
async def correct(org: str, asset_id: str, body: dict = Body(...), u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    """Fix what OCR read (or add text it missed). Search uses the corrected text."""
    ctx = await org_ctx(db, u, org, "member")
    try:
        a = await db.get(m.Asset, uuid.UUID(asset_id))
    except ValueError:
        a = None
    if not a or a.org_id != ctx.org.id:
        fail(404, "not_found", "Image not found")
    text = ocr.clean(str(body.get("text") or ""))
    ocr.set_state(a, "edited" if text else "empty", ocrText=text or None, ocrEngine="person", ocrAt=iso(now()), ocrError=None, ocrEditedBy=str(u.id))
    await ocr.reindex_posts_with(db, a)
    return {"ocrState": a.metadata_["ocrState"], "ocrText": text}
