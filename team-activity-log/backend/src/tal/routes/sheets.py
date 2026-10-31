"""Sheets (tal.sheets): import or start a spreadsheet, browse and edit its tabs, save charts that
posts can embed.

Everyone in the workspace can view a sheet and make charts. Its creator and admins can edit it, or
everyone (not viewers) when the creator opens editing to the workspace. Rows live one per database
row (sheet_rows), so an edit touches only what it changes. An imported file's original is kept
(download); a sheet made in the app has none, and either can be downloaded as CSV in the browser.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import re
import uuid

from fastapi import APIRouter, Body, Depends, Request, Response
from sqlalchemy import delete, func, insert, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models as m
from .. import sanitize as clean
from .. import storage
from ..context import WsCtx, require_user, ws_ctx
from ..db import get_db, sessionmaker
from ..errors import fail
from ..httputil import read_limited
from ..ids import parse_uuid, uuid7
from ..sheets import MAX_ROWS, TYPE_WORD, TYPES, SheetError, Tab, as_text, coerce, infer_type, parse_sheet
from ..timeutil import iso, now

router = APIRouter()
log = logging.getLogger("tal.sheets")
MAX_BYTES = 25 * 1024 * 1024
CHART_TYPES = {"line", "column", "bar", "area", "scatter", "pie"}
AGGS = {"sum", "avg", "count", "min", "max", "none"}
MAX_OPS = 2000  # per edit request
SEARCH_INLINE_ROWS = 5000  # bigger sheets refresh their search text in the background
SEARCH_DELAY = 5.0  # seconds after the last edit
BLANK_COLUMNS = 3
BLANK_ROWS = 5


def _key(org_id: uuid.UUID, sha: str) -> str:
    return storage.user_key("sheets", str(org_id), sha)


def sheet_summary(s: m.Sheet, tabs: list[m.SheetTab]) -> dict:
    return {"id": str(s.id), "workspaceId": str(s.workspace_id), "name": s.name, "filename": s.filename or None, "bytes": s.bytes, "createdBy": str(s.created_by) if s.created_by else None, "updatedAt": iso(s.updated_at), "tabs": len(tabs), "rows": sum(t.row_count for t in tabs)}


def chart_view(c: m.SheetChart) -> dict:
    return {"id": str(c.id), "sheetId": str(c.sheet_id), "tabId": str(c.tab_id), "name": c.name, "spec": c.spec}


def tab_view(t: m.SheetTab) -> dict:
    return {"id": str(t.id), "name": t.name, "columns": t.columns, "rowCount": t.row_count, "truncated": t.truncated}


def can_edit(s: m.Sheet, ctx: WsCtx) -> bool:
    return s.created_by == ctx.user.id or ctx.is_admin or (s.edit_access == "workspace" and ctx.role != "viewer")


async def _sheet(db: AsyncSession, u: m.User, org: str, sheet_id: str) -> tuple[m.Sheet, WsCtx]:
    s = await db.get(m.Sheet, parse_uuid(sheet_id)) if parse_uuid(sheet_id) else None
    if not s:
        fail(404, "not_found", "Sheet not found")
    ctx = await ws_ctx(db, u, org, str(s.workspace_id))  # 404s unless the person can open the workspace
    if s.org_id != ctx.org.id:
        fail(404, "not_found", "Sheet not found")
    return s, ctx


async def _editable(db: AsyncSession, u: m.User, org: str, sheet_id: str) -> tuple[m.Sheet, WsCtx]:
    s, ctx = await _sheet(db, u, org, sheet_id)
    if not can_edit(s, ctx):
        fail(403, "forbidden", "Only the sheet's creator or an admin can change it (they can let everyone edit)")
    return s, ctx


async def _tab(db: AsyncSession, s: m.Sheet, tab_id: str) -> m.SheetTab:
    tab = await db.get(m.SheetTab, parse_uuid(tab_id)) if parse_uuid(tab_id) else None
    if not tab or tab.sheet_id != s.id:
        fail(404, "not_found", "Tab not found")
    return tab


def _touch(s: m.Sheet, u: m.User) -> None:
    s.updated_at, s.updated_by = now(), u.id


def _spec(value: object, columns: list[dict]) -> dict:
    """{type, x, y: [keys], groupBy?, agg} with keys that exist on the tab."""
    if not isinstance(value, dict):
        fail(422, "invalid", "A chart needs a type, an X column, and at least one Y column")
    keys = {c["key"] for c in columns}
    kind = value.get("type") if value.get("type") in CHART_TYPES else "line"
    x = value.get("x") if value.get("x") in keys else None
    ys = [k for k in (value.get("y") or []) if k in keys][:8] if isinstance(value.get("y"), list) else []
    agg = value.get("agg") if value.get("agg") in AGGS else "none"
    if not x or (not ys and agg != "count"):
        fail(422, "invalid", "Choose an X column and at least one Y column")
    group = value.get("groupBy") if value.get("groupBy") in keys else None
    return {"type": kind, "x": x, "y": ys, "agg": agg, **({"groupBy": group} if group else {})}


# ---------------------------------------------------------------- rows & search


async def _insert_rows(db: AsyncSession, tab_id: uuid.UUID, rows: list[list], start: float = 1) -> None:
    if rows:
        await db.execute(insert(m.SheetRow), [{"tab_id": tab_id, "pos": start + i, "cells": r} for i, r in enumerate(rows)])


async def _count(db: AsyncSession, tab: m.SheetTab) -> None:
    tab.row_count = await db.scalar(select(func.count()).select_from(m.SheetRow).where(m.SheetRow.tab_id == tab.id)) or 0


async def refresh_search(db: AsyncSession, sheet_id: uuid.UUID) -> None:
    """Tab and column names plus distinct cell text (computed in Postgres, nothing shipped here)."""
    s = await db.get(m.Sheet, sheet_id)
    if not s:
        return
    tabs = (await db.execute(select(m.SheetTab).where(m.SheetTab.sheet_id == sheet_id))).scalars().all()
    names = [x for t in tabs for x in (t.name, *(c["name"] for c in t.columns))]
    cells = await db.scalar(
        text(
            "SELECT left(string_agg(DISTINCT x #>> '{}', E'\\n'), 500000) FROM sheet_rows r JOIN sheet_tabs t ON t.id = r.tab_id"
            " CROSS JOIN LATERAL jsonb_array_elements(r.cells) x WHERE t.sheet_id = :sid AND jsonb_typeof(x) = 'string'"
        ),
        {"sid": sheet_id},
    )
    s.search_text = ("\n".join(names) + "\n" + (cells or ""))[:500_000]


_refreshing: set[uuid.UUID] = set()
_tasks: set[asyncio.Task] = set()


async def _refresh_later(sheet_id: uuid.UUID) -> None:
    if sheet_id in _refreshing:  # one pending refresh covers every edit until it runs
        return
    _refreshing.add(sheet_id)
    try:
        await asyncio.sleep(SEARCH_DELAY)
        async with sessionmaker()() as db:
            await refresh_search(db, sheet_id)
            await db.commit()
    except Exception:  # noqa: BLE001 - search text catches up on the next edit
        log.warning("sheet search refresh failed", exc_info=True)
    finally:
        _refreshing.discard(sheet_id)


async def _search_after_edit(db: AsyncSession, s: m.Sheet) -> None:
    """Small sheets: now. Big ones: a few seconds after the edits stop, off the request."""
    total = await db.scalar(select(func.coalesce(func.sum(m.SheetTab.row_count), 0)).where(m.SheetTab.sheet_id == s.id))
    if (total or 0) <= SEARCH_INLINE_ROWS:
        await db.flush()
        await refresh_search(db, s.id)
        return

    async def kick() -> None:
        t = asyncio.create_task(_refresh_later(s.id))
        _tasks.add(t)
        t.add_done_callback(_tasks.discard)

    db.info.setdefault("after_commit", []).append(kick)


async def _column_values(db: AsyncSession, tab: m.SheetTab, key: str) -> list[tuple[int, object]]:
    idx = int(key[1:])
    return [(rid, v) for rid, v in (await db.execute(select(m.SheetRow.id, m.SheetRow.cells[idx]).where(m.SheetRow.tab_id == tab.id).order_by(m.SheetRow.pos))).all()]


async def _retype(db: AsyncSession, tab: m.SheetTab, key: str, kind: str, values: list[tuple[int, object]]) -> None:
    """Rewrite a column's cells as `kind` (only rows whose value changes)."""
    idx = int(key[1:])
    changed = {}
    for rid, v in values:
        _, new = coerce(v, kind)
        if new != v:
            changed[rid] = new
    if changed:
        for r in (await db.execute(select(m.SheetRow).where(m.SheetRow.id.in_(list(changed))))).scalars():
            cells = list(r.cells) + [None] * max(0, idx + 1 - len(r.cells))
            cells[idx] = changed[r.id]
            r.cells = cells
    tab.columns = [{**c, "type": kind} if c["key"] == key else c for c in tab.columns]


async def _auto_types(db: AsyncSession, tab: m.SheetTab, keys: set[str]) -> None:
    """Columns that follow what's typed into them take the type their values now fit."""
    for c in [c for c in tab.columns if c["key"] in keys and c.get("auto")]:
        values = await _column_values(db, tab, c["key"])
        kind = infer_type([as_text(v) for _, v in values])
        if kind != c["type"]:
            await _retype(db, tab, c["key"], kind, values)


# ---------------------------------------------------------------- sheets


@router.get("/orgs/{org}/workspaces/{ws}/sheets")
async def list_sheets(org: str, ws: str, q: str = "", u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    """Sheets in the workspace; `q` matches names, column names, and cell text."""
    ctx = await ws_ctx(db, u, org, ws)
    query = select(m.Sheet).where(m.Sheet.workspace_id == ctx.ws.id)
    if q.strip():
        like = f"%{q.strip()}%"
        query = query.where(or_(m.Sheet.name.ilike(like), m.Sheet.search_text.ilike(like)))
    sheets = (await db.execute(query.order_by(m.Sheet.updated_at.desc()).limit(200))).scalars().all()
    tabs: dict = {}
    if sheets:
        for t in (await db.execute(select(m.SheetTab.sheet_id, m.SheetTab.row_count).where(m.SheetTab.sheet_id.in_([s.id for s in sheets])))).all():
            tabs.setdefault(t[0], []).append(t[1])
    return [{**sheet_summary(s, []), "tabs": len(tabs.get(s.id, [])), "rows": sum(tabs.get(s.id, []))} for s in sheets]


async def _add_tabs(db: AsyncSession, s: m.Sheet, tabs: list[Tab], first: int = 0) -> None:
    for i, tab in enumerate(tabs):
        t = m.SheetTab(id=uuid7(), sheet_id=s.id, position=first + i, name=tab.name[:300], columns=tab.columns, next_col=len(tab.columns), row_count=len(tab.rows), truncated=tab.truncated)
        db.add(t)
        await db.flush()
        await _insert_rows(db, t.id, tab.rows)


async def _parse(request: Request, filename: str) -> tuple[bytes, str, list[Tab]]:
    data = await read_limited(request, MAX_BYTES, "Spreadsheets must be under 25 MB")
    fname = re.sub(r"[\\/\x00-\x1f]", "_", filename).strip()[:255] or "sheet.csv"
    try:
        tabs = await asyncio.to_thread(parse_sheet, data, fname)
    except SheetError as e:
        fail(422, "unreadable", str(e))
    return data, fname, tabs


@router.post("/orgs/{org}/workspaces/{ws}/sheets", status_code=201)
async def import_sheet(org: str, ws: str, request: Request, filename: str, name: str = "", u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    """The file is the request body (.xlsx or .csv, up to 25 MB)."""
    ctx = await ws_ctx(db, u, org, ws, "member")
    data, fname, tabs = await _parse(request, filename)
    sha = hashlib.sha256(data).hexdigest()
    await storage.put_key(db, _key(ctx.org.id, sha), request.headers.get("content-type") or "application/octet-stream", data)
    t = now()
    s = m.Sheet(
        id=uuid7(), org_id=ctx.org.id, workspace_id=ctx.ws.id, name=(clean.text(name, "name", 300) or re.sub(r"\.(xlsx|csv|tsv|txt)$", "", fname, flags=re.I))[:300],
        filename=fname, sha256=sha, bytes=len(data), created_by=u.id, created_at=t, updated_at=t,
    )
    db.add(s)
    await db.flush()
    await _add_tabs(db, s, tabs)
    await _search_after_edit(db, s)
    return await get_sheet(org, str(s.id), u, db)


@router.post("/orgs/{org}/workspaces/{ws}/sheets/blank", status_code=201)
async def new_sheet(org: str, ws: str, body: dict = Body(default={}), u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    """A sheet made in the app: one tab, a few columns that take the type of what's typed in."""
    ctx = await ws_ctx(db, u, org, ws, "member")
    t = now()
    s = m.Sheet(id=uuid7(), org_id=ctx.org.id, workspace_id=ctx.ws.id, name=clean.text(body.get("name"), "name", 300, required=True, label="Name") or "", filename="", sha256="", bytes=0, created_by=u.id, created_at=t, updated_at=t)
    db.add(s)
    await db.flush()
    cols = [{"key": f"c{i}", "name": f"Column {i + 1}", "type": "text", "auto": True} for i in range(BLANK_COLUMNS)]
    await _add_tabs(db, s, [Tab(name="Sheet 1", columns=cols, rows=[[None] * BLANK_COLUMNS for _ in range(BLANK_ROWS)])])
    return await get_sheet(org, str(s.id), u, db)


@router.get("/orgs/{org}/sheets/{sheet_id}")
async def get_sheet(org: str, sheet_id: str, u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    s, ctx = await _sheet(db, u, org, sheet_id)
    tabs = (await db.execute(select(m.SheetTab).where(m.SheetTab.sheet_id == s.id).order_by(m.SheetTab.position))).scalars().all()
    charts = (await db.execute(select(m.SheetChart).where(m.SheetChart.sheet_id == s.id).order_by(m.SheetChart.created_at))).scalars().all()
    return {
        **sheet_summary(s, list(tabs)),
        "canDelete": s.created_by == u.id or ctx.is_admin,
        "canEdit": can_edit(s, ctx),
        "editAccess": s.edit_access,
        "hasOriginal": bool(s.sha256),
        **({"updatedBy": str(s.updated_by)} if s.updated_by else {}),
        "tabList": [tab_view(t) for t in tabs],
        "charts": [chart_view(c) for c in charts],
    }


@router.patch("/orgs/{org}/sheets/{sheet_id}")
async def patch_sheet(org: str, sheet_id: str, body: dict = Body(...), u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    """Rename (editors), or let everyone edit (`editAccess`: owner | workspace; creator or admin)."""
    s, ctx = await _editable(db, u, org, sheet_id)
    if "name" in body:
        s.name = clean.text(body.get("name"), "name", 300, required=True, label="Name") or s.name
    if "editAccess" in body:
        if s.created_by != u.id and not ctx.is_admin:
            fail(403, "forbidden", "Only the sheet's creator or an admin can change who edits it")
        if body["editAccess"] not in ("owner", "workspace"):
            fail(422, "invalid", "editAccess is owner or workspace")
        s.edit_access = body["editAccess"]
    _touch(s, u)
    await db.flush()
    return await get_sheet(org, sheet_id, u, db)


@router.get("/orgs/{org}/sheets/{sheet_id}/tabs/{tab_id}/rows")
async def tab_rows(org: str, sheet_id: str, tab_id: str, u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    """All of a tab's rows in order; `ids` names each row for edits."""
    s, _ = await _sheet(db, u, org, sheet_id)
    tab = await _tab(db, s, tab_id)
    res = (await db.execute(select(m.SheetRow.id, m.SheetRow.cells).where(m.SheetRow.tab_id == tab.id).order_by(m.SheetRow.pos))).all()
    width = tab.next_col
    return {"columns": tab.columns, "ids": [r[0] for r in res], "rows": [(r[1] + [None] * (width - len(r[1])))[:width] for r in res]}


# ---------------------------------------------------------------- edits


def _cell(col: dict, value: object) -> object:
    if col.get("auto"):
        return as_text(value)  # stored as typed; _auto_types settles the column's type after
    ok, v = coerce(value, col["type"])
    if not ok:
        fail(422, "invalid", f"“{as_text(value)}” isn't {TYPE_WORD[col['type']]}: {col['name']} holds {col['type']}s. Change the column's type to put text in it.")
    return v


@router.patch("/orgs/{org}/sheets/{sheet_id}/tabs/{tab_id}/rows")
async def edit_rows(org: str, sheet_id: str, tab_id: str, body: dict = Body(...), u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    """A batch of row edits, applied in order, all or nothing:
      {op: "set", id, col, value}               change one cell
      {op: "insert", after?: id, first?: true, cells?: {col: value}}   a row: at the end, after a
                                                 row, or first (several after one row: send them last-first)
      {op: "delete", ids: [...]}
    Returns only what changed: {rows: [{id, cells}], inserted: [{id, cells, after}], deleted, columns}."""
    s, _ = await _editable(db, u, org, sheet_id)
    tab = await _tab(db, s, tab_id)
    ops = body.get("ops")
    if not isinstance(ops, list) or not ops or len(ops) > MAX_OPS:
        fail(422, "invalid", f"Send 1 to {MAX_OPS} edits")
    cols = {c["key"]: c for c in tab.columns}
    width = tab.next_col
    wanted: set[int] = set()
    for op in ops:
        if not isinstance(op, dict):
            fail(422, "invalid", "Each edit is an object")
        for k in ("id", "after"):
            if isinstance(op.get(k), int):
                wanted.add(op[k])
        wanted.update(i for i in op.get("ids") or [] if isinstance(i, int))
    rows = {r.id: r for r in (await db.execute(select(m.SheetRow).where(m.SheetRow.tab_id == tab.id, m.SheetRow.id.in_(wanted)))).scalars()} if wanted else {}
    touched_cols: set[str] = set()
    changed: dict[int, m.SheetRow] = {}
    inserted: list[tuple[m.SheetRow, int | None]] = []
    deleted: list[int] = []
    for op in ops:
        kind = op.get("op")
        if kind == "set":
            r = rows.get(op.get("id")) or fail(409, "gone", "That row was deleted (maybe by someone else). Reload to see the latest.")
            col = cols.get(op.get("col")) or fail(422, "invalid", "No such column")
            idx = int(col["key"][1:])
            cells = (list(r.cells) + [None] * width)[: max(width, len(r.cells))]
            cells[idx] = _cell(col, op.get("value"))
            r.cells = cells
            changed[r.id] = r
            touched_cols.add(col["key"])
        elif kind == "insert":
            if tab.row_count + len(inserted) >= MAX_ROWS:
                fail(422, "too_many", f"A tab holds up to {MAX_ROWS:,} rows")
            after = op.get("after")
            if op.get("first"):
                pos = (await db.scalar(select(func.min(m.SheetRow.pos)).where(m.SheetRow.tab_id == tab.id)) or 1) - 1
            elif after is not None:
                a = rows.get(after) or fail(409, "gone", "That row was deleted (maybe by someone else). Reload to see the latest.")
                nxt = await db.scalar(select(func.min(m.SheetRow.pos)).where(m.SheetRow.tab_id == tab.id, m.SheetRow.pos > a.pos))
                pos = (a.pos + nxt) / 2 if nxt is not None else a.pos + 1
            else:
                pos = (await db.scalar(select(func.max(m.SheetRow.pos)).where(m.SheetRow.tab_id == tab.id)) or 0) + 1
            cells: list = [None] * width
            for key, value in (op.get("cells") or {}).items() if isinstance(op.get("cells"), dict) else []:
                if key in cols:
                    cells[int(key[1:])] = _cell(cols[key], value)
                    touched_cols.add(key)
            r = m.SheetRow(tab_id=tab.id, pos=pos, cells=cells)
            db.add(r)
            await db.flush()
            rows[r.id] = r
            inserted.append((r, after if isinstance(after, int) else None))
        elif kind == "delete":
            for rid in op.get("ids") or []:
                r = rows.pop(rid, None)
                if r is not None:
                    await db.delete(r)
                    changed.pop(rid, None)
                    deleted.append(rid)
        else:
            fail(422, "invalid", "Edits are set, insert, or delete")
    await db.flush()
    before = {c["key"]: c["type"] for c in tab.columns}
    await _auto_types(db, tab, touched_cols)
    retyped = any(before.get(c["key"]) != c["type"] for c in tab.columns)
    await _count(db, tab)
    _touch(s, u)
    await _search_after_edit(db, s)
    pad = lambda c: (list(c) + [None] * width)[:width]  # noqa: E731
    # Where each new row ended up: the row before it in the final order (None: it's first).
    prev: dict[int, int | None] = {}
    for r, _ in inserted:
        if r.id in rows:
            prev[r.id] = await db.scalar(select(m.SheetRow.id).where(m.SheetRow.tab_id == tab.id, m.SheetRow.pos < r.pos).order_by(m.SheetRow.pos.desc()).limit(1))
    return {
        "rows": [{"id": r.id, "cells": pad(r.cells)} for r in changed.values()],
        "inserted": [{"id": r.id, "cells": pad(r.cells), "after": prev[r.id]} for r, _ in inserted if r.id in prev],
        "deleted": deleted,
        "columns": tab.columns,
        "rowCount": tab.row_count,
        "retyped": retyped,  # a column changed type: reload the rows to see every value as it is now
    }


@router.patch("/orgs/{org}/sheets/{sheet_id}/tabs/{tab_id}/columns")
async def edit_columns(org: str, sheet_id: str, tab_id: str, body: dict = Body(...), u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    """{ops: [{op: "add", name?, after?: key}, {op: "rename", key, name}, {op: "delete", key},
    {op: "type", key, type}]} → the tab. Changing a column to numbers or dates needs every value
    in it to fit (or says which doesn't); a column a chart uses can't be deleted."""
    s, _ = await _editable(db, u, org, sheet_id)
    tab = await _tab(db, s, tab_id)
    cols = [dict(c) for c in tab.columns]
    for op in body.get("ops") or []:
        kind = op.get("op") if isinstance(op, dict) else None
        col = next((c for c in cols if c["key"] == op.get("key")), None) if kind in ("rename", "delete", "type") else None
        if kind in ("rename", "delete", "type") and not col:
            fail(404, "not_found", "No such column")
        if kind in ("add", "rename"):
            name = clean.text(op.get("name"), "name", 200) or ""
            if kind == "add" and not name:
                n = len(cols) + 1
                while any(c["name"].lower() == f"column {n}" for c in cols):
                    n += 1
                name = f"Column {n}"
            if not name:
                fail(422, "invalid", "Name the column")
            if any(c["name"].lower() == name.lower() and c is not col for c in cols):
                fail(422, "invalid", f"There's already a column called “{name}”")
            if kind == "rename":
                col["name"] = name
            else:
                new = {"key": f"c{tab.next_col}", "name": name, "type": "text", "auto": True}
                tab.next_col += 1
                at = next((i + 1 for i, c in enumerate(cols) if c["key"] == op.get("after")), len(cols))
                cols.insert(at, new)
        elif kind == "delete":
            if len(cols) == 1:
                fail(422, "invalid", "A tab needs at least one column")
            used = [c.name for c in (await db.execute(select(m.SheetChart).where(m.SheetChart.tab_id == tab.id))).scalars() if col["key"] in (c.spec.get("x"), c.spec.get("groupBy"), *(c.spec.get("y") or []))]
            if used:
                fail(409, "in_use", f"{col['name']} is used by {', '.join(f'“{n}”' for n in used)}. Change or delete {'that chart' if len(used) == 1 else 'those charts'} first.")
            cols.remove(col)
            # Clear its cells so its text leaves search (the key is never reused).
            await db.execute(text("UPDATE sheet_rows SET cells = jsonb_set(cells, ARRAY[:i]::text[], 'null') WHERE tab_id = :t AND jsonb_array_length(cells) > :n"), {"i": col["key"][1:], "t": tab.id, "n": int(col["key"][1:])})
        elif kind == "type":
            new_type = op.get("type")
            if new_type not in TYPES:
                fail(422, "invalid", "A column holds numbers, dates, categories, or text")
            tab.columns = cols
            values = await _column_values(db, tab, col["key"])
            for n, (_, v) in enumerate(values, start=1):
                if not coerce(v, new_type)[0]:
                    fail(422, "invalid", f"Row {n} has “{as_text(v)}”, which isn't {TYPE_WORD[new_type]}. Fix it first, or keep {col['name']} as text.")
            await _retype(db, tab, col["key"], new_type, values)
            cols = [dict(c) for c in tab.columns]
            next(c for c in cols if c["key"] == col["key"]).pop("auto", None)  # chosen now, not inferred
        else:
            fail(422, "invalid", "Column edits are add, rename, delete, or type")
    tab.columns = cols
    _touch(s, u)
    await _search_after_edit(db, s)
    return tab_view(tab)


@router.post("/orgs/{org}/sheets/{sheet_id}/replace")
async def replace_data(org: str, sheet_id: str, request: Request, filename: str, tab: str | None = None, u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    """A new version of the file replaces the data. Tabs match by name (else they're added or
    removed); columns match by name, keeping their keys, so charts and posts that embed them keep
    working. A CSV has no tab names: it's a new version of the open tab (`tab`, else the first),
    and the other tabs stay. Returns the sheet plus what couldn't be kept."""
    s, ctx = await _editable(db, u, org, sheet_id)
    data, fname, new_tabs = await _parse(request, filename)
    tabs = (await db.execute(select(m.SheetTab).where(m.SheetTab.sheet_id == s.id).order_by(m.SheetTab.position))).scalars().all()
    old = {t.name.lower(): t for t in tabs}
    one_tab = fname.rsplit(".", 1)[-1].lower() in ("csv", "tsv", "txt")
    if one_tab and tabs:
        new_tabs[0].name = (old.get((tab or "").lower()) or tabs[0]).name
    keep: set[uuid.UUID] = {t.id for t in tabs} if one_tab else set()
    for i, nt in enumerate(new_tabs):
        t = old.get(nt.name.lower())
        if not t:
            await _add_tabs(db, s, [nt], first=i)
            continue
        keep.add(t.id)
        by_name = {c["name"].lower(): c["key"] for c in t.columns}
        mapping: list[str] = []
        for c in nt.columns:
            key = by_name.pop(c["name"].lower(), None)
            if key is None:
                key = f"c{t.next_col}"
                t.next_col += 1
            mapping.append(key)
        t.columns = [{**c, "key": key} for c, key in zip(nt.columns, mapping, strict=True)]
        rows = []
        for r in nt.rows:
            cells: list = [None] * t.next_col
            for v, key in zip(r, mapping, strict=False):  # short rows: the rest stay empty
                cells[int(key[1:])] = v
            rows.append(cells)
        await db.execute(delete(m.SheetRow).where(m.SheetRow.tab_id == t.id))
        await _insert_rows(db, t.id, rows)
        t.name, t.row_count, t.truncated = nt.name[:300], len(rows), nt.truncated
        if not one_tab:
            t.position = i
    gone = [t for t in old.values() if t.id not in keep]
    lost = await db.scalar(select(func.count()).select_from(m.SheetChart).where(m.SheetChart.tab_id.in_([t.id for t in gone]))) if gone else 0
    for t in gone:
        await db.delete(t)  # its rows and charts cascade
    await db.flush()
    charts = (await db.execute(select(m.SheetChart, m.SheetTab.columns).join(m.SheetTab, m.SheetTab.id == m.SheetChart.tab_id).where(m.SheetChart.sheet_id == s.id))).all()
    broken = [c.name for c, cols in charts if not {c.spec.get("x"), *(c.spec.get("y") or []), *([c.spec["groupBy"]] if c.spec.get("groupBy") else [])} <= {x["key"] for x in cols}]
    old_sha = s.sha256
    sha = hashlib.sha256(data).hexdigest()
    await storage.put_key(db, _key(ctx.org.id, sha), request.headers.get("content-type") or "application/octet-stream", data)
    s.filename, s.sha256, s.bytes = fname, sha, len(data)
    if old_sha and old_sha != sha and not await db.scalar(select(func.count()).select_from(m.Sheet).where(m.Sheet.org_id == s.org_id, m.Sheet.sha256 == old_sha, m.Sheet.id != s.id)):
        await storage.delete_key(db, _key(s.org_id, old_sha))
    _touch(s, u)
    await _search_after_edit(db, s)
    return {**(await get_sheet(org, sheet_id, u, db)), "removedCharts": lost or 0, "brokenCharts": broken}


# ---------------------------------------------------------------- charts


@router.post("/orgs/{org}/sheets/{sheet_id}/charts", status_code=201)
async def create_chart(org: str, sheet_id: str, body: dict = Body(...), u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    s, ctx = await _sheet(db, u, org, sheet_id)
    if ctx.role == "viewer":
        fail(403, "forbidden", "Viewers can't save charts")
    tab = await db.get(m.SheetTab, parse_uuid(body.get("tabId"))) if parse_uuid(body.get("tabId")) else None
    if not tab or tab.sheet_id != s.id:
        fail(422, "invalid", "Choose a tab")
    c = m.SheetChart(id=uuid7(), sheet_id=s.id, tab_id=tab.id, name=clean.text(body.get("name"), "name", 300, required=True, label="Chart name") or "", spec=_spec(body.get("spec"), tab.columns), created_by=u.id)
    db.add(c)
    s.updated_at = now()
    return chart_view(c)


@router.patch("/orgs/{org}/sheets/{sheet_id}/charts/{chart_id}")
async def update_chart(org: str, sheet_id: str, chart_id: str, body: dict = Body(...), u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    s, ctx = await _sheet(db, u, org, sheet_id)
    c = await db.get(m.SheetChart, parse_uuid(chart_id)) if parse_uuid(chart_id) else None
    if not c or c.sheet_id != s.id:
        fail(404, "not_found", "Chart not found")
    if c.created_by != u.id and not ctx.is_admin:
        fail(403, "forbidden", "Only the chart's author or an admin can change it")
    if "name" in body:
        c.name = clean.text(body.get("name"), "name", 300, required=True, label="Chart name") or c.name
    if "spec" in body:
        tab = await db.get(m.SheetTab, c.tab_id)
        c.spec = _spec(body["spec"], tab.columns if tab else [])
    return chart_view(c)


@router.delete("/orgs/{org}/sheets/{sheet_id}/charts/{chart_id}", status_code=204)
async def delete_chart(org: str, sheet_id: str, chart_id: str, u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    s, ctx = await _sheet(db, u, org, sheet_id)
    c = await db.get(m.SheetChart, parse_uuid(chart_id)) if parse_uuid(chart_id) else None
    if not c or c.sheet_id != s.id:
        fail(404, "not_found", "Chart not found")
    if c.created_by != u.id and not ctx.is_admin:
        fail(403, "forbidden", "Only the chart's author or an admin can delete it")
    await db.delete(c)
    return Response(status_code=204)


@router.delete("/orgs/{org}/sheets/{sheet_id}", status_code=204)
async def delete_sheet(org: str, sheet_id: str, u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    s, ctx = await _sheet(db, u, org, sheet_id)
    if s.created_by != u.id and not ctx.is_admin:
        fail(403, "forbidden", "Only the sheet's creator or an admin can delete it")
    if s.sha256:
        others = await db.scalar(select(func.count()).select_from(m.Sheet).where(m.Sheet.org_id == s.org_id, m.Sheet.sha256 == s.sha256, m.Sheet.id != s.id))
        if not others:
            await storage.delete_key(db, _key(s.org_id, s.sha256))
    await db.delete(s)  # tabs, rows, and charts cascade; embedded charts show "no longer available"
    return Response(status_code=204)


@router.get("/orgs/{org}/sheets/{sheet_id}/original")
async def original(org: str, sheet_id: str, u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    s, _ = await _sheet(db, u, org, sheet_id)
    got = await storage.get_key(db, _key(s.org_id, s.sha256)) if s.sha256 else None
    if not got:
        fail(404, "not_found", "There's no original file: this sheet was made in the app. Download it as CSV instead.")
    safe = re.sub(r'[^\w .()-]', "_", s.filename)[:200]
    return Response(content=got[1], media_type=got[0], headers={"Content-Disposition": f'attachment; filename="{safe}"', "Cache-Control": "private, no-store"})
