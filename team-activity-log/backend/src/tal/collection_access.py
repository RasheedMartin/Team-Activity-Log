"""Roles on a collection or notebook (owner request): everyone in the workspace can view; editors
can write pages, add, reorder, and rename; owners can also share and delete. The creator is an
owner. Visibility (owner request): "workspace" means everyone in it views by default; "people"
means only those it's shared with can see it at all ("none" for everyone else). Admins get no
special access; workspace viewers never edit."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from . import models as m
from .context import WsCtx
from .errors import fail

ROLES = ("none", "viewer", "editor", "owner")


async def role_in(db: AsyncSession, ctx: WsCtx, c: m.CollectionRow) -> str:
    if c.created_by == ctx.user.id:
        return "owner"
    row = await db.get(m.CollectionMember, (c.id, ctx.user.id))
    granted = row.role if row else ("viewer" if c.visibility == "workspace" else "none")
    return "viewer" if ctx.role == "viewer" and granted != "none" else granted


async def require(db: AsyncSession, ctx: WsCtx, c: m.CollectionRow, at_least: str) -> str:
    role = await role_in(db, ctx, c)
    if ROLES.index(role) < ROLES.index(at_least):
        what = "notebook" if c.kind == "notebook" else "collection"
        fail(403, "forbidden", f"You can view this {what}; ask its owner to make you an editor" if at_least == "editor" else f"Only an owner of this {what} can do that")
    return role


async def members(db: AsyncSession, c: m.CollectionRow) -> list[dict]:
    rows = (await db.execute(select(m.CollectionMember).where(m.CollectionMember.collection_id == c.id))).scalars().all()
    return [{"userId": str(c.created_by), "role": "owner"}] + [{"userId": str(r.user_id), "role": r.role} for r in rows if r.user_id != c.created_by]


async def grants_for(db: AsyncSession, user_id) -> dict:
    """{collection_id: role} the person was given (for listing what's shared with them)."""
    rows = await db.execute(select(m.CollectionMember.collection_id, m.CollectionMember.role).where(m.CollectionMember.user_id == user_id))
    return dict(rows.all())
