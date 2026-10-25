"""Roles on a collection or notebook (owner request): everyone in the workspace can view; editors
can write pages, add, reorder, and rename; owners can also share and delete. The creator is an
owner; workspace admins act as owners; workspace viewers never edit."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from . import models as m
from .context import WsCtx
from .errors import fail

ROLES = ("viewer", "editor", "owner")


async def role_in(db: AsyncSession, ctx: WsCtx, c: m.CollectionRow) -> str:
    if ctx.is_admin or c.created_by == ctx.user.id:
        return "owner"
    if ctx.role == "viewer":
        return "viewer"
    row = await db.get(m.CollectionMember, (c.id, ctx.user.id))
    return row.role if row else "viewer"


async def require(db: AsyncSession, ctx: WsCtx, c: m.CollectionRow, at_least: str) -> str:
    role = await role_in(db, ctx, c)
    if ROLES.index(role) < ROLES.index(at_least):
        what = "notebook" if c.kind == "notebook" else "collection"
        fail(403, "forbidden", f"You can view this {what}; ask its owner to make you an editor" if at_least == "editor" else f"Only an owner of this {what} can do that")
    return role


async def members(db: AsyncSession, c: m.CollectionRow) -> list[dict]:
    rows = (await db.execute(select(m.CollectionMember).where(m.CollectionMember.collection_id == c.id))).scalars().all()
    return [{"userId": str(c.created_by), "role": "owner"}] + [{"userId": str(r.user_id), "role": r.role} for r in rows if r.user_id != c.created_by]
