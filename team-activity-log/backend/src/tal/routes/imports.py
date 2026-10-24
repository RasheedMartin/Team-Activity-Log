"""Import slides (§W5): upload -> parse (background) -> review -> commit -> publish-all.

The deck is read by tal.pptx (same rules as the mock's parser). The original file lives in
import_sources only until commit; posts, images (deduped by hash), and a deck collection are
created in one transaction.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import hashlib
import logging
import uuid

from fastapi import APIRouter, Body, Depends, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models as m
from ..config import get_settings
from ..context import OrgCtx, org_ctx, require_user, ws_ctx
from ..db import get_db, sessionmaker
from ..errors import fail
from ..events import emit
from ..ids import parse_uuid, uuid7
from ..images import create_asset
from ..outbox import enqueue
from ..pptx import ParsedDeck, ParsedSlide, PptxError, parse_pptx
from ..prosemirror import doc, empty_doc, heading
from ..timeutil import now, today
from ..views import import_job_view
from .posts import _read_limited
from .posts import set_tags as set_post_tags

router = APIRouter()
log = logging.getLogger("tal.imports")
_tasks: set[asyncio.Task] = set()
TEMP_DAYS = 7


def groups_for(mode: str, deck: ParsedDeck) -> list[dict]:
    s = deck.slides
    if mode == "per_slide":
        return [{"title": x.title, "slides": [x]} for x in s]
    if mode == "whole_deck":
        return [{"title": next((x.title for x in s if x.title), ""), "slides": s}]
    # by_section: PowerPoint Sections if the deck has them, else section-header slides, else per slide.
    groups: list[dict] = []
    if deck.has_sections:
        for x in s:
            if groups and groups[-1]["title"] == (x.section or ""):
                groups[-1]["slides"].append(x)
            else:
                groups.append({"title": x.section or "", "slides": [x]})
        return groups
    if any(x.is_section_header for x in s):
        for x in s:
            if x.is_section_header or not groups:
                groups.append({"title": x.title, "slides": [x]})
            else:
                groups[-1]["slides"].append(x)
        return groups
    return [{"title": x.title, "slides": [x], "note": "No sections in this deck; each slide is its own post" if i == 0 else None} for i, x in enumerate(s)]


def items_for(mode: str, deck: ParsedDeck, defaults: dict) -> list[dict]:
    out = []
    for g in groups_for(mode, deck):
        dated = next((x for x in g["slides"] if x.date), None) if defaults.get("guessDates") else None
        multi = len(g["slides"]) > 1
        out.append(
            {
                "id": str(uuid7()),
                "slideNumbers": [x.n for x in g["slides"]],
                "proposedTitle": g["title"],
                "proposedDate": dated.date if dated else defaults.get("baseDate") or today().isoformat(),
                "dateSource": "guessed" if dated else "user" if defaults.get("baseDate") else "import_fallback",
                "imageCount": sum(len(x.images) for x in g["slides"]),
                "warnings": [*([g["note"]] if g.get("note") else []), *[f"Slide {x.n}: {w}" if multi else w for x in g["slides"] for w in x.warnings]],
                "included": True,
            }
        )
    return out


async def _job(ctx: OrgCtx, job_id: str, *, own: bool = False) -> m.ImportJobRow:
    j = await ctx.db.get(m.ImportJobRow, parse_uuid(job_id)) if parse_uuid(job_id) else None
    if not j or j.org_id != ctx.org.id or (own and j.user_id != ctx.user.id):
        fail(404, "not_found", "Import not found")
    return j


async def _deck(db: AsyncSession, j: m.ImportJobRow) -> ParsedDeck:
    src = await db.get(m.ImportSource, j.id)
    if not src:
        fail(410, "source_gone", "The uploaded file is no longer available. Start the import again.")
    return await asyncio.to_thread(parse_pptx, src.data)


async def parse_job(job_id: uuid.UUID) -> None:
    """Background: parse the deck, reporting progress, then move the job to review (or failed)."""
    loop = asyncio.get_running_loop()
    progress: list[float] = []

    async with sessionmaker()() as db:
        src = await db.get(m.ImportSource, job_id)
        if not src:
            return
        data = src.data
    try:
        deck = await asyncio.to_thread(parse_pptx, data, lambda f: loop.call_soon_threadsafe(progress.append, f))
        async with sessionmaker()() as db:
            j = await db.get(m.ImportJobRow, job_id)
            if j and j.status == "parsing":
                j.status, j.progress, j.slide_count = "review", 1.0, len(deck.slides)
                j.items = items_for(j.mode, deck, j.defaults)
                await db.commit()
    except PptxError as e:
        await _fail_job(job_id, str(e))
    except Exception:  # noqa: BLE001
        log.exception("import %s failed", job_id)
        await _fail_job(job_id, "Something went wrong reading this presentation. Try re-saving it from PowerPoint.")


async def _fail_job(job_id: uuid.UUID, message: str) -> None:
    async with sessionmaker()() as db:
        j = await db.get(m.ImportJobRow, job_id)
        if j:
            j.status, j.error = "failed", message
            await db.commit()


@router.post("/orgs/{org}/workspaces/{ws}/imports", status_code=201)
async def start(org: str, ws: str, body: dict = Body(...), u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await ws_ctx(db, u, org, ws, "member")
    filename = str(body.get("filename") or "")
    if not filename.lower().endswith(".pptx"):
        fail(415, "unsupported_type", "Choose a .pptx file (PowerPoint 2007 or newer)")
    if int(body.get("bytes") or 0) > get_settings().max_import_bytes:
        fail(413, "too_large", "This deck is too large to import")
    mode = body.get("mode") or "per_slide"
    if mode not in ("per_slide", "whole_deck", "by_section"):
        fail(422, "invalid", "Unknown import mode")
    defaults = body.get("defaults") or {}
    j = m.ImportJobRow(
        id=uuid7(),
        org_id=ctx.org.id,
        workspace_id=ctx.ws.id,
        user_id=u.id,
        status="uploading",
        progress=0,
        mode=mode,
        source_filename=filename,
        source_bytes=int(body.get("bytes") or 0),
        slide_count=0,
        defaults={"tagIds": defaults.get("tagIds") or [], "baseDate": defaults.get("baseDate"), "guessDates": bool(defaults.get("guessDates", True)), "collectionName": defaults.get("collectionName") or ""},
        items=[],
    )
    db.add(j)
    return import_job_view(j)


@router.put("/orgs/{org}/imports/{job_id}/upload")
async def upload(org: str, job_id: str, request: Request, u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await org_ctx(db, u, org, "member")
    j = await _job(ctx, job_id, own=True)
    if j.status not in ("uploading", "failed"):
        fail(409, "already_uploaded", "This import already has its file")
    data = await _read_limited(request, get_settings().max_import_bytes, "This deck is too large to import")
    # Held in temp storage only until commit; not retained (§W5.4).
    src = await db.get(m.ImportSource, j.id)
    if src:
        src.data = data
    else:
        db.add(m.ImportSource(job_id=j.id, data=data, expires_at=now() + dt.timedelta(days=TEMP_DAYS)))
    j.status, j.progress, j.source_bytes, j.source_sha256, j.error = "parsing", 0.05, len(data), hashlib.sha256(data).hexdigest(), None
    await db.commit()  # the parser runs in another session and must see the file
    task = asyncio.create_task(parse_job(j.id))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    return import_job_view(j)


@router.get("/orgs/{org}/imports/{job_id}")
async def get_job(org: str, job_id: str, u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await org_ctx(db, u, org)
    return import_job_view(await _job(ctx, job_id, own=True))


@router.patch("/orgs/{org}/imports/{job_id}")
async def patch_job(org: str, job_id: str, body: dict = Body(...), u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await org_ctx(db, u, org, "member")
    j = await _job(ctx, job_id)
    if j.status != "review":
        fail(409, "not_in_review", "This import can't be edited now")
    mode = body.get("mode")
    if mode and mode != j.mode:
        j.items = items_for(mode, await _deck(db, j), j.defaults)
        j.mode = mode
    elif body.get("items") is not None:
        j.items = body["items"]
    return import_job_view(j)


async def blocks_for(db: AsyncSession, ctx: OrgCtx, post_id: uuid.UUID, slides: list[ParsedSlide]) -> list[dict]:
    """Per slide: a break (with presenter notes), a heading when several slides, text, images."""
    blocks: list[dict] = []
    for k, sl in enumerate(slides):
        if k > 0 or sl.notes:
            blocks.append({"id": str(uuid7()), "type": "slide_break", **({"notes": sl.notes} if sl.notes else {})})
        content = [*([heading(sl.title)] if len(slides) > 1 and sl.title else []), *sl.content]
        if content:
            blocks.append({"id": str(uuid7()), "type": "text", "doc": doc(*content)})
        for img in sl.images:
            asset, _ = await create_asset(db, ctx.org.id, img.data, img.name, "pptx_import", ctx.user.id)
            inst = m.ImageInstance(id=uuid7(), org_id=ctx.org.id, asset_id=asset.id, post_id=post_id, tags=[], custom_fields={}, caption=f"Slide {sl.n}")
            db.add(inst)
            blocks.append({"id": str(uuid7()), "type": "image", "imageInstanceId": str(inst.id)})
    return blocks


@router.post("/orgs/{org}/imports/{job_id}/commit")
async def commit(org: str, job_id: str, u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await org_ctx(db, u, org, "member")
    j = (await db.execute(select(m.ImportJobRow).where(m.ImportJobRow.id == parse_uuid(job_id)).with_for_update())).scalar_one_or_none() if parse_uuid(job_id) else None
    if not j or j.org_id != ctx.org.id:
        fail(404, "not_found", "Import not found")
    if j.status == "done":
        return import_job_view(j)  # idempotent
    if j.status != "review":
        fail(409, "not_in_review", "Nothing to commit yet")
    deck = await _deck(db, j)
    by_slide = {x.n: x for x in deck.slides}
    t = now()
    coll = m.CollectionRow(id=uuid7(), org_id=ctx.org.id, workspace_id=j.workspace_id, name=j.defaults.get("collectionName") or j.source_filename, kind="deck_import", created_by=u.id, created_at=t, updated_at=t)
    db.add(coll)
    await db.flush()
    items, created = [], 0
    for item in j.items:
        if not item.get("included"):
            items.append(item)
            continue
        post_id = uuid7()
        slides = [by_slide[n] for n in item.get("slideNumbers") or [] if n in by_slide]
        p = m.Post(
            id=post_id,
            org_id=ctx.org.id,
            workspace_id=j.workspace_id,
            author_id=u.id,
            title=item.get("proposedTitle") or f"Slide {(item.get('slideNumbers') or [1])[0]}",
            work_date=dt.date.fromisoformat(item.get("proposedDate") or today().isoformat()),
            work_date_source=item.get("dateSource") or "import_fallback",
            status="draft",
            visibility="visible",
            blocks=[],
            reactions={},
            revision=0,
            version=1,
            created_at=t,
            updated_at=t,
            source={"kind": "import", "importJobId": str(j.id), "fileName": j.source_filename, "fileSha256": j.source_sha256 or "", "slide": (item.get("slideNumbers") or [1])[0], "slideCount": j.slide_count},
        )
        db.add(p)
        await db.flush()
        blocks = await blocks_for(db, ctx, post_id, slides)
        p.blocks = blocks or [{"id": str(uuid7()), "type": "text", "doc": empty_doc()}]
        p.image_count = sum(1 for b in blocks if b["type"] == "image")
        await set_post_tags(db, ctx, p, j.defaults.get("tagIds") or [])
        db.add(m.CollectionPost(collection_id=coll.id, post_id=post_id, position=created))
        created += 1
        items.append({**item, "postId": str(post_id)})
    j.items = items
    j.status, j.collection_id = "done", coll.id
    j.report = {"created": created, "skipped": sum(1 for i in j.items if not i.get("included")), "warnings": sum(len(i.get("warnings") or []) for i in j.items)}
    # The original deck leaves temp storage at commit (§W5.4).
    src = await db.get(m.ImportSource, j.id)
    if src:
        await db.delete(src)
    return import_job_view(j)


@router.post("/orgs/{org}/imports/{job_id}/publish-all")
async def publish_all(org: str, job_id: str, u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await org_ctx(db, u, org, "member")
    j = await _job(ctx, job_id)
    t = now()
    ids = [x for x in (parse_uuid(i.get("postId")) for i in j.items or []) if x]
    posts = (await db.execute(select(m.Post).where(m.Post.id.in_(ids)))).scalars().all() if ids else []
    for p in posts:
        if p.status != "draft" or p.deleted_at or p.author_id != u.id:
            continue
        p.status, p.published_at, p.updated_at, p.revision, p.version = "published", t, t, 1, p.version + 1
        db.add(m.PostRevision(post_id=p.id, revision=1, edited_by=u.id, edited_at=t, title=p.title, blocks=p.blocks))
    enqueue(db, ctx.org.id, [p.id for p in posts])
    await emit(db, j.workspace_id, {"type": "post", "postId": str(j.id)})
    return import_job_view(j)


@router.delete("/orgs/{org}/imports/{job_id}", status_code=204)
async def delete_import(org: str, job_id: str, u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await org_ctx(db, u, org, "member")
    j = await _job(ctx, job_id)
    # Delete a whole import: its posts (soft) and the collection.
    ids = [x for x in (parse_uuid(i.get("postId")) for i in j.items or []) if x]
    for p in (await db.execute(select(m.Post).where(m.Post.id.in_(ids)))).scalars().all() if ids else []:
        p.deleted_at = now()
    enqueue(db, ctx.org.id, ids)
    if j.collection_id:
        c = await db.get(m.CollectionRow, j.collection_id)
        if c:
            await db.delete(c)
    j.status, j.error = "failed", "Import deleted"
    return Response(status_code=204)
