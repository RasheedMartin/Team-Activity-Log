"""Search, Explore, Suggest (Elasticsearch; tenant + permission filters injected server-side)."""

from __future__ import annotations

from elasticsearch import ApiError as EsApiError
from elasticsearch import ConnectionError as EsConnectionError
from fastapi import APIRouter, Body, Depends
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models as m
from ..context import WsCtx, require_user, ws_ctx
from ..db import get_db
from ..errors import fail
from ..search import service
from ..search.translate import SearchCtx
from ..timeutil import today
from ..views import tag_view, user_view

router = APIRouter()


def search_ctx(ctx: WsCtx, can_see_hidden: bool | None = None) -> SearchCtx:
    return SearchCtx(
        org_id=str(ctx.org.id),
        workspace_ids=[str(ctx.ws.id)],
        me=str(ctx.user.id),
        can_see_hidden=ctx.is_admin if can_see_hidden is None else can_see_hidden,
        today=today(),
    )


async def guarded(coro):
    """Search down never takes the rest of the app with it (§B6): a clear, quiet 503."""
    try:
        return await coro
    except (EsConnectionError, EsApiError) as e:
        status = getattr(e, "status_code", None) or getattr(getattr(e, "meta", None), "status", None)
        if status == 400:
            fail(400, "bad_query", "That search couldn't be run. Check the syntax and try again.")
        fail(503, "search_unavailable", "Search is temporarily unavailable. Everything else still works.")


@router.post("/orgs/{org}/workspaces/{ws}/search")
async def search(org: str, ws: str, spec: dict = Body(default={}), u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await ws_ctx(db, u, org, ws)
    return await guarded(service.search(db, spec or {}, search_ctx(ctx)))


@router.get("/orgs/{org}/workspaces/{ws}/explore")
async def explore(org: str, ws: str, u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await ws_ctx(db, u, org, ws)
    res = await guarded(service.explore(db, search_ctx(ctx, False)))
    groups = {g.id: g.name for g in (await db.execute(select(m.TagGroup).where(m.TagGroup.org_id == ctx.org.id))).scalars()}
    tag_group = {str(t.id): t.group_id for t in (await db.execute(select(m.Tag).where(m.Tag.org_id == ctx.org.id))).scalars()}
    notebooks = {
        str(c.source_tag_id): str(c.id)
        for c in (await db.execute(select(m.CollectionRow).where(m.CollectionRow.workspace_id == ctx.ws.id, m.CollectionRow.kind == "notebook", m.CollectionRow.source_tag_id.is_not(None)))).scalars()
    }
    for sh in res["shelves"]:
        gid = tag_group.get(sh["tag"]["id"])
        sh["groupName"] = groups.get(gid) or "Other" if gid else "Other"
        if sh["tag"]["id"] in notebooks:
            sh["notebookId"] = notebooks[sh["tag"]["id"]]
    return res


@router.get("/orgs/{org}/workspaces/{ws}/suggest")
async def suggest(org: str, ws: str, q: str = "", u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await ws_ctx(db, u, org, ws)
    q = q.strip().lower()
    if not q:
        return {"tags": [], "people": [], "posts": []}

    def starts(s: str) -> bool:
        s = s.lower()
        return s.startswith(q) or any(w.startswith(q) for w in s.replace("-", " ").split())

    like = f"%{q.replace('%', '').replace('_', '')}%"
    tags = [t for t in (await db.execute(select(m.Tag).where(m.Tag.org_id == ctx.org.id, func.lower(m.Tag.name).like(like)).order_by(m.Tag.name).limit(50))).scalars() if starts(t.name)][:5]
    people_rows = await db.execute(
        select(m.User).join(m.Membership, m.Membership.user_id == m.User.id).where(m.Membership.org_id == ctx.org.id, or_(func.lower(m.User.name).like(like), func.lower(m.User.email).like(f"{q}%"))).limit(50)
    )
    people = [p for p in people_rows.scalars() if starts(p.name) or p.email.lower().startswith(q)][:5]
    try:
        res = await service.search(db, {"q": q, "limit": 5, "sort": "relevance"}, search_ctx(ctx, False))
        posts = [{"id": h["post"]["id"], "title": h["post"]["title"]} for h in res["hits"]]
    except (EsConnectionError, EsApiError):
        posts = []
    return {"tags": [tag_view(t) for t in tags], "people": [user_view(p) for p in people], "posts": posts}
