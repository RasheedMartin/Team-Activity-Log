"""Calendar math for filters and the histogram (port of frontend/src/lib/dates.ts). UTC days."""

from __future__ import annotations

import datetime as dt
from typing import Any

FixedInterval = str  # day | week | month | quarter | year
ORDER = ["day", "week", "month", "quarter", "year"]


def parse_date(s: str) -> dt.date:
    return dt.date.fromisoformat(s[:10])


def add_days(s: str, n: int) -> str:
    return (parse_date(s) + dt.timedelta(days=n)).isoformat()


def days_between(a: str, b: str) -> int:
    return (parse_date(b) - parse_date(a)).days


def bucket_start(d: dt.date, interval: str) -> dt.date:
    if interval == "day":
        return d
    if interval == "week":
        return d - dt.timedelta(days=d.weekday())  # Monday, like ES calendar_interval
    if interval == "month":
        return d.replace(day=1)
    if interval == "quarter":
        return dt.date(d.year, d.month - (d.month - 1) % 3, 1)
    return dt.date(d.year, 1, 1)


def next_bucket(d: dt.date, interval: str) -> dt.date:
    if interval == "day":
        return d + dt.timedelta(days=1)
    if interval == "week":
        return d + dt.timedelta(days=7)
    if interval in ("month", "quarter"):
        step = 1 if interval == "month" else 3
        m = d.month - 1 + step
        return dt.date(d.year + m // 12, m % 12 + 1, 1)
    return dt.date(d.year + 1, 1, 1)


def auto_interval(start: str, end: str) -> str:
    days = days_between(start, end) + 1
    if days <= 60:
        return "day"
    if days <= 366:
        return "week"
    if days <= 4 * 366:
        return "month"
    if days <= 10 * 366:
        return "quarter"
    return "year"


def resolve_range(v: Any, today: dt.date) -> dict[str, str | None]:
    """A stored range (absolute, or a relative preset) as inclusive ISO dates."""
    if not isinstance(v, dict):
        return {"from": None, "to": None}
    if "preset" not in v:
        return {"from": v.get("from") or None, "to": v.get("to") or None}
    t = today.isoformat()
    p = v["preset"]
    if p == "today":
        return {"from": t, "to": t}
    if p == "last_7_days":
        return {"from": add_days(t, -6), "to": t}
    if p == "last_30_days":
        return {"from": add_days(t, -29), "to": t}
    if p == "last_90_days":
        return {"from": add_days(t, -89), "to": t}
    if p == "this_quarter":
        return {"from": bucket_start(today, "quarter").isoformat(), "to": t}
    if p == "this_year":
        return {"from": bucket_start(today, "year").isoformat(), "to": t}
    return {"from": None, "to": None}


def midnight_iso(d: dt.date) -> str:
    return f"{d.isoformat()}T00:00:00.000Z"
