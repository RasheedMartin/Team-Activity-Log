"""Super admin (owner request): for the people running the service. See every organization, delete
one with all its data, and (only when ALLOW_WIPE is on) delete everything.

Guarded three ways: the account's verified email must be in SUPERADMIN_EMAILS; every deletion needs
a typed confirmation; wiping everything also needs the ALLOW_WIPE server switch. All of it is logged.
"""

from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, Body, Depends
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models as m
from .. import storage
from ..config import get_settings
from ..context import require_user
from ..db import get_db
from ..errors import fail
from ..timeutil import iso
from .auth import is_superadmin

router = APIRouter()
log = logging.getLogger("tal.superadmin")
WIPE_PHRASE = "DELETE EVERYTHING"


async def require_superadmin(u: m.User = Depends(require_user)) -> m.User:
    if not is_superadmin(u):
        fail(404, "not_found", "Not found")  # don't reveal that the page exists
    return u


def _org_prefixes(org_id: uuid.UUID) -> list[str]:
    p = get_settings().s3_prefix
    return [f"{p}/org/{org_id}/", f"{p}/originals/{org_id}/", f"{p}/attachments/{org_id}/"]


@router.get("/super/overview")
async def overview(u: m.User = Depends(require_superadmin), db: AsyncSession = Depends(get_db, scope="function")):
    members = dict((await db.execute(select(m.Membership.org_id, func.count()).where(m.Membership.status == "active").group_by(m.Membership.org_id))).all())
    posts = dict((await db.execute(select(m.Post.org_id, func.count()).where(m.Post.deleted_at.is_(None)).group_by(m.Post.org_id))).all())
    storage_bytes = dict((await db.execute(select(m.Asset.org_id, func.sum(m.Asset.bytes)).group_by(m.Asset.org_id))).all())
    orgs = (await db.execute(select(m.Organization).order_by(m.Organization.created_at.desc()))).scalars().all()
    return {
        "totals": {"users": await db.scalar(select(func.count()).select_from(m.User)), "orgs": len(orgs), "posts": sum(posts.values()), "storageBytes": int(sum(storage_bytes.values()) or 0)},
        "orgs": [
            {"id": str(o.id), "name": o.name, "slug": o.slug, "plan": o.plan, "createdAt": iso(o.created_at), "members": members.get(o.id, 0), "posts": posts.get(o.id, 0), "storageBytes": int(storage_bytes.get(o.id) or 0)}
            for o in orgs
        ],
        "wipeAllowed": get_settings().allow_wipe,
    }


@router.delete("/super/orgs/{org_id}")
async def delete_org(org_id: str, body: dict = Body(...), u: m.User = Depends(require_superadmin), db: AsyncSession = Depends(get_db, scope="function")):
    """Delete an organization and everything in it (posts, files, members' access). Type its slug."""
    org = await db.get(m.Organization, uuid.UUID(org_id)) if _uuid(org_id) else None
    if not org:
        fail(404, "not_found", "Organization not found")
    if (body.get("confirm") or "") != org.slug:
        fail(422, "confirm", f"Type the organization's URL name ({org.slug}) to confirm")
    files = 0
    for prefix in _org_prefixes(org.id):
        files += await storage.delete_prefix(db, prefix)
    await db.delete(org)  # rows cascade from the organization
    await _drop_search(org_id=str(org.id))
    log.warning("SUPERADMIN %s deleted org %s (%s) and %d stored files", u.email, org.slug, org.id, files)
    return {"deleted": org.slug, "files": files}


@router.post("/super/wipe")
async def wipe(body: dict = Body(...), u: m.User = Depends(require_superadmin), db: AsyncSession = Depends(get_db, scope="function")):
    """Delete ALL data: every account, organization, post, and file. Needs ALLOW_WIPE and the phrase."""
    if not get_settings().allow_wipe:
        fail(403, "wipe_disabled", "Deleting everything is switched off on this server (set ALLOW_WIPE=true to enable it)")
    if (body.get("confirm") or "") != WIPE_PHRASE:
        fail(422, "confirm", f"Type {WIPE_PHRASE} to confirm")
    tables = [t.name for t in m.Base.metadata.sorted_tables]
    files = await storage.delete_prefix(db, f"{get_settings().s3_prefix}/")
    await db.execute(text("TRUNCATE " + ", ".join(f'"{t}"' for t in tables) + " CASCADE"))
    await _drop_search()
    log.warning("SUPERADMIN %s WIPED ALL DATA (%d tables, %d stored files)", u.email, len(tables), files)
    return {"wiped": True, "files": files}


def _uuid(s: str) -> bool:
    try:
        uuid.UUID(s)
        return True
    except ValueError:
        return False


async def _drop_search(org_id: str | None = None) -> None:
    """Remove search documents (best effort; the index rebuilds from Postgres anyway)."""
    try:
        from ..search.client import es
        from ..search.indexer import alias

        query = {"term": {"org_id": org_id}} if org_id else {"match_all": {}}
        await es().delete_by_query(index=alias(), query=query, conflicts="proceed", refresh=True)
    except Exception:  # noqa: BLE001
        log.warning("couldn't clear search documents%s", f" for org {org_id}" if org_id else "", exc_info=True)
