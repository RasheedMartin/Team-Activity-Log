"""Rows -> the JSON shapes in frontend/src/api/contract.ts. Optional fields are omitted when empty."""

from __future__ import annotations

import uuid
from collections import defaultdict
from collections.abc import Iterable, Sequence
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from . import models as m
from .timeutil import iso, iso_date

DEFAULT_PREFS = {"theme": "system", "density": "compact", "histogramDateField": "workDate", "shortcuts": True, "digest": "off", "reducedMotion": False}


def s(v: Any) -> str | None:
    return str(v) if v is not None else None


def clean(d: dict[str, Any]) -> dict[str, Any]:
    """Drop None values (the contract's optional fields are absent, not null)."""
    return {k: v for k, v in d.items() if v is not None}


# ---------------------------------------------------------------- identity


def user_view(u: m.User) -> dict:
    return clean({"id": s(u.id), "name": u.name, "email": u.email, "avatarUrl": u.avatar_url, "title": u.title, "bio": u.bio, "pronouns": u.pronouns, "timezone": u.timezone})


def prefs_view(u: m.User) -> dict:
    p = {**DEFAULT_PREFS, "timezone": u.timezone or "UTC", **(u.preferences or {})}
    return clean(p)


def org_view(o: m.Organization) -> dict:
    return {"id": s(o.id), "name": o.name, "slug": o.slug}


def workspace_view(w: m.Workspace) -> dict:
    return clean({"id": s(w.id), "orgId": s(w.org_id), "name": w.name, "slug": w.slug, "description": w.description, "archived": w.archived, "allOrgMembers": w.all_org_members})


def tag_view(t: m.Tag) -> dict:
    return clean({"id": s(t.id), "name": t.name, "color": t.color, "groupId": s(t.group_id)})


# ---------------------------------------------------------------- assets & images


def asset_url(org_id: uuid.UUID, asset_id: uuid.UUID, variant: str) -> str:
    return f"/v1/orgs/{org_id}/assets/{asset_id}/{variant}"


def asset_view(a: m.Asset) -> dict:
    return clean(
        {
            "id": s(a.id),
            "kind": "image",
            "mime": a.mime,
            "bytes": a.bytes,
            "width": a.width,
            "height": a.height,
            "sha256": a.sha256,
            "originalFilename": a.original_filename,
            "blurhash": a.blurhash,
            "dominantColors": list(a.dominant_colors or []),
            "variants": [{**v, "url": asset_url(a.org_id, a.id, v["name"])} for v in (a.variants or [])],
            "processing": a.processing,
            "metadata": a.metadata_ or {"ocrState": "none", "sourceKind": "upload"},
        }
    )


def instance_view(i: m.ImageInstance) -> dict:
    return clean(
        {
            "id": s(i.id),
            "assetId": s(i.asset_id),
            "postId": s(i.post_id),
            "commentId": s(i.comment_id),
            "caption": i.caption,
            "altText": i.alt_text,
            "figureLabel": i.figure_label,
            "tags": list(i.tags or []),
            "customFields": i.custom_fields or {},
            "annotation": i.annotation,
        }
    )


async def image_views(db: AsyncSession, instance_ids: Sequence[uuid.UUID], org_id: uuid.UUID) -> dict[uuid.UUID, dict]:
    """Image instances *of this org*: an id copied from another tenant's post resolves to nothing."""
    if not instance_ids:
        return {}
    q = select(m.ImageInstance, m.Asset).join(m.Asset, m.Asset.id == m.ImageInstance.asset_id).where(m.ImageInstance.id.in_(instance_ids), m.ImageInstance.org_id == org_id, m.Asset.org_id == org_id)
    rows = (await db.execute(q)).all()
    return {inst.id: {**instance_view(inst), "asset": asset_view(asset)} for inst, asset in rows}


def block_image_ids(blocks: Iterable[dict], content_only: bool = False) -> list[uuid.UUID]:
    """Image instances a post shows: image blocks and images on designed slides. `content_only`
    drops slide template art (a logo on every slide), which search and counts leave out."""
    raw: list = []
    for b in blocks or []:
        if b.get("type") == "image":
            raw.append(b.get("imageInstanceId"))
        elif b.get("type") == "slide":
            raw += [e.get("imageInstanceId") for e in (b.get("design") or {}).get("elements") or [] if e.get("kind") == "image" and not (content_only and e.get("decorative"))]
    out = []
    for x in raw:
        try:
            out.append(uuid.UUID(x))
        except (TypeError, ValueError):
            continue
    return out


def block_docs(blocks: Iterable[dict]) -> list[dict]:
    """ProseMirror docs in reading order: text/table blocks and text on designed slides, except
    template text repeated on every slide (mirrors frontend/src/lib/blocks.ts)."""
    out: list[dict] = []
    for b in blocks or []:
        if b.get("type") in ("text", "table") and b.get("doc"):
            out.append(b["doc"])
        elif b.get("type") == "slide":
            out += [e["doc"] for e in (b.get("design") or {}).get("elements") or [] if e.get("kind") != "image" and e.get("doc") and not e.get("decorative")]
    return out


# ---------------------------------------------------------------- posts


async def post_relations(db: AsyncSession, post_ids: Sequence[uuid.UUID]) -> tuple[dict, dict, dict]:
    tags: dict[uuid.UUID, list[str]] = defaultdict(list)
    co: dict[uuid.UUID, list[str]] = defaultdict(list)
    colls: dict[uuid.UUID, list[str]] = defaultdict(list)
    if post_ids:
        for pid, tid in await db.execute(select(m.PostTag.post_id, m.PostTag.tag_id).where(m.PostTag.post_id.in_(post_ids)).order_by(m.PostTag.post_id, m.PostTag.position)):
            tags[pid].append(str(tid))
        for pid, uid in await db.execute(select(m.PostCoAuthor.post_id, m.PostCoAuthor.user_id).where(m.PostCoAuthor.post_id.in_(post_ids)).order_by(m.PostCoAuthor.post_id, m.PostCoAuthor.position)):
            co[pid].append(str(uid))
        for pid, cid in await db.execute(select(m.CollectionPost.post_id, m.CollectionPost.collection_id).where(m.CollectionPost.post_id.in_(post_ids))):
            colls[pid].append(str(cid))
    return tags, co, colls


def post_view(p: m.Post, tag_ids: list[str], co_author_ids: list[str], collection_ids: list[str]) -> dict:
    return clean(
        {
            "id": s(p.id),
            "orgId": s(p.org_id),
            "workspaceId": s(p.workspace_id),
            "title": p.title,
            "summary": p.summary,
            "workDate": iso_date(p.work_date),
            "workDateSource": p.work_date_source,
            "status": p.status,
            "visibility": p.visibility,
            "hiddenReason": p.hidden_reason,
            "hiddenBy": s(p.hidden_by),
            "hiddenAt": iso(p.hidden_at),
            "authorId": s(p.author_id),
            "coAuthorIds": co_author_ids,
            "tagIds": tag_ids,
            "blocks": p.blocks or [],
            "revision": p.revision,
            "version": p.version,
            "createdAt": iso(p.created_at),
            "updatedAt": iso(p.updated_at),
            "publishedAt": iso(p.published_at),
            "deletedAt": iso(p.deleted_at),
            "counts": {"comments": p.comment_count, "reactions": p.reaction_count, "images": p.image_count},
            "reactions": p.reactions or {},
            "collectionIds": collection_ids,
            "source": p.source,
            "presentation": p.presentation,
        }
    )


async def post_views(db: AsyncSession, posts: Sequence[m.Post]) -> list[dict]:
    tags, co, colls = await post_relations(db, [p.id for p in posts])
    return [post_view(p, tags[p.id], co[p.id], colls[p.id]) for p in posts]


async def post_detail(db: AsyncSession, p: m.Post) -> dict:
    [view] = await post_views(db, [p])
    ids = block_image_ids(p.blocks)
    imgs = await image_views(db, ids, p.org_id)
    return {"post": view, "images": [imgs[i] for i in ids if i in imgs]}


# ---------------------------------------------------------------- discussion


def comment_view(c: m.CommentRow) -> dict:
    base = clean(
        {
            "id": s(c.id),
            "postId": s(c.post_id),
            "parentId": s(c.parent_id),
            "authorId": s(c.author_id),
            "doc": c.doc,
            "imageInstanceIds": [str(x) for x in c.image_instance_ids or []],
            "anchor": c.anchor,
            "isQuestion": c.is_question,
            "resolved": c.resolved,
            "acceptedAnswerId": s(c.accepted_answer_id),
            "hidden": c.hidden,
            "createdAt": iso(c.created_at),
            "editedAt": iso(c.edited_at),
            "deletedAt": iso(c.deleted_at),
            "reactions": c.reactions or {},
            "version": c.version,
        }
    )
    if c.deleted_at:
        # Tombstones keep their place in the tree but lose their content.
        base.update(doc=None, imageInstanceIds=[], reactions={})
    return base


# ---------------------------------------------------------------- library


def saved_view_view(v: m.SavedView, pinned: bool) -> dict:
    return clean({"id": s(v.id), "workspaceId": s(v.workspace_id), "ownerId": s(v.owner_id), "name": v.name, "filterSpec": v.filter_spec, "shared": v.shared, "pinned": pinned, "updatedAt": iso(v.updated_at)})


def collection_view(c: m.CollectionRow, post_ids: list[str]) -> dict:
    return clean(
        {"id": s(c.id), "workspaceId": s(c.workspace_id), "name": c.name, "kind": c.kind, "postIds": post_ids, "createdBy": s(c.created_by), "updatedAt": iso(c.updated_at), "sourceTagId": s(c.source_tag_id), "presentation": c.presentation, "visibility": c.visibility, "followsTag": c.follows_tag or None}
    )


def visible_to(viewer: uuid.UUID | None):
    """Which collection members a person sees: not deleted, and published unless they wrote it
    (others' drafts are unfinished, so they don't show or count)."""
    alive = m.Post.deleted_at.is_(None)
    if viewer is None:
        return alive
    return alive & ((m.Post.status == "published") | (m.Post.author_id == viewer)) & ((m.Post.visibility == "visible") | (m.Post.author_id == viewer))


async def collection_post_ids(db: AsyncSession, collection_ids: Sequence[uuid.UUID], viewer: uuid.UUID | None = None) -> dict[uuid.UUID, list[str]]:
    out: dict[uuid.UUID, list[str]] = defaultdict(list)
    if collection_ids:
        rows = await db.execute(
            # Deleted posts (and, for a viewer, others' drafts) drop out; their membership stays, so
            # restoring or publishing one puts it back in place.
            select(m.CollectionPost.collection_id, m.CollectionPost.post_id)
            .join(m.Post, m.Post.id == m.CollectionPost.post_id)
            .where(m.CollectionPost.collection_id.in_(collection_ids), visible_to(viewer))
            .order_by(m.CollectionPost.collection_id, m.CollectionPost.position)
        )
        for cid, pid in rows:
            out[cid].append(str(pid))
    return out


# ---------------------------------------------------------------- import


def import_job_view(j: m.ImportJobRow) -> dict:
    return clean(
        {
            "id": s(j.id),
            "workspaceId": s(j.workspace_id),
            "status": j.status,
            "progress": j.progress,
            "mode": j.mode,
            "sourceFilename": j.source_filename,
            "sourceBytes": j.source_bytes,
            "slideCount": j.slide_count,
            "defaults": j.defaults,
            "items": j.items or [],
            "collectionId": s(j.collection_id),
            "error": j.error,
            "report": j.report,
        }
    )
