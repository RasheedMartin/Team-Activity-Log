"""Plans and their limits (docs/PRICING.md). Limits are code, not rows: changing a plan is a
deploy, not a migration. `None` means unlimited. The landing page shows the same numbers from
frontend/src/app/pricing.ts; change both together.

Enforcement happens where usage grows (invites, joining, workspaces, storing images, imports),
never by deleting or hiding anything: an org over a limit can still read and write text.
"""

from __future__ import annotations

import datetime as dt
import uuid
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from . import models as m
from .errors import fail
from .timeutil import now

GB = 1024**3


@dataclass(frozen=True)
class Plan:
    name: str
    members: int | None
    workspaces: int | None
    private_workspaces: bool
    storage_bytes: int | None  # pooled per org
    storage_bytes_per_member: int | None  # pooled, grows with members (paid plans)
    imports_per_month: int | None


PLANS: dict[str, Plan] = {
    "free": Plan("Free", members=10, workspaces=1, private_workspaces=False, storage_bytes=2 * GB, storage_bytes_per_member=None, imports_per_month=5),
    "team": Plan("Team", members=None, workspaces=None, private_workspaces=True, storage_bytes=None, storage_bytes_per_member=10 * GB, imports_per_month=None),
    "business": Plan("Business", members=None, workspaces=None, private_workspaces=True, storage_bytes=None, storage_bytes_per_member=25 * GB, imports_per_month=None),
    "enterprise": Plan("Enterprise", members=None, workspaces=None, private_workspaces=True, storage_bytes=None, storage_bytes_per_member=None, imports_per_month=None),
}


def in_trial(org: m.Organization) -> bool:
    """A Free org inside its Team trial (new orgs get one; no card needed)."""
    return org.plan == "free" and org.trial_ends_at is not None and org.trial_ends_at > now()


def plan_id(org: m.Organization) -> str:
    """The plan in effect: what they pay for, or Team while a trial runs."""
    return "team" if in_trial(org) else org.plan if org.plan in PLANS else "free"


def plan_of(org: m.Organization) -> Plan:
    return PLANS[plan_id(org)]


def _limit(code: str, message: str, used: int, limit: int, plan: Plan) -> None:
    fail(403, "plan_limit", f"{message} An admin can upgrade in Organization admin → Organization.", {"limit": code, "used": used, "max": limit, "plan": plan.name})


# ---------------------------------------------------------------- usage


async def active_members(db: AsyncSession, org_id: uuid.UUID) -> int:
    return await db.scalar(select(func.count()).select_from(m.Membership).where(m.Membership.org_id == org_id, m.Membership.status == "active")) or 0


async def pending_invites(db: AsyncSession, org_id: uuid.UUID) -> int:
    return await db.scalar(select(func.count()).select_from(m.Invite).where(m.Invite.org_id == org_id, m.Invite.status == "pending", m.Invite.expires_at > now())) or 0


async def open_workspaces(db: AsyncSession, org_id: uuid.UUID) -> int:
    return await db.scalar(select(func.count()).select_from(m.Workspace).where(m.Workspace.org_id == org_id, m.Workspace.archived.is_(False))) or 0


async def storage_used(db: AsyncSession, org_id: uuid.UUID) -> int:
    """Original image bytes, each stored once per org (duplicates are free)."""
    return int(await db.scalar(select(func.coalesce(func.sum(m.Asset.bytes), 0)).where(m.Asset.org_id == org_id)) or 0)


async def imports_this_month(db: AsyncSession, org_id: uuid.UUID) -> int:
    """Imports committed this month. Abandoned uploads/reviews and deleted imports don't count."""
    start = now().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return await db.scalar(select(func.count()).select_from(m.ImportJobRow).where(m.ImportJobRow.org_id == org_id, m.ImportJobRow.created_at >= start, m.ImportJobRow.status == "done")) or 0


async def storage_limit(db: AsyncSession, org: m.Organization) -> int | None:
    p = plan_of(org)
    if org.storage_quota_bytes is not None:
        return org.storage_quota_bytes  # a negotiated override
    if p.storage_bytes_per_member is not None:
        return p.storage_bytes_per_member * max(1, await active_members(db, org.id))
    return p.storage_bytes


# ---------------------------------------------------------------- checks


async def check_can_add_members(db: AsyncSession, org: m.Organization, adding: int = 1) -> None:
    p = plan_of(org)
    if p.members is None:
        return
    used = await active_members(db, org.id) + await pending_invites(db, org.id)
    if used + adding > p.members:
        _limit("members", f"The {p.name} plan includes up to {p.members} members (including pending invites). Upgrade to add more.", used, p.members, p)


async def check_can_join(db: AsyncSession, org: m.Organization) -> None:
    """Accepting an invite: its seat was already counted as pending, so only active members count."""
    p = plan_of(org)
    if p.members is not None and await active_members(db, org.id) >= p.members:
        _limit("members", f"{org.name} is full on the {p.name} plan ({p.members} members). Ask an admin to upgrade.", p.members, p.members, p)


def check_private_allowed(org: m.Organization) -> None:
    p = plan_of(org)
    if not p.private_workspaces:
        _limit("private_workspaces", f"Private workspaces aren't included in the {p.name} plan. Upgrade to Team to use them.", 0, 0, p)


async def check_can_open_workspace(db: AsyncSession, org: m.Organization, *, private: bool) -> None:
    p = plan_of(org)
    if private:
        check_private_allowed(org)
    if p.workspaces is not None:
        used = await open_workspaces(db, org.id)
        if used >= p.workspaces:
            _limit("workspaces", f"The {p.name} plan includes {p.workspaces} workspace. Upgrade for more, or archive one first.", used, p.workspaces, p)


async def check_storage(db: AsyncSession, org: m.Organization, adding: int) -> None:
    limit = await storage_limit(db, org)
    if limit is None:
        return
    used = await storage_used(db, org.id)
    if used + adding > limit:
        gb = lambda b: f"{b / GB:.1f} GB"  # noqa: E731
        _limit("storage", f"Your organization has used {gb(used)} of {gb(limit)} for images. Upgrade, or remove images you no longer need.", used, limit, plan_of(org))


async def check_can_import(db: AsyncSession, org: m.Organization) -> None:
    p = plan_of(org)
    if p.imports_per_month is None:
        return
    used = await imports_this_month(db, org.id)
    if used >= p.imports_per_month:
        _limit("imports", f"The {p.name} plan includes {p.imports_per_month} slide imports a month. Upgrade for unlimited imports.", used, p.imports_per_month, p)


async def plan_view(db: AsyncSession, org: m.Organization) -> dict:
    from .config import get_settings

    p = plan_of(org)
    s = get_settings()
    trial = None
    if org.trial_ends_at and org.plan == "free":
        left = (org.trial_ends_at - now()).total_seconds()
        trial = {"endsAt": org.trial_ends_at.isoformat().replace("+00:00", "Z"), "daysLeft": max(0, int(-(-left // 86400))), "active": left > 0}
    return {
        "plan": plan_id(org),
        "paidPlan": org.plan,
        "name": p.name,
        "trial": trial,
        "billing": {
            "enabled": s.billing_enabled,
            "status": org.billing_status,
            "subscribed": bool(org.billing_subscription_id),
            "canManage": s.billing_enabled and bool(org.billing_customer_id),
            "options": sorted(f"{k[0]}:{k[1]}" for k in s.stripe_prices()),
        },
        "limits": {
            "members": p.members,
            "workspaces": p.workspaces,
            "privateWorkspaces": p.private_workspaces,
            "storageBytes": await storage_limit(db, org),
            "importsPerMonth": p.imports_per_month,
        },
        "usage": {
            "members": await active_members(db, org.id),
            "pendingInvites": await pending_invites(db, org.id),
            "workspaces": await open_workspaces(db, org.id),
            "storageBytes": await storage_used(db, org.id),
            "importsThisMonth": await imports_this_month(db, org.id),
        },
    }


__all__ = ["PLANS", "Plan", "in_trial", "plan_id", "plan_of", "dt"]
