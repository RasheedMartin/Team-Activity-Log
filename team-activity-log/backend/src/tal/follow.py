"""Notebooks that follow a tag (owner request): newly published posts with the tag are appended,
so the notebook keeps itself current. Everything else about the notebook stays manual: people can
still reorder, add, and remove (a removed post isn't re-added unless it's re-published)."""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from . import models as m
from .outbox import enqueue


async def _append(db: AsyncSession, c: m.CollectionRow, post_ids: list) -> None:
    have = set((await db.execute(select(m.CollectionPost.post_id).where(m.CollectionPost.collection_id == c.id))).scalars())
    last = (await db.execute(select(func.max(m.CollectionPost.position)).where(m.CollectionPost.collection_id == c.id))).scalar()
    pos = last if last is not None else -1
    new = [p for p in post_ids if p not in have]
    for pid in new:
        pos += 1
        db.add(m.CollectionPost(collection_id=c.id, post_id=pid, position=pos))
    if new:
        enqueue(db, c.org_id, new)


async def post_published(db: AsyncSession, p: m.Post, tag_ids: list | None = None) -> None:
    """After a post is published (or a published post's tags change): add it to notebooks following
    any of its tags."""
    if p.status != "published" or p.deleted_at:
        return
    if tag_ids is None:
        tag_ids = list((await db.execute(select(m.PostTag.tag_id).where(m.PostTag.post_id == p.id))).scalars())
    if not tag_ids:
        return
    notebooks = (await db.execute(select(m.CollectionRow).where(m.CollectionRow.workspace_id == p.workspace_id, m.CollectionRow.follows_tag.is_(True), m.CollectionRow.source_tag_id.in_(tag_ids)))).scalars().all()
    for c in notebooks:
        await _append(db, c, [p.id])


async def backfill(db: AsyncSession, c: m.CollectionRow) -> None:
    """Start following: bring in the tag's published posts already there, oldest work first."""
    if not c.follows_tag or not c.source_tag_id:
        return
    ids = (
        await db.execute(
            select(m.Post.id)
            .join(m.PostTag, m.PostTag.post_id == m.Post.id)
            .where(m.PostTag.tag_id == c.source_tag_id, m.Post.workspace_id == c.workspace_id, m.Post.status == "published", m.Post.deleted_at.is_(None))
            .order_by(m.Post.work_date, m.Post.published_at)
        )
    ).scalars().all()
    await _append(db, c, list(ids))
