"""Library: saved searches, collections, notebooks, and per-person Favorites (pins)."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Body, Depends, Response
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import collection_access as access
from .. import follow
from .. import models as m
from .. import sanitize as clean
from ..context import WsCtx, require_user, role_at_least, ws_ctx
from ..db import get_db
from ..errors import fail
from ..ids import parse_uuid, uuid7
from ..outbox import enqueue
from ..timeutil import iso, now
from ..views import collection_post_ids, collection_view, saved_view_view, visible_to

router = APIRouter()
PAGE = 40
EPOCH = "1970-01-01T00:00:00.000Z"


def kind_of(c: m.CollectionRow) -> str:
    return "notebook" if c.kind == "notebook" else "collection"


async def pins_of(db: AsyncSession, ctx: WsCtx) -> list[m.Pin]:
    return list((await db.execute(select(m.Pin).where(m.Pin.user_id == ctx.user.id, m.Pin.workspace_id == ctx.ws.id).order_by(m.Pin.position))).scalars())


async def pinned_set(db: AsyncSession, ctx: WsCtx) -> set[tuple[str, uuid.UUID]]:
    return {(p.kind, p.item_id) for p in await pins_of(db, ctx)}


async def toggle_pin(db: AsyncSession, ctx: WsCtx, kind: str, item_id: uuid.UUID, on: bool) -> None:
    await db.execute(delete(m.Pin).where(m.Pin.user_id == ctx.user.id, m.Pin.workspace_id == ctx.ws.id, m.Pin.kind == kind, m.Pin.item_id == item_id))
    if on:
        pos = await db.scalar(select(func.coalesce(func.max(m.Pin.position), -1)).where(m.Pin.user_id == ctx.user.id, m.Pin.workspace_id == ctx.ws.id))
        db.add(m.Pin(user_id=ctx.user.id, workspace_id=ctx.ws.id, kind=kind, item_id=item_id, position=(pos or 0) + 1))


async def library_items(db: AsyncSession, ctx: WsCtx) -> list[dict]:
    pinned = await pinned_set(db, ctx)
    views = (
        await db.execute(select(m.SavedView).where(m.SavedView.workspace_id == ctx.ws.id, (m.SavedView.shared.is_(True)) | (m.SavedView.owner_id == ctx.user.id)))
    ).scalars().all()
    colls = (await db.execute(select(m.CollectionRow).where(m.CollectionRow.workspace_id == ctx.ws.id))).scalars().all()
    # Counts are what this person can see; a collection with nothing they can see (e.g. an import
    # whose slides are all someone else's drafts) isn't listed for them, except their own.
    counts = dict((await db.execute(select(m.CollectionPost.collection_id, func.count()).join(m.Post, m.Post.id == m.CollectionPost.post_id).where(m.CollectionPost.collection_id.in_([c.id for c in colls]), visible_to(ctx.user.id)).group_by(m.CollectionPost.collection_id))).all()) if colls else {}
    grants = await access.grants_for(db, ctx.user.id)
    # Hidden: shared-with-specific-people collections you weren't given, and (unless yours or shared
    # with you) ones with nothing you can see yet.
    colls = [c for c in colls if (c.visibility == "workspace" or c.created_by == ctx.user.id or c.id in grants) and (counts.get(c.id) or c.created_by == ctx.user.id or c.id in grants)]
    items = [
        {"kind": "view", "id": str(v.id), "name": v.name, "ownerId": str(v.owner_id), "shared": v.shared, "pinned": ("view", v.id) in pinned, "updatedAt": iso(v.updated_at) or EPOCH, "filterSpec": v.filter_spec}
        for v in views
    ]
    items += [
        {
            "kind": kind_of(c),
            "id": str(c.id),
            "name": c.name,
            "ownerId": str(c.created_by),
            "shared": c.visibility == "workspace",
            "sharedWithMe": c.created_by != ctx.user.id and c.id in grants,
            "pinned": (kind_of(c), c.id) in pinned,
            "updatedAt": iso(c.updated_at) or EPOCH,
            "postCount": counts.get(c.id, 0),
            "collectionKind": c.kind,
        }
        for c in colls
    ]
    return items


@router.get("/orgs/{org}/workspaces/{ws}/library")
async def library(
    org: str, ws: str, kind: str | None = None, q: str = "", mine: str | None = None, shared: str | None = None, sort: str = "recent", limit: int = PAGE, cursor: str | None = None, u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")
):
    ctx = await ws_ctx(db, u, org, ws)
    needle = q.strip().lower()
    scoped = [i for i in await library_items(db, ctx) if (not needle or needle in i["name"].lower()) and (mine != "1" or i["ownerId"] == str(u.id)) and (shared != "1" or i.get("sharedWithMe"))]
    counts = {"view": 0, "notebook": 0, "collection": 0}
    for i in scoped:
        counts[i["kind"]] += 1
    lst = [i for i in scoped if not kind or i["kind"] == kind]
    if sort == "name":
        lst.sort(key=lambda i: (i["name"].lower(), i["id"]))
    else:
        lst.sort(key=lambda i: i["id"])
        lst.sort(key=lambda i: i["updatedAt"], reverse=True)
    limit = max(1, min(limit, 200))
    offset = int(cursor) if cursor and cursor.isdigit() else 0
    page = {"items": lst[offset : offset + limit], "total": len(lst), "counts": counts}
    if offset + limit < len(lst):
        page["nextCursor"] = str(offset + limit)
    return page


@router.get("/orgs/{org}/workspaces/{ws}/pins")
async def get_pins(org: str, ws: str, u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await ws_ctx(db, u, org, ws)
    by_key = {(i["kind"], i["id"]): i for i in await library_items(db, ctx)}
    # Favorites whose item was deleted (or is no longer visible) drop out silently.
    return [by_key[(p.kind, str(p.item_id))] for p in await pins_of(db, ctx) if (p.kind, str(p.item_id)) in by_key]


@router.put("/orgs/{org}/workspaces/{ws}/pins", status_code=204)
async def put_pins(org: str, ws: str, body: dict = Body(...), u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await ws_ctx(db, u, org, ws)
    valid = {(i["kind"], i["id"]) for i in await library_items(db, ctx)}
    await db.execute(delete(m.Pin).where(m.Pin.user_id == u.id, m.Pin.workspace_id == ctx.ws.id))
    seen = set()
    items = body.get("items") if isinstance(body.get("items"), list) else []
    for pos, it in enumerate([x for x in items if isinstance(x, dict) and (x.get("kind"), x.get("id")) in valid][:50]):
        key = (it["kind"], it["id"])
        if key in seen:
            continue
        seen.add(key)
        db.add(m.Pin(user_id=u.id, workspace_id=ctx.ws.id, kind=it["kind"], item_id=uuid.UUID(it["id"]), position=pos))
    return Response(status_code=204)


# ---------------------------------------------------------------- saved searches


async def _view(db: AsyncSession, ctx: WsCtx, view_id: str, *, visible_only: bool = True) -> m.SavedView:
    v = await db.get(m.SavedView, parse_uuid(view_id)) if parse_uuid(view_id) else None
    if not v or v.workspace_id != ctx.ws.id or (visible_only and not v.shared and v.owner_id != ctx.user.id):
        fail(404, "not_found", "View not found")
    return v


@router.get("/orgs/{org}/workspaces/{ws}/saved-views/{view_id}")
async def get_view(org: str, ws: str, view_id: str, u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await ws_ctx(db, u, org, ws)
    v = await _view(db, ctx, view_id)
    return saved_view_view(v, ("view", v.id) in await pinned_set(db, ctx))


@router.post("/orgs/{org}/workspaces/{ws}/saved-views", status_code=201)
async def create_view(org: str, ws: str, body: dict = Body(...), u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await ws_ctx(db, u, org, ws)
    name = clean.text(body.get("name"), "name", 200, required=True, label="Name") or ""
    spec = {k: v for k, v in clean.filter_spec(body.get("filterSpec")).items() if k not in ("cursor", "limit")}
    t = now()
    v = m.SavedView(id=uuid7(), org_id=ctx.org.id, workspace_id=ctx.ws.id, owner_id=u.id, name=name, filter_spec=spec, shared=bool(body.get("shared")), created_at=t, updated_at=t)
    db.add(v)
    await db.flush()
    if body.get("pinned", True):
        await toggle_pin(db, ctx, "view", v.id, True)
    await db.flush()
    return saved_view_view(v, ("view", v.id) in await pinned_set(db, ctx))


@router.patch("/orgs/{org}/workspaces/{ws}/saved-views/{view_id}")
async def patch_view(org: str, ws: str, view_id: str, body: dict = Body(...), u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await ws_ctx(db, u, org, ws)
    v = await _view(db, ctx, view_id)
    # Favoriting is personal: anyone who can see a view may star it; editing needs ownership.
    if body.get("pinned") is not None:
        await toggle_pin(db, ctx, "view", v.id, bool(body["pinned"]))
    edits = {k: body[k] for k in ("name", "filterSpec", "shared") if k in body}
    if edits:
        if v.owner_id != u.id and not ctx.is_admin:
            fail(403, "forbidden", "Only the owner can change this view")
        if "name" in edits:
            v.name = clean.text(edits["name"], "name", 200, required=True, label="Name") or v.name
        if "filterSpec" in edits:
            v.filter_spec = {k: x for k, x in clean.filter_spec(edits["filterSpec"]).items() if k not in ("cursor", "limit")}
        if "shared" in edits:
            v.shared = bool(edits["shared"])
        v.updated_at = now()
    await db.flush()
    return saved_view_view(v, ("view", v.id) in await pinned_set(db, ctx))


@router.delete("/orgs/{org}/workspaces/{ws}/saved-views/{view_id}", status_code=204)
async def delete_view(org: str, ws: str, view_id: str, u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await ws_ctx(db, u, org, ws)
    v = await _view(db, ctx, view_id, visible_only=False)
    if v.owner_id != u.id and not ctx.is_admin:
        fail(403, "forbidden", "Only the owner can delete this view")
    await db.execute(delete(m.Pin).where(m.Pin.kind == "view", m.Pin.item_id == v.id))
    await db.delete(v)
    return Response(status_code=204)


# ---------------------------------------------------------------- collections & notebooks


async def _collection(db: AsyncSession, ctx: WsCtx, cid: str) -> m.CollectionRow:
    c = await db.get(m.CollectionRow, parse_uuid(cid)) if parse_uuid(cid) else None
    if not c or c.workspace_id != ctx.ws.id or await access.role_in(db, ctx, c) == "none":
        fail(404, "not_found", "Collection not found")  # a notebook shared with others only doesn't exist for you
    return c


async def _view_of(db: AsyncSession, c: m.CollectionRow, viewer: uuid.UUID, ctx: WsCtx | None = None) -> dict:
    await db.flush()
    view = collection_view(c, (await collection_post_ids(db, [c.id], viewer))[c.id])
    view["members"] = await access.members(db, c)
    # Made by an import (a deck, or a document as a notebook): its source, for "Download original".
    # Several imports can extend one deck or notebook: every file it came from, oldest first.
    jobs = (await db.execute(select(m.ImportJobRow).where(m.ImportJobRow.collection_id == c.id, m.ImportJobRow.status == "done").order_by(m.ImportJobRow.created_at))).scalars().all()
    if jobs:
        view["sources"] = [{"importJobId": str(x.id), "fileName": x.source_filename, "fileKind": (x.defaults or {}).get("fileKind") or "pptx", "originalKept": bool((x.defaults or {}).get("originalKept"))} for x in jobs]
        view["source"] = view["sources"][0]
    if ctx is not None:
        view["myRole"] = await access.role_in(db, ctx, c)
    return view


async def assert_unique_notebook_name(db: AsyncSession, ws_id, name: str, except_id=None) -> None:
    q = select(m.CollectionRow).where(m.CollectionRow.workspace_id == ws_id, m.CollectionRow.kind == "notebook", func.lower(func.trim(m.CollectionRow.name)) == name.strip().lower())
    if except_id:
        q = q.where(m.CollectionRow.id != except_id)
    clash = (await db.execute(q)).scalars().first()
    if clash:
        fail(409, "name_taken", f"A notebook named “{clash.name}” already exists", {"existingId": str(clash.id)})


async def set_collection_posts(db: AsyncSession, c: m.CollectionRow, post_ids: list, keep_unseen_by: uuid.UUID | None = None) -> None:
    """Replace membership; reindex every post that joined or left (collection is a search filter).
    With keep_unseen_by, members that person can't see (others' drafts, deleted posts) are kept,
    after the ones they arranged: someone reordering a deck can't drop a colleague's drafts."""
    before = set((await db.execute(select(m.CollectionPost.post_id).where(m.CollectionPost.collection_id == c.id))).scalars())
    ids = clean.uuid_list(post_ids, "postIds", 5000)
    if keep_unseen_by is not None:
        seen = set((await db.execute(select(m.CollectionPost.post_id).join(m.Post, m.Post.id == m.CollectionPost.post_id).where(m.CollectionPost.collection_id == c.id, visible_to(keep_unseen_by)))).scalars())
        unseen = (await db.execute(select(m.CollectionPost.post_id).where(m.CollectionPost.collection_id == c.id, m.CollectionPost.post_id.not_in(seen or {uuid.uuid4()})).order_by(m.CollectionPost.position))).scalars().all()
        ids = [*ids, *(x for x in unseen if x not in ids)]
    valid = set((await db.execute(select(m.Post.id).where(m.Post.id.in_(ids), m.Post.org_id == c.org_id))).scalars()) if ids else set()
    await db.execute(delete(m.CollectionPost).where(m.CollectionPost.collection_id == c.id))
    for pos, pid in enumerate(x for x in ids if x in valid):
        db.add(m.CollectionPost(collection_id=c.id, post_id=pid, position=pos))
    enqueue(db, c.org_id, before | valid)


@router.get("/orgs/{org}/workspaces/{ws}/collections/{cid}")
async def get_collection(org: str, ws: str, cid: str, u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await ws_ctx(db, u, org, ws)
    c = await _collection(db, ctx, cid)
    view = await _view_of(db, c, ctx.user.id, ctx)
    if not view["postIds"] and view["myRole"] == "viewer":
        fail(404, "not_found", "Collection not found")  # nothing published in it yet
    return view


@router.get("/orgs/{org}/workspaces/{ws}/collections/{cid}/entries")
async def entries(org: str, ws: str, cid: str, u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await ws_ctx(db, u, org, ws)
    c = await _collection(db, ctx, cid)
    rows = await db.execute(select(m.Post).join(m.CollectionPost, m.CollectionPost.post_id == m.Post.id).where(m.CollectionPost.collection_id == c.id).order_by(m.CollectionPost.position))
    out = []
    # In collection order; posts the caller can't see (others' drafts, deleted, hidden) are skipped.
    for p in rows.scalars():
        if p.deleted_at or (p.status != "published" and p.author_id != u.id):
            continue
        if p.visibility != "visible" and p.author_id != u.id and not role_at_least(ctx.role, "admin"):
            continue
        out.append({"id": str(p.id), "title": p.title, "workDate": p.work_date.isoformat(), "authorId": str(p.author_id), "status": p.status})
    return out


@router.post("/orgs/{org}/workspaces/{ws}/collections", status_code=201)
async def create_collection(org: str, ws: str, body: dict = Body(...), u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await ws_ctx(db, u, org, ws, "member")
    name = clean.text(body.get("name"), "name", 300, required=True, label="Name") or ""
    # Hand-picked groups are notebooks now (owner decision); decks come only from imports.
    kind = "notebook"
    tag_id = parse_uuid(body.get("sourceTagId"))
    if kind == "notebook":
        # One notebook per tag (survives renames), and notebook names are unique.
        if tag_id:
            by_tag = (
                await db.execute(select(m.CollectionRow).where(m.CollectionRow.workspace_id == ctx.ws.id, m.CollectionRow.kind == "notebook", m.CollectionRow.source_tag_id == tag_id))
            ).scalars().first()
            if by_tag:
                fail(409, "exists", f"This tag already has a notebook: “{by_tag.name}”", {"existingId": str(by_tag.id)})
        await assert_unique_notebook_name(db, ctx.ws.id, name)
    t = now()
    # Notebooks are manual, except one made from a tag, which follows it (owner decision); anyone
    # can switch following on or off later.
    c = m.CollectionRow(id=uuid7(), org_id=ctx.org.id, workspace_id=ctx.ws.id, name=name, kind=kind, created_by=u.id, source_tag_id=tag_id, follows_tag=bool(tag_id), created_at=t, updated_at=t)
    db.add(c)
    await db.flush()
    await set_collection_posts(db, c, body.get("postIds") or [], keep_unseen_by=ctx.user.id)
    return await _view_of(db, c, ctx.user.id, ctx)


@router.patch("/orgs/{org}/workspaces/{ws}/collections/{cid}")
async def patch_collection(org: str, ws: str, cid: str, body: dict = Body(...), u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await ws_ctx(db, u, org, ws)
    c = await _collection(db, ctx, cid)
    if body.get("pinned") is not None:
        await toggle_pin(db, ctx, kind_of(c), c.id, bool(body["pinned"]))
    if "name" in body and body["name"] is not None:
        await access.require(db, ctx, c, "editor")
        name = clean.text(body["name"], "name", 300, required=True, label="Name") or ""
        if c.kind == "notebook":
            await assert_unique_notebook_name(db, ctx.ws.id, name, c.id)
        c.name, c.updated_at = name, now()
    if "followTagId" in body:  # null stops following
        await access.require(db, ctx, c, "editor")
        tag = parse_uuid(str(body["followTagId"])) if body["followTagId"] else None
        if tag and not await db.scalar(select(m.Tag.id).where(m.Tag.id == tag, m.Tag.org_id == ctx.org.id)):
            fail(422, "invalid", "Unknown tag")
        if tag:
            clash = (await db.execute(select(m.CollectionRow).where(m.CollectionRow.workspace_id == ctx.ws.id, m.CollectionRow.kind == "notebook", m.CollectionRow.source_tag_id == tag, m.CollectionRow.id != c.id))).scalars().first()
            if clash:
                fail(409, "exists", f"“{clash.name}” already follows this tag", {"existingId": str(clash.id)})
            c.source_tag_id, c.follows_tag = tag, True
            await follow.backfill(db, c)
        else:
            c.follows_tag = False
        c.updated_at = now()
    if "visibility" in body:
        await access.require(db, ctx, c, "owner")
        if body["visibility"] not in ("workspace", "people"):
            fail(422, "invalid", "Visibility is workspace or people")
        c.visibility, c.updated_at = body["visibility"], now()
    if "presentation" in body:
        await access.require(db, ctx, c, "editor")
        c.presentation, c.updated_at = clean.presentation(body["presentation"]), now()
    return await _view_of(db, c, ctx.user.id, ctx)


@router.put("/orgs/{org}/workspaces/{ws}/collections/{cid}/posts")
async def put_collection_posts(org: str, ws: str, cid: str, body: dict = Body(...), u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await ws_ctx(db, u, org, ws, "member")
    c = await _collection(db, ctx, cid)
    await access.require(db, ctx, c, "editor")
    await set_collection_posts(db, c, body.get("postIds") or [], keep_unseen_by=ctx.user.id)
    c.updated_at = now()
    return await _view_of(db, c, ctx.user.id, ctx)


@router.delete("/orgs/{org}/workspaces/{ws}/collections/{cid}")
async def delete_collection(org: str, ws: str, cid: str, deleteMyPosts: bool = False, u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):  # noqa: N803 - query param name
    """Removes the grouping. With deleteMyPosts, the caller's own posts in it go to the recycle bin
    too (others' posts pulled into a notebook are never touched). Returns those post ids for undo."""
    ctx = await ws_ctx(db, u, org, ws, "member")
    c = await _collection(db, ctx, cid)
    await access.require(db, ctx, c, "owner")
    gone: list[str] = []
    if deleteMyPosts:
        t = now()
        mine = (await db.execute(select(m.Post).join(m.CollectionPost, m.CollectionPost.post_id == m.Post.id).where(m.CollectionPost.collection_id == c.id, m.Post.author_id == u.id, m.Post.deleted_at.is_(None)))).scalars().all()
        for p in mine:
            p.deleted_at, p.version, p.updated_at = t, p.version + 1, t
            gone.append(str(p.id))
    await set_collection_posts(db, c, [])
    await db.execute(delete(m.Pin).where(m.Pin.item_id == c.id))
    await db.delete(c)
    return {"deletedPostIds": gone}


@router.put("/orgs/{org}/workspaces/{ws}/collections/{cid}/members")
async def put_members(org: str, ws: str, cid: str, body: dict = Body(...), u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    """Owners set who else can edit or own it: [{userId, role: viewer|editor|owner}]. Everyone in
    the workspace can view regardless; "viewer" here just removes someone's extra access."""
    ctx = await ws_ctx(db, u, org, ws, "member")
    c = await _collection(db, ctx, cid)
    await access.require(db, ctx, c, "owner")
    if "visibility" in body:  # set together with the people, from the Share dialog
        if body["visibility"] not in ("workspace", "people"):
            fail(422, "invalid", "Visibility is workspace or people")
        c.visibility = body["visibility"]
    wanted: dict[uuid.UUID, str] = {}
    for x in body.get("members") or []:
        uid, role = parse_uuid(str(x.get("userId"))), x.get("role")
        if not uid or role not in access.ROLES:
            fail(422, "invalid", "Each member needs a person and a role (viewer, editor, owner)")
        if uid != c.created_by:
            wanted[uid] = role
    if wanted:
        ok = set((await db.execute(select(m.Membership.user_id).where(m.Membership.org_id == ctx.org.id, m.Membership.user_id.in_(list(wanted)), m.Membership.status == "active"))).scalars())
        if missing := set(wanted) - ok:
            fail(422, "invalid", f"{len(missing)} of these people aren't in this organization")
    await db.execute(delete(m.CollectionMember).where(m.CollectionMember.collection_id == c.id))
    for uid, role in wanted.items():
        if role != "viewer" or c.visibility == "people":  # in a workspace-visible one, everyone views anyway
            db.add(m.CollectionMember(collection_id=c.id, user_id=uid, role=role))
    await db.flush()
    return await _view_of(db, c, ctx.user.id, ctx)
