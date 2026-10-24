"""Who is calling and what they may touch: sessions, tenancy, roles, post visibility.

Same rules as the mock server (frontend/src/mock/server.ts), which the UI was built against.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import secrets
import uuid
from dataclasses import dataclass

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import Depends, Request, Response
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from . import models as m
from .config import get_settings
from .db import get_db
from .errors import fail
from .ids import parse_uuid, uuid7
from .timeutil import now

RANK = {"viewer": 0, "member": 1, "admin": 2, "owner": 3}
_hasher = PasswordHasher()


def role_at_least(role: str, minimum: str) -> bool:
    return RANK[role] >= RANK[minimum]


# ---------------------------------------------------------------- passwords & tokens


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(hashed: str | None, password: str) -> bool:
    if not hashed:
        return False
    try:
        return _hasher.verify(hashed, password)
    except (VerificationError, InvalidHashError):
        return False


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def new_token() -> str:
    return secrets.token_urlsafe(32)


# ---------------------------------------------------------------- sessions


def _device(request: Request) -> str:
    ua = request.headers.get("user-agent", "")
    browser = "Firefox" if "Firefox" in ua else "Edge" if "Edg/" in ua else "Chrome" if "Chrome" in ua else "Safari" if "Safari" in ua else "Browser"
    os_ = "macOS" if "Mac OS" in ua else "Windows" if "Windows" in ua else "Linux" if "Linux" in ua else "iOS" if "iPhone" in ua else "Android" if "Android" in ua else ""
    return f"{browser} on {os_}" if os_ else browser


async def start_session(db: AsyncSession, request: Request, response: Response, user_id: uuid.UUID) -> None:
    s = get_settings()
    token = new_token()
    db.add(
        m.Session(
            id=uuid7(),
            user_id=user_id,
            token_hash=token_hash(token),
            device=_device(request),
            ip=(request.client.host if request.client else "")[:64],
            expires_at=now() + dt.timedelta(days=s.session_days),
        )
    )
    response.set_cookie(s.session_cookie, token, max_age=s.session_days * 86400, httponly=True, samesite="lax", secure=s.secure_cookies, path="/")


def clear_session_cookie(response: Response) -> None:
    s = get_settings()
    response.delete_cookie(s.session_cookie, path="/", httponly=True, samesite="lax", secure=s.secure_cookies)


async def session_row(db: AsyncSession, request: Request) -> m.Session | None:
    token = request.cookies.get(get_settings().session_cookie)
    if not token:
        return None
    row = (await db.execute(select(m.Session).where(m.Session.token_hash == token_hash(token)))).scalar_one_or_none()
    if not row or row.revoked_at or row.expires_at < now():
        return None
    return row


async def current_user(request: Request, db: AsyncSession = Depends(get_db, scope="function")) -> m.User | None:
    s = await session_row(db, request)
    if not s:
        return None
    user = await db.get(m.User, s.user_id)
    return user if user and not user.deactivated_at else None


async def require_user(user: m.User | None = Depends(current_user)) -> m.User:
    if not user:
        fail(401, "unauthenticated", "Sign in to continue")
    return user


# ---------------------------------------------------------------- tenancy


@dataclass
class OrgCtx:
    db: AsyncSession
    user: m.User
    org: m.Organization
    membership: m.Membership

    @property
    def role(self) -> str:
        return self.membership.role

    @property
    def is_admin(self) -> bool:
        return role_at_least(self.role, "admin")

    def need(self, minimum: str) -> None:
        if not role_at_least(self.role, minimum):
            fail(403, "forbidden", "You don't have permission to do that")


@dataclass
class WsCtx(OrgCtx):
    ws: m.Workspace


async def org_ctx(db: AsyncSession, user: m.User, org_id: str, minimum: str = "viewer") -> OrgCtx:
    oid = parse_uuid(org_id)
    org = await db.get(m.Organization, oid) if oid else None
    if not org:
        fail(404, "not_found", "Organization not found")
    membership = (
        await db.execute(select(m.Membership).where(m.Membership.org_id == org.id, m.Membership.user_id == user.id, m.Membership.status == "active"))
    ).scalar_one_or_none()
    if not membership:
        fail(404, "not_found", "Organization not found")
    ctx = OrgCtx(db, user, org, membership)
    ctx.need(minimum)
    return ctx


async def accessible_workspaces(ctx: OrgCtx, include_archived: bool = False) -> list[m.Workspace]:
    """All-org workspaces plus explicit memberships; admins see every workspace."""
    q = select(m.Workspace).where(m.Workspace.org_id == ctx.org.id).order_by(m.Workspace.created_at, m.Workspace.id)
    if not include_archived:
        q = q.where(m.Workspace.archived.is_(False))
    if not ctx.is_admin:
        member_of = select(m.WorkspaceMember.workspace_id).where(m.WorkspaceMember.user_id == ctx.user.id)
        q = q.where(or_(m.Workspace.all_org_members.is_(True), m.Workspace.id.in_(member_of)))
    return list((await ctx.db.execute(q)).scalars())


async def ws_ctx(db: AsyncSession, user: m.User, org_id: str, ws_id: str, minimum: str = "viewer") -> WsCtx:
    ctx = await org_ctx(db, user, org_id, minimum)
    wid = parse_uuid(ws_id)
    ws = next((w for w in await accessible_workspaces(ctx, True) if w.id == wid), None)
    if not ws:
        fail(404, "not_found", "Workspace not found")
    return WsCtx(ctx.db, ctx.user, ctx.org, ctx.membership, ws)


# ---------------------------------------------------------------- posts


async def co_author_ids(db: AsyncSession, post_id: uuid.UUID) -> list[uuid.UUID]:
    rows = await db.execute(select(m.PostCoAuthor.user_id).where(m.PostCoAuthor.post_id == post_id).order_by(m.PostCoAuthor.position))
    return list(rows.scalars())


async def visible_post(ctx: OrgCtx, post_id: str | uuid.UUID, *, lock: bool = False) -> m.Post:
    """A post the caller may see (drafts: author only; hidden: authors + admins; deleted: admins)."""
    pid = parse_uuid(post_id)
    q = select(m.Post).where(m.Post.id == pid, m.Post.org_id == ctx.org.id) if pid else None
    if q is not None and lock:
        q = q.with_for_update()
    p = (await ctx.db.execute(q)).scalar_one_or_none() if q is not None else None
    if not p:
        fail(404, "not_found", "Post not found")
    if p.workspace_id not in {w.id for w in await accessible_workspaces(ctx, True)}:
        fail(404, "not_found", "Post not found")
    is_author = p.author_id == ctx.user.id or ctx.user.id in await co_author_ids(ctx.db, p.id)
    if p.status == "draft" and p.author_id != ctx.user.id:
        fail(404, "not_found", "Post not found")
    if p.visibility == "hidden" and not is_author and not ctx.is_admin:
        fail(404, "not_found", "Post not found")
    if p.deleted_at and not ctx.is_admin:
        fail(404, "not_found", "Post not found")
    return p


async def can_edit_post(ctx: OrgCtx, p: m.Post) -> bool:
    if not role_at_least(ctx.role, "member"):
        return False
    if p.author_id == ctx.user.id or ctx.user.id in await co_author_ids(ctx.db, p.id):
        return True
    return p.status == "published" and ctx.is_admin
