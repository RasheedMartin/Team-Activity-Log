"""Posts, drafts, uploads, images, annotations (§A5 lifecycle). Same contract as the mock."""

from __future__ import annotations

import datetime as dt
import uuid

from fastapi import APIRouter, Body, Depends, Request, Response
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models as m
from .. import storage
from ..config import get_settings
from ..context import OrgCtx, WsCtx, can_edit_post, org_ctx, require_user, visible_post, ws_ctx
from ..db import get_db
from ..errors import fail
from ..events import emit
from ..ids import parse_uuid, uuid7
from ..images import ALLOWED, create_asset
from ..outbox import enqueue
from ..prosemirror import empty_doc, is_doc_empty
from ..timeutil import iso, now, today
from ..views import asset_view, block_image_ids, image_views, post_detail, post_views

router = APIRouter()


def image_count(blocks: list) -> int:
    return sum(1 for b in blocks or [] if b.get("type") == "image")


async def editable_post(ctx: OrgCtx, post_id: str) -> m.Post:
    p = await visible_post(ctx, post_id, lock=True)
    if not await can_edit_post(ctx, p):
        fail(403, "forbidden", "You can't edit this post")
    return p


async def check_version(db: AsyncSession, p: m.Post, version: int | None) -> None:
    if version is not None and version != p.version:
        [current] = await post_views(db, [p])
        fail(409, "version_conflict", "This post changed in another tab or by someone else. Review and retry.", {"current": current})


async def set_tags(db: AsyncSession, ctx: OrgCtx, p: m.Post, tag_ids: list) -> None:
    ids = [t for t in (parse_uuid(x) for x in tag_ids) if t]
    valid = set((await db.execute(select(m.Tag.id).where(m.Tag.org_id == ctx.org.id, m.Tag.id.in_(ids)))).scalars()) if ids else set()
    await db.execute(delete(m.PostTag).where(m.PostTag.post_id == p.id))
    for i, t in enumerate(dict.fromkeys(x for x in ids if x in valid)):
        db.add(m.PostTag(post_id=p.id, tag_id=t, position=i))


async def set_co_authors(db: AsyncSession, ctx: OrgCtx, p: m.Post, user_ids: list) -> None:
    ids = [u for u in (parse_uuid(x) for x in user_ids) if u and u != p.author_id]
    valid = set((await db.execute(select(m.Membership.user_id).where(m.Membership.org_id == ctx.org.id, m.Membership.user_id.in_(ids)))).scalars()) if ids else set()
    await db.execute(delete(m.PostCoAuthor).where(m.PostCoAuthor.post_id == p.id))
    for i, u in enumerate(dict.fromkeys(x for x in ids if x in valid)):
        db.add(m.PostCoAuthor(post_id=p.id, user_id=u, position=i))


async def snapshot_revision(db: AsyncSession, p: m.Post, edited_by: uuid.UUID) -> None:
    row = await db.get(m.PostRevision, (p.id, p.revision))
    if row:
        row.edited_by, row.edited_at, row.title, row.blocks = edited_by, now(), p.title, p.blocks
    else:
        db.add(m.PostRevision(post_id=p.id, revision=p.revision, edited_by=edited_by, edited_at=now(), title=p.title, blocks=p.blocks))


async def changed(db: AsyncSession, p: m.Post) -> None:
    """Searchable content changed: queue the reindex and tell open clients."""
    enqueue(db, p.org_id, [p.id])
    await emit(db, p.workspace_id, {"type": "post", "postId": str(p.id)})


async def detail(db: AsyncSession, p: m.Post) -> dict:
    await db.flush()
    return await post_detail(db, p)


# ---------------------------------------------------------------- posts


@router.post("/orgs/{org}/workspaces/{ws}/posts", status_code=201)
async def create_post(org: str, ws: str, body: dict = Body(default={}), u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await ws_ctx(db, u, org, ws, "member")
    if ctx.ws.archived:
        fail(409, "archived", "This workspace is archived")
    t = now()
    blocks = body.get("blocks") or [{"id": str(uuid7()), "type": "text", "doc": empty_doc()}]
    p = m.Post(
        id=uuid7(),
        org_id=ctx.org.id,
        workspace_id=ctx.ws.id,
        author_id=u.id,
        title=body.get("title") or "",
        work_date=dt.date.fromisoformat(body["workDate"]) if body.get("workDate") else today(),
        work_date_source="user",
        status="draft",
        visibility="visible",
        blocks=blocks,
        reactions={},
        revision=0,
        version=1,
        image_count=image_count(blocks),
        created_at=t,
        updated_at=t,
    )
    db.add(p)
    await db.flush()
    if body.get("tagIds"):
        await set_tags(db, ctx, p, body["tagIds"])
    return await detail(db, p)


@router.get("/orgs/{org}/posts/{post_id}")
async def get_post(org: str, post_id: str, u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await org_ctx(db, u, org)
    return await post_detail(db, await visible_post(ctx, post_id))


@router.patch("/orgs/{org}/posts/{post_id}")
async def patch_post(org: str, post_id: str, body: dict = Body(...), u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await org_ctx(db, u, org, "member")
    p = await editable_post(ctx, post_id)
    await check_version(db, p, body.get("version"))
    if p.deleted_at:
        fail(409, "deleted", "This post was deleted")
    if "title" in body:
        p.title = body["title"] or ""
    if "summary" in body:
        p.summary = body["summary"]
    if body.get("workDate"):
        p.work_date = dt.date.fromisoformat(body["workDate"])
        p.work_date_source = "user"
    if "blocks" in body and body["blocks"] is not None:
        p.blocks = body["blocks"]
        p.image_count = image_count(p.blocks)
    if "tagIds" in body and body["tagIds"] is not None:
        await set_tags(db, ctx, p, body["tagIds"])
    if "coAuthorIds" in body and body["coAuthorIds"] is not None:
        await set_co_authors(db, ctx, p, body["coAuthorIds"])
    if p.status == "published":
        # Rapid edits by the same person coalesce into one revision (§A5).
        last = await db.get(m.PostRevision, (p.id, p.revision))
        recent = last is not None and last.edited_by == u.id and (now() - last.edited_at) < dt.timedelta(minutes=5) and p.revision > 1
        if not recent:
            p.revision += 1
    p.version += 1
    p.updated_at = now()
    if p.status == "published":
        await snapshot_revision(db, p, u.id)
        await changed(db, p)
    return await detail(db, p)


@router.post("/orgs/{org}/posts/{post_id}/publish")
async def publish(org: str, post_id: str, body: dict = Body(default={}), u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await org_ctx(db, u, org, "member")
    p = await editable_post(ctx, post_id)
    await check_version(db, p, (body or {}).get("version"))
    if p.status == "published":
        return await detail(db, p)  # idempotent
    problems = []
    if not p.title.strip():
        problems.append("Add a title")
    if not any(b.get("type") == "image" or (b.get("type") in ("text", "table") and not is_doc_empty(b.get("doc"))) for b in p.blocks or []):
        problems.append("Add some text or an image")
    imgs = await image_views(db, block_image_ids(p.blocks))
    if any(v["asset"]["processing"] == "failed" for v in imgs.values()):
        problems.append("Remove or retry failed uploads")
    if problems:
        fail(422, "not_publishable", ". ".join(problems), {"problems": problems})
    t = now()
    p.status, p.published_at, p.updated_at, p.revision, p.version = "published", t, t, 1, p.version + 1
    await snapshot_revision(db, p, u.id)
    await changed(db, p)
    return await detail(db, p)


@router.post("/orgs/{org}/posts/{post_id}/unpublish")
async def unpublish(org: str, post_id: str, u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await org_ctx(db, u, org, "member")
    p = await editable_post(ctx, post_id)
    if p.comment_count > 0 or p.reaction_count > 0:
        fail(409, "has_activity", "This post has comments or reactions, so it can't go back to draft. Hide it instead.")
    p.status, p.published_at, p.version, p.updated_at = "draft", None, p.version + 1, now()
    await changed(db, p)
    return await detail(db, p)


@router.post("/orgs/{org}/posts/{post_id}/hide")
async def hide(org: str, post_id: str, body: dict = Body(default={}), u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await org_ctx(db, u, org, "member")
    p = await editable_post(ctx, post_id)
    if p.status != "published":
        fail(409, "not_published", "Only published posts can be hidden")
    reason = str((body or {}).get("reason") or "").strip() or None
    p.visibility, p.hidden_reason, p.hidden_by, p.hidden_at, p.version = "hidden", reason, u.id, now(), p.version + 1
    await changed(db, p)
    return await detail(db, p)


@router.post("/orgs/{org}/posts/{post_id}/show")
async def show(org: str, post_id: str, u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await org_ctx(db, u, org, "member")
    p = await editable_post(ctx, post_id)
    p.visibility, p.hidden_reason, p.hidden_by, p.hidden_at, p.version = "visible", None, None, None, p.version + 1
    await changed(db, p)
    return await detail(db, p)


@router.delete("/orgs/{org}/posts/{post_id}", status_code=204)
async def delete_post(org: str, post_id: str, u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await org_ctx(db, u, org, "member")
    p = await editable_post(ctx, post_id)
    # Discarding a draft is a soft delete too, so "Undo" can bring it back.
    p.deleted_at, p.version = now(), p.version + 1
    if p.status == "published":
        await changed(db, p)
    return Response(status_code=204)


@router.post("/orgs/{org}/posts/{post_id}/restore")
async def restore(org: str, post_id: str, u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await org_ctx(db, u, org, "member")
    pid = parse_uuid(post_id)
    p = await db.get(m.Post, pid) if pid else None
    if not p or p.org_id != ctx.org.id or not p.deleted_at:
        fail(404, "not_found", "Nothing to restore")
    # Authors can undo their own delete right away; otherwise restoring is an admin action.
    recent_own = p.author_id == u.id and (now() - p.deleted_at) < dt.timedelta(minutes=1)
    if not recent_own and not ctx.is_admin:
        fail(403, "forbidden", "Only admins can restore posts")
    p.deleted_at, p.version = None, p.version + 1
    await changed(db, p)
    return await detail(db, p)


@router.get("/orgs/{org}/posts/{post_id}/revisions")
async def revisions(org: str, post_id: str, u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await org_ctx(db, u, org)
    p = await visible_post(ctx, post_id)
    rows = (await db.execute(select(m.PostRevision).where(m.PostRevision.post_id == p.id).order_by(m.PostRevision.revision.desc()))).scalars()
    return [{"revision": r.revision, "editedBy": str(r.edited_by), "editedAt": iso(r.edited_at), "title": r.title, "blocks": r.blocks} for r in rows]


@router.get("/orgs/{org}/workspaces/{ws}/drafts")
async def drafts(org: str, ws: str, u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await ws_ctx(db, u, org, ws)
    rows = await db.execute(
        select(m.Post).where(m.Post.workspace_id == ctx.ws.id, m.Post.status == "draft", m.Post.author_id == u.id, m.Post.deleted_at.is_(None)).order_by(m.Post.updated_at.desc())
    )
    return [{"id": str(p.id), "title": p.title, "updatedAt": iso(p.updated_at), "imageCount": image_count(p.blocks), "workspaceId": str(p.workspace_id)} for p in rows.scalars()]


@router.get("/orgs/{org}/workspaces/{ws}/trash")
async def trash(org: str, ws: str, u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx: WsCtx = await ws_ctx(db, u, org, ws, "admin")
    deleted = (await db.execute(select(m.Post).where(m.Post.workspace_id == ctx.ws.id, m.Post.deleted_at.is_not(None), m.Post.status == "published").order_by(m.Post.deleted_at.desc()))).scalars().all()
    hidden = (await db.execute(select(m.Post).where(m.Post.workspace_id == ctx.ws.id, m.Post.deleted_at.is_(None), m.Post.visibility == "hidden").order_by(m.Post.hidden_at.desc()))).scalars().all()
    return {"deleted": await post_views(db, deleted), "hidden": await post_views(db, hidden)}


# ---------------------------------------------------------------- uploads (presign -> PUT -> complete, §B7)


@router.post("/orgs/{org}/uploads", status_code=201)
async def presign(org: str, body: dict = Body(...), u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await org_ctx(db, u, org, "member")
    mime, size = str(body.get("mime") or ""), int(body.get("bytes") or 0)
    if mime not in ALLOWED:
        fail(415, "unsupported_type", "Only PNG, JPEG, GIF, WebP, and SVG images are supported")
    if size > get_settings().max_upload_bytes:
        fail(413, "too_large", "Images must be under 25 MB")
    up = m.Upload(id=uuid7(), org_id=ctx.org.id, user_id=u.id, filename=str(body.get("filename") or "image"), mime=mime, bytes=size, source_kind=body.get("sourceKind") or "upload")
    db.add(up)
    return {"uploadId": str(up.id), "uploadUrl": f"/v1/orgs/{ctx.org.id}/uploads/{up.id}/data"}


@router.put("/orgs/{org}/uploads/{upload_id}/data", status_code=200)
async def upload_data(org: str, upload_id: str, request: Request, u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await org_ctx(db, u, org, "member")
    up = await db.get(m.Upload, parse_uuid(upload_id)) if parse_uuid(upload_id) else None
    if not up or up.org_id != ctx.org.id or up.user_id != u.id:
        fail(404, "not_found", "Upload not found or expired")
    data = await _read_limited(request, get_settings().max_upload_bytes, "Images must be under 25 MB")
    up.data = data
    up.bytes = len(data)
    return Response(status_code=200)


async def _read_limited(request: Request, limit: int, message: str) -> bytes:
    chunks, total = [], 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > limit:
            fail(413, "too_large", message)
        chunks.append(chunk)
    return b"".join(chunks)


@router.post("/orgs/{org}/uploads/{upload_id}/complete")
async def complete(org: str, upload_id: str, response: Response, u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await org_ctx(db, u, org, "member")
    up = await db.get(m.Upload, parse_uuid(upload_id)) if parse_uuid(upload_id) else None
    if not up or up.org_id != ctx.org.id or not up.data:
        fail(409, "incomplete", "Upload didn't finish. Retry.")
    asset, created = await create_asset(db, ctx.org.id, up.data, up.filename, up.source_kind, u.id)
    await db.delete(up)
    response.status_code = 201 if created else 200
    return asset_view(asset)


@router.get("/orgs/{org}/assets/{asset_id}/{variant}")
async def serve_asset(org: str, asset_id: str, variant: str, u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await org_ctx(db, u, org)
    aid = parse_uuid(asset_id)
    asset = await db.get(m.Asset, aid) if aid else None
    if not asset or asset.org_id != ctx.org.id:
        fail(404, "not_found", "Image not found")
    found = await storage.get(db, asset, variant)
    if not found:
        fail(404, "not_found", "Image not found")
    mime, data = found
    headers = {"Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff"}
    if mime == "image/svg+xml":
        headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'; sandbox"
    return Response(content=data, media_type=mime, headers=headers)


# ---------------------------------------------------------------- image instances


async def _instance(ctx: OrgCtx, inst_id: str) -> m.ImageInstance:
    iid = parse_uuid(inst_id)
    inst = await ctx.db.get(m.ImageInstance, iid) if iid else None
    if not inst or inst.org_id != ctx.org.id:
        fail(404, "not_found", "Image not found")
    return inst


@router.post("/orgs/{org}/image-instances", status_code=201)
async def create_instance(org: str, body: dict = Body(...), u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await org_ctx(db, u, org, "member")
    aid = parse_uuid(body.get("assetId"))
    asset = await db.get(m.Asset, aid) if aid else None
    if not asset or asset.org_id != ctx.org.id:
        fail(404, "not_found", "Asset not found")
    post_id = parse_uuid(body.get("postId"))
    if post_id:
        await editable_post(ctx, str(post_id))
    inst = m.ImageInstance(id=uuid7(), org_id=ctx.org.id, asset_id=asset.id, post_id=post_id, comment_id=parse_uuid(body.get("commentId")), tags=[], custom_fields={})
    db.add(inst)
    await db.flush()
    return (await image_views(db, [inst.id]))[inst.id]


@router.get("/orgs/{org}/image-instances/{inst_id}")
async def get_instance(org: str, inst_id: str, u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await org_ctx(db, u, org)
    inst = await _instance(ctx, inst_id)
    if inst.post_id:
        await visible_post(ctx, inst.post_id)
    return (await image_views(db, [inst.id]))[inst.id]


async def _reindex_parent(db: AsyncSession, inst: m.ImageInstance) -> None:
    if inst.post_id:
        p = await db.get(m.Post, inst.post_id)
        if p and p.status == "published":
            enqueue(db, p.org_id, [p.id])


@router.patch("/orgs/{org}/image-instances/{inst_id}")
async def patch_instance(org: str, inst_id: str, body: dict = Body(...), u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await org_ctx(db, u, org, "member")
    inst = await _instance(ctx, inst_id)
    if inst.post_id:
        await editable_post(ctx, str(inst.post_id))
    for key, attr in (("caption", "caption"), ("altText", "alt_text"), ("figureLabel", "figure_label"), ("tags", "tags"), ("customFields", "custom_fields")):
        if key in body:
            setattr(inst, attr, body[key])
    if "assetId" in body:
        a = await db.get(m.Asset, parse_uuid(body["assetId"])) if parse_uuid(body["assetId"]) else None
        if not a or a.org_id != ctx.org.id:
            fail(404, "not_found", "Asset not found")
        inst.asset_id = a.id
    await _reindex_parent(db, inst)
    await db.flush()
    return (await image_views(db, [inst.id]))[inst.id]


@router.put("/orgs/{org}/image-instances/{inst_id}/annotation")
async def put_annotation(org: str, inst_id: str, body: dict = Body(...), u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await org_ctx(db, u, org, "member")
    inst = (await db.execute(select(m.ImageInstance).where(m.ImageInstance.id == parse_uuid(inst_id)).with_for_update())).scalar_one_or_none() if parse_uuid(inst_id) else None
    if not inst or inst.org_id != ctx.org.id:
        fail(404, "not_found", "Image not found")
    if inst.post_id:
        await editable_post(ctx, str(inst.post_id))
    cur = (inst.annotation or {}).get("version", 0)
    if body.get("version") != cur:
        fail(409, "version_conflict", "Someone else changed these annotations. Reload to see their version.")
    inst.annotation = {"shapes": body.get("shapes") or [], "version": cur + 1}
    await _reindex_parent(db, inst)
    await db.flush()
    return (await image_views(db, [inst.id]))[inst.id]
