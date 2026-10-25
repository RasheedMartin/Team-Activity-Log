"""Posts, drafts, uploads, images, annotations (§A5 lifecycle). Same contract as the mock."""

from __future__ import annotations

import datetime as dt
import uuid

from fastapi import APIRouter, Body, Depends, Request, Response
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import collection_access, storage
from .. import models as m
from .. import sanitize as clean
from ..config import get_settings
from ..context import OrgCtx, WsCtx, accessible_workspaces, can_edit_post, org_ctx, require_user, visible_post, ws_ctx
from ..db import get_db
from ..errors import fail
from ..events import emit
from ..httputil import read_limited
from ..ids import parse_uuid, uuid7
from ..images import ALLOWED, create_asset
from ..outbox import enqueue
from ..prosemirror import doc, empty_doc, heading, is_doc_empty
from ..timeutil import iso, now, today
from ..views import asset_view, block_docs, block_image_ids, image_views, post_detail, post_views

router = APIRouter()


CONTENT_FIELDS = {"title", "summary", "workDate", "blocks", "tagIds", "coAuthorIds"}


def image_count(blocks: list) -> int:
    return len(block_image_ids(blocks, content_only=True))


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
    blocks = clean.blocks(body["blocks"]) if body.get("blocks") else [{"id": str(uuid7()), "type": "text", "doc": empty_doc()}]
    p = m.Post(
        id=uuid7(),
        org_id=ctx.org.id,
        workspace_id=ctx.ws.id,
        author_id=u.id,
        title=clean.text(body.get("title"), "title", 300) or "",
        work_date=clean.iso_date(body["workDate"], "workDate") if body.get("workDate") else today(),
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
        await set_tags(db, ctx, p, clean.uuid_list(body["tagIds"], "tagIds", 50))
    if body.get("collectionId"):  # "Write a page" in a notebook: the new post goes at its end
        c = await db.get(m.CollectionRow, parse_uuid(body["collectionId"]))
        if not c or c.workspace_id != ctx.ws.id:
            fail(404, "not_found", "Notebook not found")
        await collection_access.require(db, ctx, c, "editor")
        last = (await db.execute(select(func.max(m.CollectionPost.position)).where(m.CollectionPost.collection_id == c.id))).scalar()
        db.add(m.CollectionPost(collection_id=c.id, post_id=p.id, position=(last if last is not None else -1) + 1))
        c.updated_at = t
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
        p.title = clean.text(body["title"], "title", 300) or ""
    if "summary" in body:
        p.summary = clean.text(body["summary"], "summary", 2000, multiline=True)
    if body.get("workDate"):
        p.work_date = clean.iso_date(body["workDate"], "workDate")
        p.work_date_source = "user"
    if "blocks" in body and body["blocks"] is not None:
        p.blocks = clean.blocks(body["blocks"])
        p.image_count = image_count(p.blocks)
    if "tagIds" in body and body["tagIds"] is not None:
        await set_tags(db, ctx, p, clean.uuid_list(body["tagIds"], "tagIds", 50))
    if "coAuthorIds" in body and body["coAuthorIds"] is not None:
        await set_co_authors(db, ctx, p, clean.uuid_list(body["coAuthorIds"], "coAuthorIds", 20))
    if "presentation" in body:
        p.presentation = clean.presentation(body["presentation"])
    if not CONTENT_FIELDS & body.keys():  # a theme change isn't an edit: no revision, no reindex
        p.version += 1
        return await detail(db, p)
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
    if not block_image_ids(p.blocks) and all(is_doc_empty(d) for d in block_docs(p.blocks)):
        problems.append("Add some text or an image")
    imgs = await image_views(db, block_image_ids(p.blocks), p.org_id)
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
    reason = clean.text((body or {}).get("reason"), "reason", 500, multiline=True)
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
    def summary(p: m.Post) -> dict:
        s = p.source or {}
        src = {k: s[k] for k in ("importJobId", "fileName", "slide", "slideCount") if k in s} if s.get("kind") == "import" else None
        return {"id": str(p.id), "title": p.title, "updatedAt": iso(p.updated_at), "imageCount": image_count(p.blocks), "workspaceId": str(p.workspace_id), **({"source": src} if src else {})}

    return [summary(p) for p in rows.scalars()]


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
    mime = str(body.get("mime") or "")
    size = int(clean.number(body.get("bytes", 0), "bytes", 0, 10**12))
    if mime not in ALLOWED:
        fail(415, "unsupported_type", "Only PNG, JPEG, GIF, WebP, and SVG images are supported")
    if size > get_settings().max_upload_bytes:
        fail(413, "too_large", "Images must be under 25 MB")
    up = m.Upload(id=uuid7(), org_id=ctx.org.id, user_id=u.id, filename=clean.text(body.get("filename"), "filename", 255) or "image", mime=mime, bytes=size, source_kind=body.get("sourceKind") if body.get("sourceKind") in ("upload", "paste", "screenshot") else "upload")
    db.add(up)
    return {"uploadId": str(up.id), "uploadUrl": f"/v1/orgs/{ctx.org.id}/uploads/{up.id}/data"}


@router.put("/orgs/{org}/uploads/{upload_id}/data", status_code=200)
async def upload_data(org: str, upload_id: str, request: Request, u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await org_ctx(db, u, org, "member")
    up = await db.get(m.Upload, parse_uuid(upload_id)) if parse_uuid(upload_id) else None
    if not up or up.org_id != ctx.org.id or up.user_id != u.id:
        fail(404, "not_found", "Upload not found or expired")
    data = await read_limited(request, get_settings().max_upload_bytes, "Images must be under 25 MB")
    up.data = data
    up.bytes = len(data)
    return Response(status_code=200)


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


async def _asset_visible(ctx: OrgCtx, asset_id: uuid.UUID) -> bool:
    """Used in a post or comment in a workspace this person can open."""
    ws_ids = [w.id for w in await accessible_workspaces(ctx, True)]
    in_post = select(m.ImageInstance.id).join(m.Post, m.Post.id == m.ImageInstance.post_id).where(m.ImageInstance.asset_id == asset_id, m.Post.workspace_id.in_(ws_ids))
    in_comment = (
        select(m.ImageInstance.id)
        .join(m.CommentRow, m.CommentRow.id == m.ImageInstance.comment_id)
        .where(m.ImageInstance.asset_id == asset_id, m.CommentRow.workspace_id.in_(ws_ids))
    )
    return bool(await ctx.db.scalar(select(in_post.union(in_comment).limit(1).subquery().c.id)))


@router.get("/orgs/{org}/assets/{asset_id}/{variant}")
async def serve_asset(org: str, asset_id: str, variant: str, u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await org_ctx(db, u, org)
    aid = parse_uuid(asset_id)
    asset = await db.get(m.Asset, aid) if aid else None
    if not asset or asset.org_id != ctx.org.id:
        fail(404, "not_found", "Image not found")
    if asset.created_by != u.id and not await _asset_visible(ctx, asset.id):
        fail(404, "not_found", "Image not found")  # e.g. only used in a private workspace you're not in
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
    return (await image_views(db, [inst.id], ctx.org.id))[inst.id]


@router.get("/orgs/{org}/image-instances/{inst_id}")
async def get_instance(org: str, inst_id: str, u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await org_ctx(db, u, org)
    inst = await _instance(ctx, inst_id)
    if inst.post_id:
        await visible_post(ctx, inst.post_id)
    elif inst.comment_id:
        c = await db.get(m.CommentRow, inst.comment_id)
        if not c or c.org_id != ctx.org.id:
            fail(404, "not_found", "Image not found")
        await visible_post(ctx, c.post_id)  # a comment's image is visible where the comment is
    return (await image_views(db, [inst.id], ctx.org.id))[inst.id]


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
    if "caption" in body:
        inst.caption = clean.text(body["caption"], "caption", 1000, multiline=True)
    if "altText" in body:
        inst.alt_text = clean.text(body["altText"], "altText", 1000, multiline=True)
    if "figureLabel" in body:
        inst.figure_label = clean.text(body["figureLabel"], "figureLabel", 50)
    if "tags" in body:
        inst.tags = clean.string_list(body["tags"], "tags", 30, 50)
    if "customFields" in body:
        inst.custom_fields = clean.custom_fields(body["customFields"])
    if "assetId" in body:
        a = await db.get(m.Asset, parse_uuid(body["assetId"])) if parse_uuid(body["assetId"]) else None
        if not a or a.org_id != ctx.org.id:
            fail(404, "not_found", "Asset not found")
        inst.asset_id = a.id
    await _reindex_parent(db, inst)
    await db.flush()
    return (await image_views(db, [inst.id], ctx.org.id))[inst.id]


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
    inst.annotation = {"shapes": clean.shapes(body.get("shapes") or []), "version": cur + 1}
    await _reindex_parent(db, inst)
    await db.flush()
    return (await image_views(db, [inst.id], ctx.org.id))[inst.id]


# ---------------------------------------------------------------- combine / split drafts
# Owner request: imported slides reviewed on the deck can be combined into one post (as the import's
# grouping step allows) and split back, any number of times, until it's published. The combined
# post keeps the first draft; the others are set aside (soft-deleted, marked mergedInto) so a split
# restores them exactly, in their place in the deck.


def _swap_images(node, ids: dict[str, str]):
    """A copy of a block with its image instance references swapped to the combined post's copies."""
    if isinstance(node, dict):
        return {k: (ids.get(v, v) if k == "imageInstanceId" and isinstance(v, str) else _swap_images(v, ids)) for k, v in node.items()}
    if isinstance(node, list):
        return [_swap_images(x, ids) for x in node]
    return node


@router.post("/orgs/{org}/posts/combine")
async def combine(org: str, body: dict = Body(...), u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await org_ctx(db, u, org, "member")
    ids = list(dict.fromkeys(str(x) for x in (body.get("postIds") or [])))
    if len(ids) < 2:
        fail(422, "invalid", "Pick at least two drafts to combine")
    posts = [await editable_post(ctx, x) for x in ids]
    if any(p.status != "draft" for p in posts):
        fail(422, "invalid", "Only drafts can be combined: unpublish a post first")
    if len({p.workspace_id for p in posts}) > 1:
        fail(422, "invalid", "These drafts are in different workspaces")
    target, rest = posts[0], posts[1:]
    blocks = list(target.blocks or [])
    merged = list((target.source or {}).get("mergedFrom") or [])
    t = now()
    for p in rest:
        # Copy the picture references into the combined post (instances belong to one post).
        copies: dict[str, str] = {}
        for old in block_image_ids(p.blocks):
            inst = await db.get(m.ImageInstance, parse_uuid(old))
            if inst:
                new = m.ImageInstance(id=uuid7(), org_id=inst.org_id, asset_id=inst.asset_id, post_id=target.id, caption=inst.caption, alt_text=inst.alt_text, figure_label=inst.figure_label, tags=list(inst.tags or []), custom_fields=dict(inst.custom_fields or {}), annotation=inst.annotation)
                db.add(new)
                copies[old] = str(new.id)
        added = [{**_swap_images(b, copies), "id": str(uuid7())} for b in (p.blocks or [])]
        if not any(b.get("type") == "slide" for b in added):  # plain text slides: say where each one starts
            added = [{"id": str(uuid7()), "type": "slide_break"}, {"id": str(uuid7()), "type": "text", "doc": clean.doc(doc(heading(p.title)))}, *added] if p.title else [{"id": str(uuid7()), "type": "slide_break"}, *added]
        blocks += added
        merged.append({"postId": str(p.id), "title": p.title, "slide": (p.source or {}).get("slide"), "blockIds": [b["id"] for b in added], "imageInstanceIds": list(copies.values())})
        p.deleted_at, p.version, p.updated_at = t, p.version + 1, t
        p.source = {**(p.source or {}), "mergedInto": str(target.id)}
        await changed(db, p)
    target.blocks, target.image_count = blocks, image_count(blocks)
    target.source = {**(target.source or {}), "mergedFrom": merged}
    target.version, target.updated_at = target.version + 1, t
    await changed(db, target)
    return await detail(db, target)


@router.post("/orgs/{org}/posts/{post_id}/split")
async def split(org: str, post_id: str, u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    """Undo a combine: the set-aside drafts come back as they were; their blocks leave this one."""
    ctx = await org_ctx(db, u, org, "member")
    p = await editable_post(ctx, post_id)
    merged = (p.source or {}).get("mergedFrom") or []
    if p.status != "draft" or not merged:
        fail(422, "invalid", "Only a combined draft can be split")
    drop = {b for x in merged for b in x.get("blockIds", [])}
    t = now()
    for x in merged:
        other = await db.get(m.Post, parse_uuid(x["postId"]))
        if other and other.org_id == ctx.org.id:
            other.deleted_at, other.version, other.updated_at = None, other.version + 1, t
            other.source = {k: v for k, v in (other.source or {}).items() if k != "mergedInto"}
            await changed(db, other)
        copies = [parse_uuid(i) for i in x.get("imageInstanceIds", [])]
        if copies:
            await db.execute(delete(m.ImageInstance).where(m.ImageInstance.id.in_([c for c in copies if c]), m.ImageInstance.post_id == p.id))
    p.blocks = [b for b in (p.blocks or []) if b.get("id") not in drop]
    p.image_count = image_count(p.blocks)
    p.source = {k: v for k, v in (p.source or {}).items() if k != "mergedFrom"}
    p.version, p.updated_at = p.version + 1, t
    await changed(db, p)
    return await detail(db, p)
