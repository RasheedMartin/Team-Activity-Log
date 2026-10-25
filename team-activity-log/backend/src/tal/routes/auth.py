"""Sign-in, registration, one-time links, and the user panel (/me). Same contract as the mock."""

from __future__ import annotations

import datetime as dt
import hmac
from typing import Any

from fastapi import APIRouter, Body, Depends, Request, Response
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from .. import avatars, security, storage
from .. import models as m
from .. import sanitize as clean
from ..config import get_settings
from ..context import (
    OrgCtx,
    accessible_workspaces,
    clear_session_cookie,
    current_user,
    hash_password,
    new_token,
    require_user,
    session_row,
    start_session,
    token_hash,
    verify_password,
)
from ..db import get_db
from ..errors import fail
from ..httputil import read_limited
from ..ids import parse_uuid, uuid7
from ..timeutil import iso, now
from ..views import org_view, prefs_view, user_view, workspace_view

router = APIRouter()
DUMMY_HASH = hash_password("not-a-real-password-used-only-for-equal-timing")


async def me_response(db: AsyncSession, u: m.User) -> dict:
    orgs = []
    rows = await db.execute(
        select(m.Membership, m.Organization).join(m.Organization, m.Organization.id == m.Membership.org_id).where(m.Membership.user_id == u.id, m.Membership.status == "active").order_by(m.Membership.created_at)
    )
    for mem, org in rows:
        wss = await accessible_workspaces(OrgCtx(db, u, org, mem), True)
        orgs.append({"org": org_view(org), "role": mem.role, "workspaces": [workspace_view(w) for w in wss]})
    out: dict[str, Any] = {"user": user_view(u), "preferences": prefs_view(u), "orgs": orgs}
    if u.last_workspace_id:
        out["lastWorkspaceId"] = str(u.last_workspace_id)
    return out


async def send_email(db: AsyncSession, to: str, subject: str, body: str, link: str | None = None) -> None:
    db.add(m.Email(id=uuid7(), to=to, subject=subject, body=body, link=link))


async def find_by_email(db: AsyncSession, email: str) -> m.User | None:
    return (await db.execute(select(m.User).where(func.lower(m.User.email) == email.strip().lower()))).scalar_one_or_none()


async def issue_token(db: AsyncSession, kind: str, user_id, hours: int) -> str:
    token = new_token()
    db.add(m.AuthToken(token_hash=token_hash(token), kind=kind, user_id=user_id, expires_at=now() + dt.timedelta(hours=hours)))
    return token


async def use_token(db: AsyncSession, kind: str, token: str, message: str) -> m.User:
    row = await db.get(m.AuthToken, token_hash(token))
    if not row or row.kind != kind or row.expires_at < now():
        fail(404, "invalid_token", message)
    user = await db.get(m.User, row.user_id)
    await db.delete(row)
    if not user:
        fail(404, "invalid_token", message)
    return user


async def signed_in(db: AsyncSession, request: Request, response: Response, u: m.User) -> dict:
    await start_session(db, request, response, u.id)
    return await me_response(db, u)


@router.post("/auth/register", status_code=201)
async def register(request: Request, response: Response, body: dict = Body(...), db: AsyncSession = Depends(get_db, scope="function")):
    name = clean.text(body.get("name"), "name", 200, required=True, label="Your name") or ""
    email = clean.email(body.get("email"))
    pw = clean.password(body.get("password"))
    code = get_settings().signup_code
    if code and not hmac.compare_digest(str(body.get("signupCode") or "").strip(), code):
        fail(403, "signup_code", "Sign-ups are invite-only right now. Enter the code you were given, or ask a team to invite you.")
    if await find_by_email(db, email):
        fail(409, "email_taken", "An account with this email already exists. Sign in instead.")
    u = m.User(id=uuid7(), name=name, email=email, password_hash=hash_password(pw), timezone=clean.timezone(body.get("timezone")) or "UTC")
    db.add(u)
    await db.flush()
    token = await issue_token(db, "verify", u.id, 72)
    await send_email(db, u.email, "Verify your email", f"Hi {u.name}, confirm your address to finish creating your account.", f"/verify/{token}")
    return await signed_in(db, request, response, u)


@router.post("/auth/verify/{token}")
async def verify(token: str, request: Request, response: Response, db: AsyncSession = Depends(get_db, scope="function")):
    u = await use_token(db, "verify", token, "This verification link is invalid or was already used")
    u.email_verified_at = now()
    return await signed_in(db, request, response, u)


@router.post("/auth/login")
async def login(request: Request, response: Response, body: dict = Body(...), db: AsyncSession = Depends(get_db, scope="function")):
    email = clean.text(body.get("email"), "email", 254) or ""
    pw = body.get("password") if isinstance(body.get("password"), str) else ""
    if security.login_locked(email):
        fail(429, "rate_limited", "Too many wrong passwords for this account. Wait 15 minutes, or use “Forgot?” to reset it.")
    u = await find_by_email(db, email)
    # Same work whether or not the account exists, so response time doesn't reveal accounts.
    ok = verify_password(u.password_hash if u else DUMMY_HASH, pw[:256])
    if not u or not ok:
        security.record_login_failure(email)
        fail(401, "bad_credentials", "Email or password is incorrect")
    if u.deactivated_at:
        fail(403, "deactivated", "This account has been deactivated")
    return await signed_in(db, request, response, u)


@router.post("/auth/magic-link", status_code=204)
async def magic_link(body: dict = Body(...), db: AsyncSession = Depends(get_db, scope="function")):
    u = await find_by_email(db, clean.text(body.get("email"), "email", 254) or "")
    # Same response whether or not the account exists (no account enumeration).
    if u:
        token = await issue_token(db, "magic", u.id, 1)
        await send_email(db, u.email, "Your sign-in link", "Click to sign in. The link works once.", f"/magic/{token}")
    return Response(status_code=204)


@router.post("/auth/magic/{token}")
async def magic(token: str, request: Request, response: Response, db: AsyncSession = Depends(get_db, scope="function")):
    u = await use_token(db, "magic", token, "This sign-in link is invalid or was already used")
    return await signed_in(db, request, response, u)


@router.post("/auth/forgot", status_code=204)
async def forgot(body: dict = Body(...), db: AsyncSession = Depends(get_db, scope="function")):
    u = await find_by_email(db, clean.text(body.get("email"), "email", 254) or "")
    if u:
        token = await issue_token(db, "reset", u.id, 2)
        await send_email(db, u.email, "Reset your password", "Use this link to choose a new password.", f"/reset/{token}")
    return Response(status_code=204)


@router.post("/auth/reset/{token}")
async def reset(token: str, request: Request, response: Response, body: dict = Body(...), db: AsyncSession = Depends(get_db, scope="function")):
    pw = clean.password(body.get("password"))
    u = await use_token(db, "reset", token, "This reset link is invalid or expired")
    u.password_hash = hash_password(pw)
    # A reset signs out every other session.
    await db.execute(update(m.Session).where(m.Session.user_id == u.id, m.Session.revoked_at.is_(None)).values(revoked_at=now()))
    return await signed_in(db, request, response, u)


@router.post("/auth/logout", status_code=204)
async def logout(request: Request, db: AsyncSession = Depends(get_db, scope="function")):
    s = await session_row(db, request)
    if s:
        s.revoked_at = now()
    response = Response(status_code=204)
    clear_session_cookie(response)
    return response


# ---------------------------------------------------------------- me


@router.get("/me")
async def get_me(u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    return await me_response(db, u)


@router.patch("/me")
async def patch_me(body: dict = Body(...), u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    # Photos go through PUT /me/avatar; avatarUrl is never client-writable.
    if "name" in body:
        u.name = clean.text(body["name"], "name", 200, required=True, label="Name") or u.name
    if "title" in body:
        u.title = clean.text(body["title"], "title", 200)
    if "bio" in body:
        u.bio = clean.text(body["bio"], "bio", 2000, multiline=True)
    if "pronouns" in body:
        u.pronouns = clean.text(body["pronouns"], "pronouns", 50)
    if "timezone" in body:
        u.timezone = clean.timezone(body["timezone"]) or "UTC"
    return await me_response(db, u)


@router.put("/me/avatar")
async def put_avatar(request: Request, u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    data = await read_limited(request, avatars.MAX_BYTES, "Profile photos must be under 8 MB")
    await avatars.set_avatar(db, u, data)
    return await me_response(db, u)


@router.delete("/me/avatar")
async def delete_avatar(u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    await avatars.remove_avatar(db, u)
    return await me_response(db, u)


@router.get("/users/{user_id}/avatar")
async def get_avatar(user_id: str, u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    """Visible to the person and to anyone who shares an organization with them."""
    uid = parse_uuid(user_id)
    if not uid:
        fail(404, "not_found", "Photo not found")
    if uid != u.id:
        mine = select(m.Membership.org_id).where(m.Membership.user_id == u.id, m.Membership.status == "active")
        shared = await db.scalar(select(func.count()).select_from(m.Membership).where(m.Membership.user_id == uid, m.Membership.org_id.in_(mine)))
        if not shared:
            fail(404, "not_found", "Photo not found")
    found = await storage.get_key(db, avatars.key_for(uid))
    if not found:
        fail(404, "not_found", "Photo not found")
    mime, data = found
    return Response(content=data, media_type=mime, headers={"Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff"})


@router.put("/me/preferences")
async def put_prefs(body: dict = Body(...), u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    u.preferences = clean.preferences(body)
    return await me_response(db, u)


@router.put("/me/password", status_code=204)
async def put_password(body: dict = Body(...), u: m.User = Depends(require_user)):
    current = body.get("current") if isinstance(body.get("current"), str) else ""
    if not verify_password(u.password_hash, current[:256]):
        fail(422, "bad_credentials", "Current password is incorrect")
    u.password_hash = hash_password(clean.password(body.get("next"), "next"))
    return Response(status_code=204)


@router.post("/me/last-workspace", status_code=204)
async def last_workspace(body: dict = Body(...), u: m.User = Depends(require_user)):
    u.last_workspace_id = parse_uuid(body.get("workspaceId"))
    return Response(status_code=204)


@router.get("/me/sessions")
async def sessions(request: Request, u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    cur = await session_row(db, request)
    rows = (await db.execute(select(m.Session).where(m.Session.user_id == u.id, m.Session.revoked_at.is_(None), m.Session.expires_at > now()).order_by(m.Session.created_at.desc()))).scalars()
    return [{"id": str(s.id), "device": s.device, "ip": s.ip, "createdAt": iso(s.created_at), "current": cur is not None and s.id == cur.id} for s in rows]


@router.delete("/me/sessions", status_code=204)
async def revoke_others(request: Request, u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    cur = await session_row(db, request)
    q = update(m.Session).where(m.Session.user_id == u.id, m.Session.revoked_at.is_(None))
    if cur:
        q = q.where(m.Session.id != cur.id)
    await db.execute(q.values(revoked_at=now()))
    return Response(status_code=204)


@router.delete("/me/sessions/{sid}", status_code=204)
async def revoke(sid: str, u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    s = await db.get(m.Session, parse_uuid(sid)) if parse_uuid(sid) else None
    if not s or s.user_id != u.id:
        fail(404, "not_found", "Session not found")
    s.revoked_at = now()
    return Response(status_code=204)


@router.post("/me/export", status_code=202)
async def export(u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    await send_email(db, u.email, "Your data export is ready", "Your posts, comments, and images are packaged as JSON + image files.", "/me/data")
    return {"status": "queued"}


@router.delete("/me", status_code=204)
async def delete_me(u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    owned = (await db.execute(select(m.Membership).where(m.Membership.user_id == u.id, m.Membership.role == "owner", m.Membership.status == "active"))).scalars().all()
    for mem in owned:
        others = await db.scalar(
            select(func.count()).select_from(m.Membership).where(m.Membership.org_id == mem.org_id, m.Membership.role == "owner", m.Membership.user_id != u.id, m.Membership.status == "active")
        )
        if not others:
            org = await db.get(m.Organization, mem.org_id)
            fail(409, "last_owner", f"Transfer ownership of {org.name if org else 'your organization'} before deleting your account")
    # Deactivation, never a hard delete of authored content (§B3).
    u.deactivated_at = now()
    await db.execute(update(m.Session).where(m.Session.user_id == u.id).values(revoked_at=now()))
    response = Response(status_code=204)
    clear_session_cookie(response)
    return response


__all__ = ["router", "me_response", "send_email", "current_user", "get_settings"]
