"""UUIDv7: time-ordered ids, generated in the app (works on any Postgres version)."""

from __future__ import annotations

import os
import time
import uuid


def uuid7(ms: int | None = None) -> uuid.UUID:
    ts = int(time.time() * 1000) if ms is None else ms
    b = bytearray(ts.to_bytes(6, "big") + os.urandom(10))
    b[6] = (b[6] & 0x0F) | 0x70
    b[8] = (b[8] & 0x3F) | 0x80
    return uuid.UUID(bytes=bytes(b))


def parse_uuid(value: object) -> uuid.UUID | None:
    """Lenient parse for ids arriving in paths and bodies: bad ids are simply 'not found'."""
    if isinstance(value, uuid.UUID):
        return value
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        return None
