"""Saved-search alerts (owner request): follow a saved search and hear about new posts that match.

Each alert is checked as its subscriber, through the same translation and permission filters as
Search, limited to posts published since the last check (so relative dates, hidden posts, and
workspace access all behave exactly as they do on the Search page). Your own posts never alert you.

  instant  checked every minute; new matches arrive in Activity
  daily    checked once a day; Activity, plus an email digest
  weekly   the same, once a week

Posts reach search a moment after they're published, so each check looks back a little past the
last one and skips posts it already reported (`recent_ids`).

Cost: a round first asks Postgres which workspaces had anything published since their alerts were
last checked (one query); only alerts in those workspaces run a search. So the work follows how
much is published, not how many alerts exist. (At very large alert counts, Elasticsearch's
percolator, which matches each new post against stored queries, is the next step; alerts are
stored independently of how they're run, so that change wouldn't touch the API.)
"""

from __future__ import annotations

import asyncio
import datetime as dt
import logging
import uuid

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from . import models as m
from . import sanitize as clean
from .context import ws_ctx
from .db import sessionmaker
from .ids import uuid7
from .search.client import es
from .search.indexer import alias
from .search.translate import SearchCtx, translate
from .timeutil import iso, now, today

log = logging.getLogger("tal.alerts")

MODES = {"instant": dt.timedelta(0), "daily": dt.timedelta(days=1), "weekly": dt.timedelta(days=7)}
EVERY = 60  # seconds between rounds
LAG = dt.timedelta(minutes=10)  # look-back for posts indexed after the previous check
BATCH = 200
MAX_LISTED = 10  # posts named in a digest email


async def new_matches(db: AsyncSession, a: m.SearchAlert, view: m.SavedView, user: m.User) -> list[tuple[str, str]] | None:
    """(post id, published_at) of matching posts published since the last check, newest first;
    None when the person can no longer see the saved search."""
    if not view.shared and view.owner_id != user.id:
        return None
    try:
        ctx = await ws_ctx(db, user, str(view.org_id), str(view.workspace_id))
    except Exception:  # noqa: BLE001 - left the org or lost the workspace
        return None
    sctx = SearchCtx(org_id=str(ctx.org.id), workspace_ids=[str(ctx.ws.id)], me=str(user.id), can_see_hidden=ctx.is_admin, today=today())
    t = translate(clean.filter_spec(view.filter_spec or {}, "search"), sctx)
    query = {
        "bool": {
            "filter": [t.query(), t.except_(None), {"range": {"published_at": {"gt": iso(a.checked_at - LAG)}}}],
            "must_not": [{"term": {"author_ids": str(user.id)}}],
        }
    }
    res = await es().search(index=alias(), routing=str(ctx.org.id), query=query, size=100, sort=[{"published_at": "desc"}], source=["published_at"])
    return [(h["_id"], h["_source"]["published_at"]) for h in res["hits"]["hits"]]


async def check(db: AsyncSession, a: m.SearchAlert, at: dt.datetime, quiet: bool = False) -> int:
    """Run one alert; returns how many new posts it reported. `quiet`: nothing was published in its
    workspace since the look-back, so there's nothing to search for."""
    view = await db.get(m.SavedView, a.view_id)
    user = await db.get(m.User, a.user_id)
    hits = None if quiet else await new_matches(db, a, view, user) if view and user else None
    seen = set(a.recent_ids or [])
    fresh = [pid for pid, _ in (hits or []) if pid not in seen]
    # Anything published inside the next look-back window may be found again: remember it.
    a.recent_ids = [pid for pid, published in (hits or []) if published > iso(at - LAG)]
    a.checked_at = at
    if not fresh or not view or not user:
        return 0
    db.add(
        m.NotificationRow(
            id=uuid7(), user_id=user.id, org_id=view.org_id, workspace_id=view.workspace_id, kind="alert", post_id=uuid.UUID(fresh[0]), saved_view_id=view.id, count=len(fresh), created_at=at
        )
    )
    if a.mode != "instant":
        await _digest(db, a, view, user, fresh)
    return len(fresh)


async def _digest(db: AsyncSession, a: m.SearchAlert, view: m.SavedView, user: m.User, ids: list[str]) -> None:
    posts = {str(p.id): p for p in (await db.execute(select(m.Post).where(m.Post.id.in_([uuid.UUID(i) for i in ids[:MAX_LISTED]])))).scalars()}
    org = await db.get(m.Organization, view.org_id)
    ws = await db.get(m.Workspace, view.workspace_id)
    if not org or not ws:
        return
    base = f"/o/{org.slug}/w/{ws.slug}"
    period = "today" if a.mode == "daily" else "this week"
    lines = [f"{len(ids)} new post{'s' if len(ids) != 1 else ''} {period} match your saved search “{view.name}”:", ""]
    lines += [f"• {posts[i].title or 'Untitled'}" for i in ids[:MAX_LISTED] if i in posts]
    if len(ids) > MAX_LISTED:
        lines.append(f"…and {len(ids) - MAX_LISTED} more.")
    lines += ["", f"Change or stop this alert from the saved search in {ws.name}."]
    db.add(m.Email(id=uuid7(), to=user.email, subject=f"{len(ids)} new in “{view.name}”", body="\n".join(lines), link=f"{base}/search?view={view.id}"))


async def run_once() -> int:
    """One round over the alerts that are due."""
    at = now()
    due = or_(*[(m.SearchAlert.mode == mode) & (m.SearchAlert.checked_at <= at - every) for mode, every in MODES.items()])
    async with sessionmaker()() as db:
        rows = (
            await db.execute(
                select(m.SearchAlert.id, m.SearchAlert.checked_at, m.SavedView.workspace_id)
                .join(m.SavedView, m.SavedView.id == m.SearchAlert.view_id)
                .where(due)
                .order_by(m.SearchAlert.checked_at)
                .limit(BATCH)
            )
        ).all()
        if not rows:
            return 0
        # The latest publish per workspace since the oldest look-back among these alerts.
        since = min(r.checked_at for r in rows) - LAG
        latest = dict(
            (
                await db.execute(
                    select(m.Post.workspace_id, func.max(m.Post.published_at))
                    .where(m.Post.workspace_id.in_({r.workspace_id for r in rows}), m.Post.status == "published", m.Post.deleted_at.is_(None), m.Post.published_at > since)
                    .group_by(m.Post.workspace_id)
                )
            ).all()
        )
    total = 0
    for r in rows:  # each in its own transaction: one bad alert doesn't stop the rest
        quiet = not (latest.get(r.workspace_id) and latest[r.workspace_id] > r.checked_at - LAG)
        try:
            async with sessionmaker()() as db:
                a = (await db.execute(select(m.SearchAlert).where(m.SearchAlert.id == r.id).with_for_update(skip_locked=True))).scalar_one_or_none()
                if a:
                    total += await check(db, a, at, quiet)
                    await db.commit()
        except Exception:  # noqa: BLE001 - search down etc.; tried again next round
            log.warning("alert %s failed; will retry", r.id, exc_info=True)
    return total


async def run_alerts(stop: asyncio.Event) -> None:
    while not stop.is_set():
        try:
            await run_once()
        except Exception:  # noqa: BLE001
            log.exception("alerts loop error")
        try:
            await asyncio.wait_for(stop.wait(), timeout=EVERY)
        except TimeoutError:
            pass
