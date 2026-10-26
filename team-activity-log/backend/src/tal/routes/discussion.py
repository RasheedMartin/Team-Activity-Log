"""Comments, reactions, notifications, live events. Postgres is authoritative (§B1)."""

from __future__ import annotations

import asyncio
import uuid

from fastapi import APIRouter, Body, Depends, Request, Response
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models as m
from .. import sanitize as clean
from ..context import OrgCtx, current_user, org_ctx, require_user, visible_post, ws_ctx
from ..db import get_db, sessionmaker
from ..errors import fail
from ..events import emit, subscribe, unsubscribe
from ..ids import parse_uuid, uuid7
from ..outbox import enqueue
from ..prosemirror import doc_text, mentioned_ids
from ..timeutil import now
from ..views import comment_view, iso

router = APIRouter()


async def writable_post(ctx: OrgCtx, post_id) -> m.Post:
    p = await visible_post(ctx, post_id)
    if p.status != "published":
        fail(409, "not_published", "Drafts don't have comments")
    if p.visibility == "hidden":
        fail(409, "read_only", "This post is hidden, so its thread is read-only")
    if p.deleted_at:
        fail(409, "deleted", "This post was deleted")
    return p


async def recount(db: AsyncSession, p: m.Post) -> None:
    await db.flush()
    p.comment_count = await db.scalar(select(func.count()).select_from(m.CommentRow).where(m.CommentRow.post_id == p.id, m.CommentRow.deleted_at.is_(None))) or 0


async def notify(db: AsyncSession, p: m.Post, c: m.CommentRow, actor: uuid.UUID) -> None:
    targets: dict[uuid.UUID, str] = {}
    for x in mentioned_ids(c.doc):
        uid = parse_uuid(x)
        if uid:
            targets[uid] = "mention"
    parent = await db.get(m.CommentRow, c.parent_id) if c.parent_id else None
    if parent and parent.author_id not in targets:
        targets[parent.author_id] = "reply"
    elif not parent and p.author_id not in targets:
        targets[p.author_id] = "reply"
    targets.pop(actor, None)
    members = set((await db.execute(select(m.Membership.user_id).where(m.Membership.org_id == p.org_id, m.Membership.user_id.in_(list(targets))))).scalars()) if targets else set()
    for uid, kind in targets.items():
        if uid in members:
            db.add(m.NotificationRow(id=uuid7(), user_id=uid, org_id=p.org_id, workspace_id=p.workspace_id, kind=kind, post_id=p.id, comment_id=c.id, actor_id=actor, created_at=c.created_at))
    if members:
        await emit(db, p.workspace_id, {"type": "notification"})


async def touched(db: AsyncSession, p: m.Post, c: m.CommentRow | None = None, kind: str = "comment") -> None:
    enqueue(db, p.org_id, [p.id])
    event = {"type": kind, "postId": str(p.id)}
    if c is not None and kind == "comment":
        event["commentId"] = str(c.id)
    await emit(db, p.workspace_id, event)


@router.get("/orgs/{org}/posts/{post_id}/comments")
async def list_comments(org: str, post_id: str, u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await org_ctx(db, u, org)
    p = await visible_post(ctx, post_id)
    rows = (await db.execute(select(m.CommentRow).where(m.CommentRow.post_id == p.id).order_by(m.CommentRow.created_at, m.CommentRow.id))).scalars()
    return [comment_view(c) for c in rows if not c.hidden or ctx.is_admin or c.author_id == u.id]


@router.post("/orgs/{org}/posts/{post_id}/comments", status_code=201)
async def add_comment(org: str, post_id: str, body: dict = Body(...), u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await org_ctx(db, u, org, "member")
    p = await writable_post(ctx, post_id)
    parent_id = parse_uuid(body.get("parentId"))
    if body.get("parentId"):
        parent = await db.get(m.CommentRow, parent_id) if parent_id else None
        if not parent or parent.post_id != p.id:
            fail(404, "not_found", "The comment you replied to is gone")
    c = m.CommentRow(
        id=uuid7(),
        org_id=p.org_id,
        workspace_id=p.workspace_id,
        post_id=p.id,
        parent_id=parent_id,
        author_id=u.id,
        doc=clean.doc(body.get("doc")),
        image_instance_ids=clean.uuid_list(body.get("imageInstanceIds"), "imageInstanceIds", 20),
        anchor=clean.anchor(body.get("anchor")),
        is_question=bool(body.get("isQuestion")),
        resolved=False,
        hidden=False,
        reactions={},
        version=1,
        created_at=now(),
    )
    db.add(c)
    await recount(db, p)
    await notify(db, p, c, u.id)
    await touched(db, p, c)
    return comment_view(c)


async def _comment(ctx: OrgCtx, cid: str) -> m.CommentRow:
    c = await ctx.db.get(m.CommentRow, parse_uuid(cid)) if parse_uuid(cid) else None
    if not c or c.org_id != ctx.org.id:
        fail(404, "not_found", "Comment not found")
    return c


@router.patch("/orgs/{org}/comments/{cid}")
async def edit_comment(org: str, cid: str, body: dict = Body(...), u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await org_ctx(db, u, org, "member")
    c = await _comment(ctx, cid)
    p = await writable_post(ctx, c.post_id)
    if "hidden" in body:
        if not ctx.is_admin:
            fail(403, "forbidden", "Only admins can hide comments")
        c.hidden = bool(body["hidden"])
    else:
        if c.author_id != u.id:
            fail(403, "forbidden", "You can only edit your own comments")
        if body.get("version") is not None and body["version"] != c.version:
            fail(409, "version_conflict", "This comment changed. Reload and retry.")
        if "doc" in body and body["doc"] is not None:
            c.doc, c.edited_at = clean.doc(body["doc"]), now()
        if body.get("isQuestion") is not None:
            c.is_question = bool(body["isQuestion"])
        c.version += 1
    await touched(db, p, c)
    return comment_view(c)


@router.delete("/orgs/{org}/comments/{cid}", status_code=204)
async def delete_comment(org: str, cid: str, u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await org_ctx(db, u, org, "member")
    c = await _comment(ctx, cid)
    p = await visible_post(ctx, c.post_id)
    if c.author_id != u.id and not ctx.is_admin:
        fail(403, "forbidden", "You can only delete your own comments")
    has_replies = await db.scalar(select(func.count()).select_from(m.CommentRow).where(m.CommentRow.parent_id == c.id, m.CommentRow.deleted_at.is_(None)))
    if has_replies:
        c.deleted_at = now()  # tombstone keeps the thread shape
    else:
        await db.delete(c)
    await recount(db, p)
    await touched(db, p, c)
    return Response(status_code=204)


@router.post("/orgs/{org}/comments/{cid}/resolve")
async def resolve(org: str, cid: str, body: dict = Body(...), u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await org_ctx(db, u, org, "member")
    c = await _comment(ctx, cid)
    p = await writable_post(ctx, c.post_id)
    if not c.is_question:
        fail(409, "not_question", "Only questions can be resolved")
    c.resolved = bool(body.get("resolved"))
    c.accepted_answer_id = parse_uuid(body.get("acceptedAnswerId")) if c.resolved else None
    c.version += 1
    await touched(db, p, c)
    return comment_view(c)


def _toggle(reactions: dict, emoji: str, uid: str) -> dict:
    cur = list(reactions.get(emoji) or [])
    nxt = [x for x in cur if x != uid] if uid in cur else [*cur, uid]
    out = {**reactions, emoji: nxt}
    if not nxt:
        out.pop(emoji)
    return out


@router.put("/orgs/{org}/reactions")
async def react(org: str, body: dict = Body(...), u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    # Viewers may react (§A2, open question 4: default yes).
    ctx = await org_ctx(db, u, org, "viewer")
    emoji = body.get("emoji") if isinstance(body.get("emoji"), str) else ""
    if not emoji or len(emoji) > 16 or any(ch.isspace() or ord(ch) < 32 or ch.isascii() and ch.isalnum() for ch in emoji):
        fail(422, "invalid", "Pick an emoji")
    if body.get("targetType") == "post":
        p = await visible_post(ctx, body.get("targetId"), lock=True)
        if p.status != "published":
            fail(409, "not_published", "Drafts can't be reacted to")
        p.reactions = _toggle(p.reactions or {}, emoji, str(u.id))
        p.reaction_count = sum(len(v) for v in p.reactions.values())
        await touched(db, p, kind="reaction")
        return {"reactions": p.reactions}
    c = await _comment(ctx, str(body.get("targetId")))
    p = await visible_post(ctx, c.post_id)
    c.reactions = _toggle(c.reactions or {}, emoji, str(u.id))
    await touched(db, p, kind="reaction")
    return {"reactions": c.reactions}


@router.get("/orgs/{org}/notifications")
async def notifications(org: str, u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await org_ctx(db, u, org)
    rows = (
        await db.execute(
            select(m.NotificationRow, m.Post.title, m.CommentRow, m.SavedView.name)
            .join(m.Post, m.Post.id == m.NotificationRow.post_id)
            .outerjoin(m.CommentRow, m.CommentRow.id == m.NotificationRow.comment_id)
            .outerjoin(m.SavedView, m.SavedView.id == m.NotificationRow.saved_view_id)
            .where(m.NotificationRow.user_id == u.id, m.NotificationRow.org_id == ctx.org.id)
            .order_by(m.NotificationRow.created_at.desc())
            .limit(200)
        )
    ).all()
    out = []
    for n, title, c, view_name in rows:
        text = doc_text(c.doc) if c and not c.deleted_at else ""
        item = {
            "id": str(n.id),
            "kind": n.kind,
            "postId": str(n.post_id),
            # Alerts have no comment or actor: they name the saved search and how many posts matched.
            **({"commentId": str(n.comment_id)} if n.comment_id else {}),
            **({"actorId": str(n.actor_id)} if n.actor_id else {}),
            **({"savedViewId": str(n.saved_view_id), "viewName": view_name, "count": n.count} if n.kind == "alert" else {}),
            "workspaceId": str(n.workspace_id),
            "createdAt": iso(n.created_at),
            "postTitle": title,
            "excerpt": f"{text[:140]}…" if len(text) > 140 else text,
        }
        if n.read_at:
            item["readAt"] = iso(n.read_at)
        out.append(item)
    return out


@router.post("/orgs/{org}/notifications/read", status_code=204)
async def mark_read(org: str, body: dict = Body(default={}), u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await org_ctx(db, u, org)
    q = update(m.NotificationRow).where(m.NotificationRow.user_id == u.id, m.NotificationRow.org_id == ctx.org.id, m.NotificationRow.read_at.is_(None))
    ids = (body or {}).get("ids")
    if ids is not None:
        q = q.where(m.NotificationRow.id.in_(clean.uuid_list(ids, "ids", 1000)))
    await db.execute(q.values(read_at=now()))
    return Response(status_code=204)


@router.get("/orgs/{org}/workspaces/{ws}/events")
async def events(org: str, ws: str, request: Request):
    # Check access with a short-lived session; don't hold a DB connection for the whole stream.
    async with sessionmaker()() as db:
        user = await current_user(request, db)
        if not user:
            fail(401, "unauthenticated", "Sign in to continue")
        ctx = await ws_ctx(db, user, org, ws)
        ws_id = str(ctx.ws.id)

    async def stream():
        q = subscribe(ws_id)
        try:
            yield ": connected\n\n"
            while not await request.is_disconnected():
                try:
                    data = await asyncio.wait_for(q.get(), timeout=15)
                    yield f"data: {data}\n\n"
                except TimeoutError:
                    yield ": keep-alive\n\n"
        finally:
            unsubscribe(ws_id, q)

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
