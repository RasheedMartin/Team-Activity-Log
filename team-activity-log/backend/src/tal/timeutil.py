"""Timestamps in the exact shape the frontend uses (JavaScript's toISOString)."""

from __future__ import annotations

import datetime as dt

UTC = dt.UTC


def now() -> dt.datetime:
    return dt.datetime.now(UTC)


def iso(t: dt.datetime | None) -> str | None:
    if t is None:
        return None
    t = t.astimezone(UTC)
    return t.strftime("%Y-%m-%dT%H:%M:%S.") + f"{t.microsecond // 1000:03d}Z"


def parse_iso(s: str | None) -> dt.datetime | None:
    if not s:
        return None
    t = dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
    return t if t.tzinfo else t.replace(tzinfo=UTC)


def iso_date(d: dt.date | None) -> str | None:
    return d.isoformat() if d else None


def today() -> dt.date:
    return now().date()
