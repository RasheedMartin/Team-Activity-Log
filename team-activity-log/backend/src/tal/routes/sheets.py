"""Sheets (tal.sheets): import a spreadsheet, browse its tabs, save charts that posts can embed.

Everyone in the workspace can view a sheet and make charts; its creator (or an admin) can delete it.
The original file is kept (download), stored once per org by content.
"""

from __future__ import annotations

import asyncio
import hashlib
import re
import uuid

from fastapi import APIRouter, Body, Depends, Request, Response
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models as m
from .. import sanitize as clean
from .. import storage
from ..context import WsCtx, require_user, ws_ctx
from ..db import get_db
from ..errors import fail
from ..httputil import read_limited
from ..ids import parse_uuid, uuid7
from ..sheets import SheetError, parse_sheet, search_text
from ..timeutil import iso, now

router = APIRouter()
MAX_BYTES = 25 * 1024 * 1024
CHART_TYPES = {"line", "column", "bar", "area", "scatter", "pie"}
AGGS = {"sum", "avg", "count", "min", "max", "none"}


def _key(org_id: uuid.UUID, sha: str) -> str:
    return storage.user_key("sheets", str(org_id), sha)


def sheet_summary(s: m.Sheet, tabs: list[m.SheetTab]) -> dict:
    return {"id": str(s.id), "workspaceId": str(s.workspace_id), "name": s.name, "filename": s.filename, "bytes": s.bytes, "createdBy": str(s.created_by) if s.created_by else None, "updatedAt": iso(s.updated_at), "tabs": len(tabs), "rows": sum(t.row_count for t in tabs)}


def chart_view(c: m.SheetChart) -> dict:
    return {"id": str(c.id), "sheetId": str(c.sheet_id), "tabId": str(c.tab_id), "name": c.name, "spec": c.spec}


async def _sheet(db: AsyncSession, u: m.User, org: str, sheet_id: str) -> tuple[m.Sheet, WsCtx]:
    s = await db.get(m.Sheet, parse_uuid(sheet_id)) if parse_uuid(sheet_id) else None
    if not s:
        fail(404, "not_found", "Sheet not found")
    ctx = await ws_ctx(db, u, org, str(s.workspace_id))  # 404s unless the person can open the workspace
    if s.org_id != ctx.org.id:
        fail(404, "not_found", "Sheet not found")
    return s, ctx


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


@router.post("/orgs/{org}/workspaces/{ws}/sheets", status_code=201)
async def import_sheet(org: str, ws: str, request: Request, filename: str, name: str = "", u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    """The file is the request body (.xlsx or .csv, up to 25 MB)."""
    ctx = await ws_ctx(db, u, org, ws, "member")
    data = await read_limited(request, MAX_BYTES, "Spreadsheets must be under 25 MB")
    fname = re.sub(r"[\\/\x00-\x1f]", "_", filename).strip()[:255] or "sheet.csv"
    try:
        tabs = await asyncio.to_thread(parse_sheet, data, fname)
    except SheetError as e:
        fail(422, "unreadable", str(e))
    sha = hashlib.sha256(data).hexdigest()
    await storage.put_key(db, _key(ctx.org.id, sha), request.headers.get("content-type") or "application/octet-stream", data)
    t = now()
    s = m.Sheet(
        id=uuid7(), org_id=ctx.org.id, workspace_id=ctx.ws.id, name=(clean.text(name, "name", 300) or re.sub(r"\.(xlsx|csv|tsv|txt)$", "", fname, flags=re.I))[:300],
        filename=fname, sha256=sha, bytes=len(data), search_text=search_text(tabs), created_by=u.id, created_at=t, updated_at=t,
    )
    db.add(s)
    await db.flush()
    for i, tab in enumerate(tabs):
        db.add(m.SheetTab(id=uuid7(), sheet_id=s.id, position=i, name=tab.name[:300], columns=tab.columns, rows=tab.rows, row_count=len(tab.rows), truncated=tab.truncated))
    await db.flush()
    return await get_sheet(org, str(s.id), u, db)


@router.get("/orgs/{org}/sheets/{sheet_id}")
async def get_sheet(org: str, sheet_id: str, u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    s, ctx = await _sheet(db, u, org, sheet_id)
    tabs = (await db.execute(select(m.SheetTab).where(m.SheetTab.sheet_id == s.id).order_by(m.SheetTab.position))).scalars().all()
    charts = (await db.execute(select(m.SheetChart).where(m.SheetChart.sheet_id == s.id).order_by(m.SheetChart.created_at))).scalars().all()
    return {
        **sheet_summary(s, list(tabs)),
        "canDelete": s.created_by == u.id or ctx.is_admin,
        "tabList": [{"id": str(t.id), "name": t.name, "columns": t.columns, "rowCount": t.row_count, "truncated": t.truncated} for t in tabs],
        "charts": [chart_view(c) for c in charts],
    }


@router.get("/orgs/{org}/sheets/{sheet_id}/tabs/{tab_id}/rows")
async def tab_rows(org: str, sheet_id: str, tab_id: str, u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    s, _ = await _sheet(db, u, org, sheet_id)
    tab = await db.get(m.SheetTab, parse_uuid(tab_id)) if parse_uuid(tab_id) else None
    if not tab or tab.sheet_id != s.id:
        fail(404, "not_found", "Tab not found")
    return {"columns": tab.columns, "rows": tab.rows}


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
    others = await db.scalar(select(func.count()).select_from(m.Sheet).where(m.Sheet.org_id == s.org_id, m.Sheet.sha256 == s.sha256, m.Sheet.id != s.id))
    if not others:
        await storage.delete_key(db, _key(s.org_id, s.sha256))
    await db.delete(s)  # tabs and charts cascade; embedded charts show "no longer available"
    return Response(status_code=204)


@router.get("/orgs/{org}/sheets/{sheet_id}/original")
async def original(org: str, sheet_id: str, u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    s, _ = await _sheet(db, u, org, sheet_id)
    got = await storage.get_key(db, _key(s.org_id, s.sha256))
    if not got:
        fail(404, "not_found", "The original file isn't available")
    safe = re.sub(r'[^\w .()-]', "_", s.filename)[:200]
    return Response(content=got[1], media_type=got[0], headers={"Content-Disposition": f'attachment; filename="{safe}"', "Cache-Control": "private, no-store"})
