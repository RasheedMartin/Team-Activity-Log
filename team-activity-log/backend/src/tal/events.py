"""Live events (SSE) over Postgres LISTEN/NOTIFY, so every API process sees every event.

Writers call `emit(db, workspace_id, event)` inside their transaction; Postgres delivers the
NOTIFY only if the transaction commits. One listener connection per process fans events out to
the SSE streams open on that process.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from collections import defaultdict

import asyncpg
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from .config import get_settings

log = logging.getLogger("tal.events")
CHANNEL = "tal_events"

_subscribers: dict[str, set[asyncio.Queue[str]]] = defaultdict(set)
_conn: asyncpg.Connection | None = None


async def emit(db: AsyncSession, workspace_id: uuid.UUID | str, event: dict) -> None:
    payload = json.dumps({"ws": str(workspace_id), "event": event})
    await db.execute(text("select pg_notify(:c, :p)"), {"c": CHANNEL, "p": payload})


def subscribe(workspace_id: str) -> asyncio.Queue[str]:
    q: asyncio.Queue[str] = asyncio.Queue(maxsize=200)
    _subscribers[workspace_id].add(q)
    return q


def unsubscribe(workspace_id: str, q: asyncio.Queue[str]) -> None:
    _subscribers[workspace_id].discard(q)


def _on_notify(_conn: object, _pid: int, _channel: str, payload: str) -> None:
    try:
        msg = json.loads(payload)
    except ValueError:
        return
    data = json.dumps(msg["event"])
    for q in list(_subscribers.get(msg["ws"], ())):
        try:
            q.put_nowait(data)
        except asyncio.QueueFull:
            pass  # a stalled client drops events; it refetches on reconnect


async def start_listener() -> None:
    global _conn
    s = get_settings()
    dsn = s.resolved_database_url.split("://", 1)[1]
    dsn = "postgresql://" + dsn  # asyncpg reads libpq URLs (sslmode included) directly
    try:
        _conn = await asyncpg.connect(dsn, **({"ssl": s.database_ssl} if s.database_ssl and s.database_ssl != "disable" else {}))
        await _conn.add_listener(CHANNEL, _on_notify)
    except Exception:  # noqa: BLE001
        log.exception("live events listener failed to start; SSE will be silent")


async def stop_listener() -> None:
    global _conn
    if _conn is not None:
        await _conn.close()
        _conn = None
