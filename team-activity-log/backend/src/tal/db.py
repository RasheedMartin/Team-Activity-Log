"""Async Postgres access (SQLAlchemy 2 + asyncpg). One transaction per request."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from .config import get_settings

_engine: AsyncEngine | None = None
_sessions: async_sessionmaker[AsyncSession] | None = None


def engine() -> AsyncEngine:
    global _engine, _sessions
    if _engine is None:
        s = get_settings()
        connect_args = {}
        if s.database_ssl and s.database_ssl != "disable":
            connect_args["ssl"] = s.database_ssl
        _engine = create_async_engine(s.async_database_url, pool_size=s.database_pool_size, pool_pre_ping=True, connect_args=connect_args)
        _sessions = async_sessionmaker(_engine, expire_on_commit=False)
    return _engine


def sessionmaker() -> async_sessionmaker[AsyncSession]:
    engine()
    assert _sessions is not None
    return _sessions


async def get_db() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency (use with scope="function" so this runs *before* the response is sent).

    Commits on success, rolls back on any error. Then read-your-writes for search: posts this
    request queued for reindexing are indexed right away, so a client that publishes and then
    searches sees its change. The outbox worker still processes the same rows (idempotent), so
    if this best-effort step fails nothing is lost.
    """
    async with sessionmaker()() as session:
        try:
            yield session
            await session.commit()
        except BaseException:
            await session.rollback()
            raise
        pending = session.info.pop("reindex", None)
        after = session.info.pop("after_commit", [])
    # Work that must only happen once the change is saved (e.g. telling Stripe the seat count).
    for job in after:
        try:
            await job()
        except Exception:  # noqa: BLE001 - best effort; the job logs and a later sync corrects it
            logging.getLogger("tal.after_commit").warning("after-commit job failed", exc_info=True)
    if pending:
        from .search.indexer import index_posts  # avoid an import cycle

        try:
            async with sessionmaker()() as fresh:
                await index_posts(fresh, list(pending))
        except Exception:  # noqa: BLE001 - the outbox worker retries
            logging.getLogger("tal.indexer").warning("inline reindex failed; the outbox will retry", exc_info=True)


async def dispose() -> None:
    global _engine, _sessions
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _sessions = None
