"""Attach a file to a post, and download it (tal.attachments)."""

from __future__ import annotations

import re

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import attachments, storage
from .. import models as m
from ..context import accessible_workspaces, org_ctx, require_user
from ..db import get_db
from ..errors import fail
from ..httputil import read_limited
from ..ids import parse_uuid

router = APIRouter()


@router.post("/orgs/{org}/attachments", status_code=201)
async def upload(org: str, request: Request, filename: str, u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    """The file is the request body; `filename` names it. Same file again → the same attachment."""
    ctx = await org_ctx(db, u, org, "member")
    name = re.sub(r"[\\/\x00-\x1f]", "_", filename).strip()[:255] or "file"
    if attachments.ext_of(name) in attachments.BLOCKED:
        fail(415, "unsupported_type", "Programs and scripts can't be attached")
    limit = attachments.limit_for(name)
    data = await read_limited(request, limit, f"Files like this must be under {limit // attachments.MB} MB")
    if not data:
        fail(422, "invalid", "The file is empty")
    a = await attachments.create(db, ctx.org.id, data, name, request.headers.get("content-type") or "application/octet-stream", u.id)
    return attachments.view(a)


@router.get("/orgs/{org}/attachments/{attachment_id}")
async def download(org: str, attachment_id: str, u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    """Anyone who can see a post that holds it (or who uploaded it) can download it."""
    ctx = await org_ctx(db, u, org)
    a = await db.get(m.Attachment, parse_uuid(attachment_id)) if parse_uuid(attachment_id) else None
    if not a or a.org_id != ctx.org.id:
        fail(404, "not_found", "File not found")
    if a.created_by != u.id:
        ws_ids = [w.id for w in await accessible_workspaces(ctx, True)]
        posts = (await db.execute(select(m.Post).where(m.Post.org_id == ctx.org.id, m.Post.workspace_id.in_(ws_ids), m.Post.deleted_at.is_(None), m.Post.blocks.contains([{"type": "file", "attachmentId": str(a.id)}])))).scalars().all()
        if not any(p.status == "published" or p.author_id == u.id for p in posts):
            fail(404, "not_found", "File not found")
    got = await storage.get_key(db, attachments.key(a.org_id, a.sha256))
    if not got:
        fail(404, "not_found", "File not found")
    safe = re.sub(r'[^\w .()-]', "_", a.filename)[:200]
    return Response(content=got[1], media_type=a.mime, headers={"Content-Disposition": f'attachment; filename="{safe}"', "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})
