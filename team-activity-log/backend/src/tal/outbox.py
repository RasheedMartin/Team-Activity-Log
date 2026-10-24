"""Transactional outbox (§B5): queue a search reindex in the same transaction as the change."""

from __future__ import annotations

import uuid
from collections.abc import Iterable

from sqlalchemy.ext.asyncio import AsyncSession

from . import models as m


def enqueue(db: AsyncSession, org_id: uuid.UUID, post_ids: Iterable[uuid.UUID]) -> None:
    ids = list(dict.fromkeys(post_ids))
    for pid in ids:
        db.add(m.Outbox(org_id=org_id, entity="post", entity_id=pid))
    # Also indexed right after commit, before the response (see tal.db.get_db).
    db.info.setdefault("reindex", set()).update(ids)
