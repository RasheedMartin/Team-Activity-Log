"""Organizations, people, invites, workspaces, tags (Postgres-owned). Same contract as the mock."""

from __future__ import annotations

import datetime as dt
import re
import secrets
import unicodedata

from fastapi import APIRouter, Body, Depends, Request, Response
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models as m
from .. import plans
from .. import sanitize as clean
from ..config import get_settings
from ..context import OrgCtx, accessible_workspaces, current_user, hash_password, org_ctx, require_user, start_session, token_hash, verify_password
from ..db import get_db
from ..errors import ApiError, fail
from ..ids import parse_uuid, uuid7
from ..timeutil import iso, now, today
from ..views import org_view, tag_view, user_view, workspace_view
from .auth import find_by_email, me_response, send_email

router = APIRouter()

TAG_COLORS = ["#2563eb", "#0891b2", "#059669", "#65a30d", "#ca8a04", "#ea580c", "#dc2626", "#db2777", "#9333ea", "#4f46e5", "#0d9488", "#64748b"]
RESERVED = {"admin", "api", "app", "dev", "me", "new", "o", "register", "settings", "v1"}


def slugify(s: str) -> str:
    s = unicodedata.normalize("NFD", s.lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")[:40]


async def slug_taken(db: AsyncSession, slug: str) -> bool:
    return slug in RESERVED or bool(await db.scalar(select(func.count()).select_from(m.Organization).where(m.Organization.slug == slug)))


def end_of_days(days: int) -> dt.datetime:
    d = today() + dt.timedelta(days=days)
    return dt.datetime(d.year, d.month, d.day, tzinfo=dt.UTC)


async def members_of(db: AsyncSession, ws_ids: dict, mem: m.Membership) -> list[str]:
    return ws_ids.get(mem.user_id, [])


async def workspace_ids_by_user(db: AsyncSession, org_id) -> dict:
    rows = await db.execute(select(m.WorkspaceMember.user_id, m.WorkspaceMember.workspace_id).join(m.Workspace, m.Workspace.id == m.WorkspaceMember.workspace_id).where(m.Workspace.org_id == org_id))
    out: dict = {}
    for uid, wid in rows:
        out.setdefault(uid, []).append(str(wid))
    return out


def membership_view(mem: m.Membership, u: m.User | None, ws_ids: list[str]) -> dict:
    return {
        "orgId": str(mem.org_id),
        "user": user_view(u) if u else {"id": str(mem.user_id), "name": "Unknown", "email": ""},
        "role": mem.role,
        "status": "deactivated" if u and u.deactivated_at else mem.status,
        "workspaceIds": ws_ids,
    }


def invite_view(i: m.Invite) -> dict:
    status = "expired" if i.status == "pending" and i.expires_at < now() else i.status
    return {
        "id": str(i.id),
        "orgId": str(i.org_id),
        "email": i.email,
        "role": i.role,
        "workspaceIds": [str(w) for w in i.workspace_ids or []],
        "status": status,
        "expiresAt": iso(i.expires_at),
        "invitedBy": str(i.invited_by) if i.invited_by else "",
        "createdAt": iso(i.created_at),
    }


async def issue_invite(db: AsyncSession, ctx: OrgCtx, email: str, role: str, workspace_ids: list, name: str | None) -> m.Invite:
    token = secrets.token_urlsafe(24)
    inv = m.Invite(
        id=uuid7(),
        org_id=ctx.org.id,
        email=email.strip().lower(),
        name=name,
        role=role,
        workspace_ids=[w for w in (parse_uuid(x) for x in workspace_ids or []) if w],
        status="pending",
        token_hash=token_hash(token),
        expires_at=end_of_days(7),
        invited_by=ctx.user.id,
        created_at=now(),
    )
    db.add(inv)
    await send_email(db, inv.email, f"You're invited to {ctx.org.name}", f"{ctx.user.name} invited you to join {ctx.org.name} as {role}.", f"/accept-invite/{token}")
    return inv


async def set_workspace_members(db: AsyncSession, user_id, ws_ids: list) -> None:
    await db.execute(delete(m.WorkspaceMember).where(m.WorkspaceMember.user_id == user_id))
    for w in dict.fromkeys(ws_ids):
        db.add(m.WorkspaceMember(workspace_id=w, user_id=user_id))


async def seed_default_tags(db: AsyncSession, org_id) -> None:
    for g, names in (("Status", ["in-progress", "blocked", "done"]), ("Topic", ["calibration", "analysis", "hardware"])):
        group = m.TagGroup(id=uuid7(), org_id=org_id, name=g)
        db.add(group)
        await db.flush()
        for i, n in enumerate(names):
            db.add(m.Tag(id=uuid7(), org_id=org_id, name=n, color=TAG_COLORS[(i * 3 + len(g)) % len(TAG_COLORS)], group_id=group.id))


# ---------------------------------------------------------------- orgs


@router.get("/orgs/slug-available")
async def slug_available(slug: str = "", db: AsyncSession = Depends(get_db, scope="function")):
    s = slugify(slug)
    return {"slug": s, "available": bool(s) and not await slug_taken(db, s)}


@router.post("/orgs", status_code=201)
async def create_org(body: dict = Body(...), u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    name = clean.text(body.get("name"), "name", 100, required=True, label="Organization name") or ""
    slug = slugify(clean.text(body.get("slug"), "slug", 60) or name)
    if not slug or await slug_taken(db, slug):
        fail(409, "slug_taken", "That URL is taken, try another")
    org = m.Organization(id=uuid7(), name=name, slug=slug, plan=get_settings().new_org_plan)
    db.add(org)
    await db.flush()
    ws_name = clean.text(body.get("workspaceName"), "workspaceName", 100) or "General"
    ws = m.Workspace(id=uuid7(), org_id=org.id, name=ws_name, slug=slugify(ws_name) or "general", all_org_members=True, created_at=now())
    db.add(ws)
    db.add(m.Membership(id=uuid7(), org_id=org.id, user_id=u.id, role="owner", status="active"))
    await db.flush()
    db.add(m.WorkspaceMember(workspace_id=ws.id, user_id=u.id))
    await seed_default_tags(db, org.id)
    u.last_workspace_id = ws.id
    await db.flush()
    return await me_response(db, u)


@router.patch("/orgs/{org}")
async def patch_org(org: str, body: dict = Body(...), u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await org_ctx(db, u, org, "owner")
    if "name" in body:
        ctx.org.name = clean.text(body["name"], "name", 100, required=True, label="Organization name") or ctx.org.name
    return org_view(ctx.org)


# ---------------------------------------------------------------- people & members


@router.get("/orgs/{org}/people")
async def people(org: str, u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await org_ctx(db, u, org)
    rows = await db.execute(select(m.User).join(m.Membership, m.Membership.user_id == m.User.id).where(m.Membership.org_id == ctx.org.id, m.Membership.status != "invited").order_by(m.Membership.created_at))
    return [user_view(x) for x in rows.scalars()]


@router.get("/orgs/{org}/members")
async def members(org: str, u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await org_ctx(db, u, org)
    ws_ids = await workspace_ids_by_user(db, ctx.org.id)
    rows = await db.execute(select(m.Membership, m.User).join(m.User, m.User.id == m.Membership.user_id).where(m.Membership.org_id == ctx.org.id).order_by(m.Membership.created_at))
    return [membership_view(mem, usr, ws_ids.get(mem.user_id, [])) for mem, usr in rows]


async def _member(db: AsyncSession, ctx: OrgCtx, user_id: str) -> m.Membership:
    uid = parse_uuid(user_id)
    mem = (await db.execute(select(m.Membership).where(m.Membership.org_id == ctx.org.id, m.Membership.user_id == uid))).scalar_one_or_none() if uid else None
    if not mem:
        fail(404, "not_found", "Member not found")
    return mem


@router.patch("/orgs/{org}/members/{user_id}")
async def patch_member(org: str, user_id: str, body: dict = Body(...), u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await org_ctx(db, u, org, "admin")
    mem = await _member(db, ctx, user_id)
    owners = await db.scalar(select(func.count()).select_from(m.Membership).where(m.Membership.org_id == ctx.org.id, m.Membership.role == "owner", m.Membership.status == "active"))
    role, status = body.get("role"), body.get("status")
    if mem.role == "owner" and ctx.role != "owner":
        fail(403, "forbidden", "Only an owner can change another owner")
    if role == "owner" and ctx.role != "owner":
        fail(403, "forbidden", "Only an owner can grant ownership")
    losing = mem.role == "owner" and ((role and role != "owner") or status == "deactivated")
    if losing and (owners or 0) <= 1:
        fail(409, "last_owner", "The last owner can't be removed. Transfer ownership first.")
    if role:
        if role not in ("owner", "admin", "member", "viewer"):
            fail(422, "invalid", "Unknown role")
        mem.role = role
    if status in ("active", "deactivated"):
        mem.status = status
    if body.get("workspaceIds") is not None:
        wanted = set(clean.uuid_list(body["workspaceIds"], "workspaceIds", 500))
        valid = {w.id for w in (await db.execute(select(m.Workspace).where(m.Workspace.org_id == ctx.org.id))).scalars()}
        await db.execute(delete(m.WorkspaceMember).where(m.WorkspaceMember.user_id == mem.user_id, m.WorkspaceMember.workspace_id.in_(valid)))
        for w in wanted & valid:
            db.add(m.WorkspaceMember(workspace_id=w, user_id=mem.user_id))
    if status == "deactivated":
        from sqlalchemy import update

        await db.execute(update(m.Session).where(m.Session.user_id == mem.user_id, m.Session.revoked_at.is_(None)).values(revoked_at=now()))
    await db.flush()
    ws_ids = await workspace_ids_by_user(db, ctx.org.id)
    return membership_view(mem, await db.get(m.User, mem.user_id), ws_ids.get(mem.user_id, []))


@router.delete("/orgs/{org}/members/{user_id}", status_code=204)
async def remove_member(org: str, user_id: str, u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await org_ctx(db, u, org, "admin")
    mem = await _member(db, ctx, user_id)
    if mem.role == "owner":
        fail(409, "last_owner", "Transfer ownership before removing an owner")
    ws = select(m.Workspace.id).where(m.Workspace.org_id == ctx.org.id)
    await db.execute(delete(m.WorkspaceMember).where(m.WorkspaceMember.user_id == mem.user_id, m.WorkspaceMember.workspace_id.in_(ws)))
    await db.delete(mem)
    return Response(status_code=204)


@router.post("/orgs/{org}/transfer", status_code=204)
async def transfer(org: str, body: dict = Body(...), u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await org_ctx(db, u, org, "owner")
    target = await _member(db, ctx, str(body.get("userId")))
    if target.status != "active":
        fail(404, "not_found", "Member not found")
    target.role = "owner"
    ctx.membership.role = "admin"
    return Response(status_code=204)


# ---------------------------------------------------------------- invites


@router.get("/orgs/{org}/invites")
async def list_invites(org: str, u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await org_ctx(db, u, org, "admin")
    rows = await db.execute(select(m.Invite).where(m.Invite.org_id == ctx.org.id, m.Invite.status != "accepted").order_by(m.Invite.created_at.desc()))
    return [invite_view(i) for i in rows.scalars()]


@router.post("/orgs/{org}/invites", status_code=201)
async def create_invites(org: str, body: dict = Body(...), u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await org_ctx(db, u, org, "admin")
    results = []
    batch = body.get("invites") or []
    if not isinstance(batch, list) or len(batch) > 200:
        fail(422, "invalid", "Send at most 200 invites at a time")
    for i in batch:
        if not isinstance(i, dict):
            continue
        raw = i.get("email") if isinstance(i.get("email"), str) else ""
        try:
            email = clean.email(raw)
            name = clean.text(i.get("name"), "name", 200)
            ws_ids = clean.uuid_list(i.get("workspaceIds"), "workspaceIds", 500)
        except ApiError as e:
            results.append({"email": raw[:254], "error": e.message})
            continue
        if i.get("role") == "owner":
            results.append({"email": email, "error": "Invite as admin, then transfer ownership"})
            continue
        if i.get("role") not in ("admin", "member", "viewer"):
            results.append({"email": email, "error": "Choose a role: admin, member, or viewer"})
            continue
        existing = await find_by_email(db, email)
        if existing and (await db.execute(select(m.Membership).where(m.Membership.org_id == ctx.org.id, m.Membership.user_id == existing.id))).scalar_one_or_none():
            results.append({"email": email, "error": "Already a member"})
            continue
        for old in (await db.execute(select(m.Invite).where(m.Invite.org_id == ctx.org.id, m.Invite.email == email.lower(), m.Invite.status == "pending"))).scalars():
            old.status = "revoked"
        await db.flush()
        try:
            await plans.check_can_add_members(db, ctx.org)
        except ApiError as e:
            results.append({"email": email, "error": e.message})
            continue
        inv = await issue_invite(db, ctx, email, i["role"], ws_ids, name)
        results.append({"email": email, "invite": invite_view(inv)})
    return results


async def _invite(db: AsyncSession, ctx: OrgCtx, invite_id: str) -> m.Invite:
    inv = await db.get(m.Invite, parse_uuid(invite_id)) if parse_uuid(invite_id) else None
    if not inv or inv.org_id != ctx.org.id:
        fail(404, "not_found", "Invite not found")
    return inv


@router.post("/orgs/{org}/invites/{invite_id}/resend")
async def resend(org: str, invite_id: str, u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await org_ctx(db, u, org, "admin")
    inv = await _invite(db, ctx, invite_id)
    inv.status = "revoked"
    new = await issue_invite(db, ctx, inv.email, inv.role, list(inv.workspace_ids or []), inv.name)
    return invite_view(new)


@router.delete("/orgs/{org}/invites/{invite_id}", status_code=204)
async def revoke_invite(org: str, invite_id: str, u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await org_ctx(db, u, org, "admin")
    (await _invite(db, ctx, invite_id)).status = "revoked"
    return Response(status_code=204)


def link_view(link: m.InviteLink) -> dict:
    return {"id": str(link.id), "orgId": str(link.org_id), "token": link.token, "roleCap": link.role_cap, "expiresAt": iso(link.expires_at)}


@router.get("/orgs/{org}/invite-links")
async def list_links(org: str, u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await org_ctx(db, u, org, "admin")
    rows = await db.execute(select(m.InviteLink).where(m.InviteLink.org_id == ctx.org.id, m.InviteLink.expires_at > now()))
    return [link_view(x) for x in rows.scalars()]


@router.post("/orgs/{org}/invite-links", status_code=201)
async def create_link(org: str, body: dict = Body(...), u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await org_ctx(db, u, org, "admin")
    cap = body.get("roleCap") if body.get("roleCap") in ("admin", "member", "viewer", "owner") else "member"
    days = int(clean.number(body.get("days", 7), "days", 1, 90))
    link = m.InviteLink(id=uuid7(), org_id=ctx.org.id, token=f"link-{secrets.token_urlsafe(12)}", role_cap="admin" if cap == "owner" else cap, expires_at=end_of_days(days))
    db.add(link)
    return link_view(link)


@router.delete("/orgs/{org}/invite-links/{link_id}", status_code=204)
async def delete_link(org: str, link_id: str, u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await org_ctx(db, u, org, "admin")
    link = await db.get(m.InviteLink, parse_uuid(link_id)) if parse_uuid(link_id) else None
    if link and link.org_id == ctx.org.id:
        await db.delete(link)
    return Response(status_code=204)


async def _token_lookup(db: AsyncSession, token: str) -> tuple[m.Invite | None, m.InviteLink | None]:
    inv = (await db.execute(select(m.Invite).where(m.Invite.token_hash == token_hash(token)))).scalar_one_or_none()
    link = (await db.execute(select(m.InviteLink).where(m.InviteLink.token == token))).scalar_one_or_none()
    return inv, link


@router.get("/invites/{token}")
async def lookup_invite(token: str, db: AsyncSession = Depends(get_db, scope="function")):
    inv, link = await _token_lookup(db, token)
    if link:
        org = await db.get(m.Organization, link.org_id)
        return {"kind": "link", "org": org_view(org), "role": link.role_cap, "status": "expired" if link.expires_at < now() else "pending"}
    if not inv:
        fail(404, "invalid_token", "This invite link isn't valid")
    org = await db.get(m.Organization, inv.org_id)
    out = {"kind": "invite", "org": org_view(org), "email": inv.email, "role": inv.role, "status": invite_view(inv)["status"], "hasAccount": bool(await find_by_email(db, inv.email))}
    if inv.name:
        out["name"] = inv.name
    return out


@router.post("/invites/{token}/accept")
async def accept_invite(token: str, request: Request, response: Response, body: dict = Body(default={}), db: AsyncSession = Depends(get_db, scope="function"), user: m.User | None = Depends(current_user)):
    inv, link = await _token_lookup(db, token)
    if not inv and not link:
        fail(404, "invalid_token", "This invite link isn't valid")
    if inv and invite_view(inv)["status"] != "pending":
        st = invite_view(inv)["status"]
        fail(410, "invite_unusable", f"This invite is {st}. Ask an admin for a new one.")
    if link and link.expires_at < now():
        fail(410, "invite_unusable", "This invite link has expired")
    org_id = inv.org_id if inv else link.org_id  # type: ignore[union-attr]
    email = inv.email if inv else (clean.email(body.get("email")) if not user else "").lower()
    if user and inv and user.email.lower() != inv.email:
        fail(409, "wrong_account", f"This invite is for {inv.email}. Sign out and try again.")
    if not user:
        existing = await find_by_email(db, email)
        if existing:
            pw = body.get("password") if isinstance(body.get("password"), str) else ""
            if not verify_password(existing.password_hash, pw[:256]):
                fail(401, "bad_credentials", "Sign in with your existing password to accept")
            user = existing
        else:
            name = clean.text(body.get("name"), "name", 200, required=True, label="Your name") or ""
            pw = clean.password(body.get("password"))
            # An email invite proves the address (the link was mailed there); a shared join link doesn't.
            user = m.User(id=uuid7(), name=name, email=email, password_hash=hash_password(pw), email_verified_at=now() if inv else None, timezone=clean.timezone(body.get("timezone")) or "UTC")
            db.add(user)
            await db.flush()
    role = inv.role if inv else link.role_cap  # type: ignore[union-attr]
    ws_ids = list(inv.workspace_ids or []) if inv else []
    mem = (await db.execute(select(m.Membership).where(m.Membership.org_id == org_id, m.Membership.user_id == user.id))).scalar_one_or_none()
    if not mem or mem.status != "active":
        await plans.check_can_join(db, await db.get(m.Organization, org_id))
    if mem:
        mem.status = "active"
    else:
        db.add(m.Membership(id=uuid7(), org_id=org_id, user_id=user.id, role=role, status="active"))
    have = set((await db.execute(select(m.WorkspaceMember.workspace_id).where(m.WorkspaceMember.user_id == user.id))).scalars())
    for w in ws_ids:
        if w not in have:
            db.add(m.WorkspaceMember(workspace_id=w, user_id=user.id))
    if inv:
        inv.status = "accepted"
    first = ws_ids[0] if ws_ids else await db.scalar(select(m.Workspace.id).where(m.Workspace.org_id == org_id, m.Workspace.all_org_members.is_(True), m.Workspace.archived.is_(False)).order_by(m.Workspace.created_at))
    if first:
        user.last_workspace_id = first
    await db.flush()
    await start_session(db, request, response, user.id)
    return await me_response(db, user)


# ---------------------------------------------------------------- workspaces


@router.get("/orgs/{org}/workspaces")
async def list_workspaces(org: str, u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await org_ctx(db, u, org)
    return [workspace_view(w) for w in await accessible_workspaces(ctx, ctx.is_admin)]


@router.post("/orgs/{org}/workspaces", status_code=201)
async def create_workspace(org: str, body: dict = Body(...), u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await org_ctx(db, u, org, "admin")
    name = clean.text(body.get("name"), "name", 100, required=True, label="Workspace name") or ""
    description = clean.text(body.get("description"), "description", 1000, multiline=True)
    all_members = body.get("allOrgMembers") is True
    base = slugify(name) or "workspace"
    slug, n = base, 2
    while await db.scalar(select(func.count()).select_from(m.Workspace).where(m.Workspace.org_id == ctx.org.id, m.Workspace.slug == slug)):
        slug, n = f"{base}-{n}", n + 1
    await plans.check_can_open_workspace(db, ctx.org, private=not all_members)
    ws = m.Workspace(id=uuid7(), org_id=ctx.org.id, name=name, slug=slug, description=description, all_org_members=all_members, created_at=now())
    db.add(ws)
    await db.flush()
    member_ids = set(clean.uuid_list(body.get("memberIds"), "memberIds", 1000)) | {u.id}
    in_org = set((await db.execute(select(m.Membership.user_id).where(m.Membership.org_id == ctx.org.id, m.Membership.user_id.in_(member_ids)))).scalars())
    for uid in in_org:
        db.add(m.WorkspaceMember(workspace_id=ws.id, user_id=uid))
    return workspace_view(ws)


@router.patch("/orgs/{org}/workspaces/{ws_id}")
async def patch_workspace(org: str, ws_id: str, body: dict = Body(...), u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await org_ctx(db, u, org, "admin")
    ws = await db.get(m.Workspace, parse_uuid(ws_id)) if parse_uuid(ws_id) else None
    if not ws or ws.org_id != ctx.org.id:
        fail(404, "not_found", "Workspace not found")
    if body.get("memberIds") is not None:
        wanted = set(clean.uuid_list(body["memberIds"], "memberIds", 1000))
        await db.execute(delete(m.WorkspaceMember).where(m.WorkspaceMember.workspace_id == ws.id))
        in_org = set((await db.execute(select(m.Membership.user_id).where(m.Membership.org_id == ctx.org.id, m.Membership.user_id.in_(wanted)))).scalars())
        for uid in in_org:
            db.add(m.WorkspaceMember(workspace_id=ws.id, user_id=uid))
    if ws.archived and body.get("archived") is False:  # reopening counts like creating
        await plans.check_can_open_workspace(db, ctx.org, private=not body.get("allOrgMembers", ws.all_org_members))
    elif body.get("allOrgMembers") is False and ws.all_org_members:
        plans.check_private_allowed(ctx.org)
    if "name" in body:
        ws.name = clean.text(body["name"], "name", 100, required=True, label="Workspace name") or ws.name
    if "description" in body:
        ws.description = clean.text(body["description"], "description", 1000, multiline=True)
    for key, attr in (("archived", "archived"), ("allOrgMembers", "all_org_members")):
        if isinstance(body.get(key), bool):
            setattr(ws, attr, body[key])
    return workspace_view(ws)


# ---------------------------------------------------------------- tags


@router.get("/orgs/{org}/tags")
async def list_tags(org: str, u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await org_ctx(db, u, org)
    tags = (await db.execute(select(m.Tag).where(m.Tag.org_id == ctx.org.id).order_by(m.Tag.name))).scalars()
    groups = (await db.execute(select(m.TagGroup).where(m.TagGroup.org_id == ctx.org.id))).scalars()
    return {"tags": [tag_view(t) for t in tags], "groups": [{"id": str(g.id), "name": g.name} for g in groups]}


@router.post("/orgs/{org}/tags")
async def create_tag(org: str, response: Response, body: dict = Body(...), u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await org_ctx(db, u, org, "member")
    tag_name = re.sub(r"\s+", "-", (clean.text(body.get("name"), "name", 50, required=True, label="Tag name") or "").lower())
    existing = (await db.execute(select(m.Tag).where(m.Tag.org_id == ctx.org.id, func.lower(m.Tag.name) == tag_name))).scalar_one_or_none()
    if existing:
        return tag_view(existing)
    count = await db.scalar(select(func.count()).select_from(m.Tag).where(m.Tag.org_id == ctx.org.id)) or 0
    group = await db.get(m.TagGroup, parse_uuid(body.get("groupId"))) if parse_uuid(body.get("groupId")) else None
    tag = m.Tag(id=uuid7(), org_id=ctx.org.id, name=tag_name, color=TAG_COLORS[count % len(TAG_COLORS)], group_id=group.id if group and group.org_id == ctx.org.id else None)
    db.add(tag)
    response.status_code = 201
    return tag_view(tag)


@router.get("/orgs/{org}/plan")
async def plan(org: str, u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await org_ctx(db, u, org, "admin")
    return await plans.plan_view(db, ctx.org)
