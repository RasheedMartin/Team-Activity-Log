"""Postgres -> Elasticsearch (§B5).

- `ensure_index()` creates the versioned index and its alias on first run (idempotent).
- `index_posts()` rebuilds documents for some posts and bulk-writes them (or deletes them).
- `run_indexer()` drains the outbox continuously: claims rows with SKIP LOCKED (safe with several
  workers), coalesces repeated events per post, retries with backoff, never loses a write.
- `reindex_all()` is the backfill / disaster-recovery path: Postgres is the truth.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from collections.abc import Sequence

from elasticsearch import NotFoundError
from elasticsearch.helpers import async_bulk
from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models as m
from ..config import get_settings
from ..db import sessionmaker
from ..timeutil import now
from .client import es
from .documents import build_documents
from .mapping import MAPPING_VERSION, POSTS, SETTINGS, alias_name, index_name

log = logging.getLogger("tal.indexer")
BATCH = 500
MAX_ATTEMPTS = 8


def alias() -> str:
    return alias_name(get_settings().elasticsearch_index_prefix)


async def ensure_index(version: int = MAPPING_VERSION) -> str:
    """Create `<prefix>_posts_v<version>` and point the alias at it if nothing has the alias yet."""
    client = es()
    prefix = get_settings().elasticsearch_index_prefix
    name = index_name(prefix, version)
    if not await client.indices.exists(index=name):
        await client.indices.create(index=name, settings=SETTINGS, mappings=POSTS)
        log.info("created index %s", name)
    if not await client.indices.exists_alias(name=alias()):
        await client.indices.put_alias(index=name, name=alias())
    return name


def _refresh() -> str | bool:
    r = get_settings().elasticsearch_refresh
    return "wait_for" if r == "wait_for" else r == "true"


async def index_posts(db: AsyncSession, post_ids: Sequence[uuid.UUID], *, index: str | None = None, refresh: str | bool | None = None) -> int:
    docs, remove = await build_documents(db, list(post_ids))
    target = index or alias()
    actions: list[dict] = [{"_op_type": "index", "_index": target, "_id": str(pid), "_routing": d["org_id"], "_source": d} for pid, d in docs.items()]
    actions += [{"_op_type": "delete", "_index": target, "_id": str(pid)} for pid in remove]
    if not actions:
        return 0
    # Deletes of never-indexed docs (drafts) come back 404; that's fine.
    ok, errors = await async_bulk(es(), actions, raise_on_error=False, refresh=_refresh() if refresh is None else refresh)
    real = [e for e in errors if next(iter(e.values())).get("status") != 404]  # type: ignore[union-attr]
    if real:
        raise RuntimeError(f"{len(real)} indexing errors, first: {real[0]}")
    return len(docs)


async def drain_once(limit: int = BATCH) -> int:
    """Claim a batch of outbox rows, index their posts once each, mark them done."""
    async with sessionmaker()() as db:
        rows = (
            await db.execute(
                select(m.Outbox).where(m.Outbox.processed_at.is_(None), m.Outbox.attempts < MAX_ATTEMPTS).order_by(m.Outbox.id).limit(limit).with_for_update(skip_locked=True)
            )
        ).scalars().all()
        if not rows:
            await db.rollback()
            return 0
        ids = list({r.entity_id for r in rows if r.entity == "post"})
        try:
            await index_posts(db, ids)
            await db.execute(update(m.Outbox).where(m.Outbox.id.in_([r.id for r in rows])).values(processed_at=now()))
        except Exception as e:  # noqa: BLE001 - recorded on the rows, retried
            log.exception("indexing batch failed")
            await db.execute(update(m.Outbox).where(m.Outbox.id.in_([r.id for r in rows])).values(attempts=m.Outbox.attempts + 1, last_error=str(e)[:2000]))
        await db.commit()
        return len(rows)


async def run_indexer(stop: asyncio.Event) -> None:
    """Background loop. Polls fast while there's work, backs off when idle or failing."""
    delay = 0.2
    while not stop.is_set():
        try:
            n = await drain_once()
            delay = 0.05 if n else min(delay * 1.5, 1.0)
        except Exception:  # noqa: BLE001
            log.exception("indexer loop error")
            delay = min(delay * 2, 10.0)
        try:
            await asyncio.wait_for(stop.wait(), timeout=delay)
        except TimeoutError:
            pass


async def reindex_all(org_id: uuid.UUID | None = None, *, new_version: int | None = None) -> int:
    """Rebuild the index from Postgres. With new_version: build a fresh index and swap the alias."""
    client = es()
    target = None
    if new_version:
        target = await ensure_index(new_version)
    else:
        await ensure_index()
    total = 0
    async with sessionmaker()() as db:
        q = select(m.Post.id).where(m.Post.status == "published", m.Post.deleted_at.is_(None)).order_by(m.Post.id)
        if org_id:
            q = q.where(m.Post.org_id == org_id)
        ids = list((await db.execute(q)).scalars())
        for i in range(0, len(ids), BATCH):
            total += await index_posts(db, ids[i : i + BATCH], index=target, refresh=False)
        # Mark everything that was pending as done: the backfill covered it.
        await db.execute(text("update outbox set processed_at = now() where processed_at is null"))
        await db.commit()
    await client.indices.refresh(index=target or alias())
    if new_version and target:
        prefix = get_settings().elasticsearch_index_prefix
        actions = [{"add": {"index": target, "alias": alias_name(prefix)}}]
        try:
            for old in (await client.indices.get_alias(name=alias_name(prefix))).keys():
                if old != target:
                    actions.append({"remove": {"index": old, "alias": alias_name(prefix)}})
        except NotFoundError:
            pass
        await client.indices.update_aliases(actions=actions)
    return total


async def drop_org(org_id: uuid.UUID) -> None:
    await es().delete_by_query(index=alias(), query={"term": {"org_id": str(org_id)}}, refresh=True, conflicts="proceed")
