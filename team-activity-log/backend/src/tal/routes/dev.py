"""Dev-only endpoints (DEV_MODE=true; refused in production).

Scenarios are generated in the browser by the same seed code the mock uses
(frontend/src/mock/seed.ts) and posted here as table rows, so mock and live mode show identical
data without a second seed implementation to keep in sync.
"""

from __future__ import annotations

import base64
import datetime as dt
import uuid
from typing import Any

from fastapi import APIRouter, Body, Depends, Request, Response
from sqlalchemy import insert, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models as m
from .. import storage
from ..config import get_settings
from ..context import hash_password, start_session, token_hash
from ..db import get_db
from ..errors import fail
from ..search.client import es
from ..search.indexer import alias, ensure_index, reindex_all
from ..timeutil import iso, now, parse_iso
from ..views import user_view
from .auth import me_response

router = APIRouter()

TABLES_IN_DELETE_ORDER = [
    "outbox", "emails", "notifications", "pins", "import_sources", "import_jobs", "collection_posts", "collections",
    "saved_views", "comments", "image_instances", "asset_blobs", "assets", "uploads", "post_revisions", "post_tags",
    "post_co_authors", "posts", "tags", "tag_groups", "invite_links", "invites", "workspace_members", "workspaces",
    "memberships", "organizations", "auth_tokens", "sessions", "users",
]  # fmt: skip


def U(v: Any) -> uuid.UUID | None:
    try:
        return uuid.UUID(str(v)) if v else None
    except ValueError:
        return None


def T(v: Any) -> dt.datetime | None:
    return parse_iso(v) if v else None


def D(v: Any) -> dt.date:
    return dt.date.fromisoformat(str(v)[:10])


async def bulk(db: AsyncSession, model: type, rows: list[dict]) -> None:
    for i in range(0, len(rows), 500):
        if rows[i : i + 500]:
            await db.execute(insert(model), rows[i : i + 500])


@router.get("/dev/personas")
async def personas(db: AsyncSession = Depends(get_db, scope="function")):
    users = (await db.execute(select(m.User).where(m.User.deactivated_at.is_(None)).order_by(m.User.created_at, m.User.id))).scalars().all()
    rows = (await db.execute(select(m.Membership, m.Organization.name).join(m.Organization, m.Organization.id == m.Membership.org_id))).all()
    roles: dict[uuid.UUID, list[str]] = {}
    for mem, org_name in rows:
        roles.setdefault(mem.user_id, []).append(f"{mem.role} @ {org_name}")
    return [{"user": user_view(u), "roles": roles.get(u.id, [])} for u in users]


@router.post("/dev/sign-in-as")
async def sign_in_as(request: Request, response: Response, body: dict = Body(...), db: AsyncSession = Depends(get_db, scope="function")):
    u = await db.get(m.User, U(body.get("userId"))) if U(body.get("userId")) else None
    if not u:
        fail(404, "not_found", "No such persona")
    await start_session(db, request, response, u.id)
    return await me_response(db, u)


@router.get("/dev/emails")
async def emails(db: AsyncSession = Depends(get_db, scope="function")):
    rows = (await db.execute(select(m.Email).order_by(m.Email.sent_at.desc()).limit(200))).scalars()
    return [{k: v for k, v in {"id": str(e.id), "to": e.to, "subject": e.subject, "body": e.body, "link": e.link, "sentAt": iso(e.sent_at)}.items() if v is not None} for e in rows]


@router.post("/dev/load")
async def load(request: Request, response: Response, body: dict = Body(...), db: AsyncSession = Depends(get_db, scope="function")):
    """Replace everything with a scenario: {tables: {<mock table>: rows}, assetFiles: {name: base64}, signInAs?}."""
    if not get_settings().dev_allow_reset:
        fail(403, "reset_disabled", "Loading a scenario wipes this database. Set DEV_ALLOW_RESET=true only for a local or test database.")
    t: dict[str, list[dict]] = body.get("tables") or {}
    files: dict[str, str] = body.get("assetFiles") or {}
    await db.execute(text("truncate " + ", ".join(TABLES_IN_DELETE_ORDER) + " restart identity cascade"))

    users = t.get("users", [])
    prefs = {p["id"]: {k: v for k, v in p.items() if k != "id"} for p in t.get("prefs", [])}
    meta = {r["id"]: r.get("value") for r in t.get("meta", [])}
    # Hash once per distinct password: personas share one.
    hashes: dict[str, str] = {}
    await bulk(
        db,
        m.User,
        [
            {
                "id": U(u["id"]),
                "email": u["email"],
                "name": u["name"],
                "password_hash": hashes.setdefault(u.get("password") or "", hash_password(u.get("password") or "")),
                "avatar_url": u.get("avatarUrl"),
                "title": u.get("title"),
                "bio": u.get("bio"),
                "pronouns": u.get("pronouns"),
                "timezone": u.get("timezone"),
                "preferences": prefs.get(u["id"]),
                "last_workspace_id": U(meta.get(f"lastWs:{u['id']}")),
                "email_verified_at": now() if u.get("verified") else None,
                "deactivated_at": T(u.get("deactivatedAt")),
            }
            for u in users
        ],
    )
    await bulk(db, m.Organization, [{"id": U(o["id"]), "name": o["name"], "slug": o["slug"]} for o in t.get("orgs", [])])
    await bulk(
        db,
        m.Workspace,
        [
            {"id": U(w["id"]), "org_id": U(w["orgId"]), "name": w["name"], "slug": w["slug"], "description": w.get("description"), "archived": bool(w.get("archived")), "all_org_members": bool(w.get("allOrgMembers")), "created_at": now() + dt.timedelta(microseconds=i)}
            for i, w in enumerate(t.get("workspaces", []))
        ],
    )
    mems = t.get("memberships", [])
    await bulk(db, m.Membership, [{"id": U(x["id"]), "org_id": U(x["orgId"]), "user_id": U(x["userId"]), "role": x["role"], "status": x.get("status") or "active", "created_at": now() + dt.timedelta(microseconds=i)} for i, x in enumerate(mems)])
    wm = {(U(w), U(x["userId"])) for x in mems for w in x.get("workspaceIds") or []}
    await bulk(db, m.WorkspaceMember, [{"workspace_id": w, "user_id": u} for w, u in wm])
    await bulk(
        db,
        m.Invite,
        [
            {
                "id": U(i["id"]), "org_id": U(i["orgId"]), "email": i["email"], "name": i.get("name"), "role": i["role"],
                "workspace_ids": [U(w) for w in i.get("workspaceIds") or []], "status": i["status"], "token_hash": token_hash(i["token"]),
                "expires_at": T(i["expiresAt"]), "invited_by": U(i.get("invitedBy")), "created_at": T(i.get("createdAt")) or now(),
            }
            for i in t.get("invites", [])
        ],
    )  # fmt: skip
    await bulk(db, m.InviteLink, [{"id": U(x["id"]), "org_id": U(x["orgId"]), "token": x["token"], "role_cap": x["roleCap"], "expires_at": T(x["expiresAt"])} for x in t.get("inviteLinks", [])])
    await bulk(db, m.TagGroup, [{"id": U(g["id"]), "org_id": U(g["orgId"]), "name": g["name"]} for g in t.get("tagGroups", [])])
    await bulk(db, m.Tag, [{"id": U(x["id"]), "org_id": U(x["orgId"]), "name": x["name"], "color": x["color"], "group_id": U(x.get("groupId"))} for x in t.get("tags", [])])

    # Assets: the seed points at static files; store their bytes so live URLs serve them.
    assets = t.get("assets", [])
    await bulk(
        db,
        m.Asset,
        [
            {
                "id": U(a["id"]), "org_id": U(a["orgId"]), "mime": a["mime"], "bytes": a["bytes"], "width": a["width"], "height": a["height"],
                "sha256": a["sha256"], "original_filename": a.get("originalFilename"), "blurhash": a.get("blurhash"),
                "dominant_colors": a.get("dominantColors") or [], "processing": a.get("processing") or "ready",
                "metadata": a.get("metadata") or {}, "variants": [{k: v for k, v in x.items() if k != "url"} for x in a.get("variants") or []],
            }
            for a in assets
        ],
    )  # fmt: skip
    for a in assets:
        url = next((v.get("url") for v in a.get("variants") or [] if v.get("url")), "")
        data = files.get(url.rsplit("/", 1)[-1])
        if data:
            await storage.put(db, U(a["orgId"]), U(a["id"]), "original", a["mime"], base64.b64decode(data))

    posts = t.get("posts", [])
    org_of_ws = {w["id"]: w["orgId"] for w in t.get("workspaces", [])}
    await bulk(
        db,
        m.Post,
        [
            {
                "id": U(p["id"]), "org_id": U(p["orgId"]), "workspace_id": U(p["workspaceId"]), "author_id": U(p["authorId"]),
                "title": p.get("title") or "", "summary": p.get("summary"), "work_date": D(p["workDate"]), "work_date_source": p.get("workDateSource") or "user",
                "status": p["status"], "visibility": p.get("visibility") or "visible", "hidden_reason": p.get("hiddenReason"),
                "hidden_by": U(p.get("hiddenBy")), "hidden_at": T(p.get("hiddenAt")), "blocks": p.get("blocks") or [], "reactions": p.get("reactions") or {},
                "source": p.get("source"), "revision": p.get("revision") or 0, "version": p.get("version") or 1,
                "comment_count": (p.get("counts") or {}).get("comments", 0), "reaction_count": (p.get("counts") or {}).get("reactions", 0),
                "image_count": (p.get("counts") or {}).get("images", 0), "created_at": T(p["createdAt"]), "updated_at": T(p["updatedAt"]),
                "published_at": T(p.get("publishedAt")) if p["status"] == "published" else None, "deleted_at": T(p.get("deletedAt")),
            }
            for p in posts
        ],
    )  # fmt: skip
    await bulk(db, m.PostTag, [{"post_id": U(p["id"]), "tag_id": U(tid), "position": i} for p in posts for i, tid in enumerate(dict.fromkeys(p.get("tagIds") or []))])
    await bulk(db, m.PostCoAuthor, [{"post_id": U(p["id"]), "user_id": U(uid), "position": i} for p in posts for i, uid in enumerate(dict.fromkeys(p.get("coAuthorIds") or [])) if uid != p["authorId"]])
    await bulk(db, m.PostRevision, [{"post_id": U(r["postId"]), "revision": r["revision"], "edited_by": U(r["editedBy"]), "edited_at": T(r["editedAt"]), "title": r["title"], "blocks": r["blocks"]} for r in t.get("revisions", [])])
    org_of_asset = {a["id"]: a["orgId"] for a in assets}
    await bulk(
        db,
        m.ImageInstance,
        [
            {
                "id": U(i["id"]), "org_id": U(org_of_asset.get(i["assetId"])), "asset_id": U(i["assetId"]), "post_id": U(i.get("postId")), "comment_id": U(i.get("commentId")),
                "caption": i.get("caption"), "alt_text": i.get("altText"), "figure_label": i.get("figureLabel"), "tags": i.get("tags") or [],
                "custom_fields": i.get("customFields") or {}, "annotation": i.get("annotation"),
            }
            for i in t.get("images", []) if i["assetId"] in org_of_asset
        ],
    )  # fmt: skip
    # Parents before replies (foreign key), whatever their timestamps say.
    by_id = {c["id"]: c for c in t.get("comments", [])}
    comments, placed = [], set()

    def place(c: dict) -> None:
        if c["id"] in placed:
            return
        parent = by_id.get(c.get("parentId") or "")
        if parent:
            place(parent)
        placed.add(c["id"])
        comments.append(c)

    for c in sorted(by_id.values(), key=lambda c: c["createdAt"]):
        place(c)
    await bulk(
        db,
        m.CommentRow,
        [
            {
                "id": U(c["id"]), "org_id": U(org_of_ws.get(c["workspaceId"])), "workspace_id": U(c["workspaceId"]), "post_id": U(c["postId"]),
                "parent_id": U(c.get("parentId")), "author_id": U(c["authorId"]), "doc": c.get("doc"),
                "image_instance_ids": [U(x) for x in c.get("imageInstanceIds") or []], "anchor": c.get("anchor"),
                "is_question": bool(c.get("isQuestion")), "resolved": bool(c.get("resolved")), "accepted_answer_id": U(c.get("acceptedAnswerId")),
                "hidden": bool(c.get("hidden")), "reactions": c.get("reactions") or {}, "version": c.get("version") or 1,
                "created_at": T(c["createdAt"]), "edited_at": T(c.get("editedAt")), "deleted_at": T(c.get("deletedAt")),
            }
            for c in comments
        ],
    )  # fmt: skip
    await bulk(
        db,
        m.NotificationRow,
        [
            {
                "id": U(n["id"]), "user_id": U(n["userId"]), "org_id": U(org_of_ws.get(n["workspaceId"])), "workspace_id": U(n["workspaceId"]), "kind": n["kind"],
                "post_id": U(n["postId"]), "comment_id": U(n["commentId"]), "actor_id": U(n["actorId"]), "created_at": T(n["createdAt"]), "read_at": T(n.get("readAt")),
            }
            for n in t.get("notifications", [])
        ],
    )  # fmt: skip
    await bulk(
        db,
        m.SavedView,
        [
            {"id": U(v["id"]), "org_id": U(org_of_ws.get(v["workspaceId"])), "workspace_id": U(v["workspaceId"]), "owner_id": U(v["ownerId"]), "name": v["name"], "filter_spec": v.get("filterSpec") or {}, "shared": bool(v.get("shared")), "updated_at": T(v.get("updatedAt")) or now()}
            for v in t.get("savedViews", [])
        ],
    )
    colls = t.get("collections", [])
    await bulk(
        db,
        m.CollectionRow,
        [
            {"id": U(c["id"]), "org_id": U(org_of_ws.get(c["workspaceId"])), "workspace_id": U(c["workspaceId"]), "name": c["name"], "kind": c.get("kind") or "manual", "created_by": U(c["createdBy"]), "source_tag_id": U(c.get("sourceTagId")), "updated_at": T(c.get("updatedAt")) or now()}
            for c in colls
        ],
    )
    await bulk(db, m.CollectionPost, [{"collection_id": U(c["id"]), "post_id": U(pid), "position": i} for c in colls for i, pid in enumerate(dict.fromkeys(c.get("postIds") or []))])
    pins = []
    for key, value in meta.items():
        if key.startswith("pins:"):
            _, uid, wsid = key.split(":")
            pins += [{"user_id": U(uid), "workspace_id": U(wsid), "kind": p["kind"], "item_id": U(p["id"]), "position": i} for i, p in enumerate(value or [])]
        elif key.split(":")[0] in ("verify", "magic", "reset") and value:
            db.add(m.AuthToken(token_hash=token_hash(key.split(":", 1)[1]), kind=key.split(":")[0], user_id=U(value), expires_at=now() + dt.timedelta(days=7)))
    await bulk(db, m.Pin, pins)
    await bulk(db, m.Email, [{"id": U(e["id"]), "to": e["to"], "subject": e["subject"], "body": e["body"], "link": e.get("link"), "sent_at": T(e["sentAt"])} for e in t.get("emails", [])])
    await db.commit()

    # Search: drop this environment's documents and rebuild from Postgres.
    await ensure_index()
    await es().delete_by_query(index=alias(), query={"match_all": {}}, refresh=True, conflicts="proceed")
    indexed = await reindex_all()

    out: dict[str, Any] = {"indexed": indexed}
    who = U(body.get("signInAs"))
    if who and await db.get(m.User, who):
        await start_session(db, request, response, who)
        await db.commit()
        out["me"] = await me_response(db, await db.get(m.User, who))
    return out
