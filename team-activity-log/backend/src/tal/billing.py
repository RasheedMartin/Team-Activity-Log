"""Stripe billing (docs/PRICING.md), over Stripe's HTTPS API with httpx (no SDK).

- Checkout: an admin picks Team or Business, monthly or yearly; Stripe Checkout takes the card.
  Seats = active members.
- Portal: Stripe's billing portal for cards, invoices, plan changes, and cancelling.
- Webhook: Stripe tells us what happened (signed; verified here). Subscription state sets the
  org's plan: active/trialing → the plan of its price; past_due keeps the plan and flags it;
  canceled/unpaid → Free. Never deletes anything (limits only block adding more).
- Seats follow membership: after a member joins or leaves, the subscription quantity is updated.

Everything is off until STRIPE_* settings are present; the plan card then says so.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import time
import uuid
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from . import models as m
from . import plans
from .config import get_settings

log = logging.getLogger("tal.billing")
API = "https://api.stripe.com/v1"
TOLERANCE = 300  # seconds a webhook signature stays valid


class BillingError(Exception):
    pass


def _form(data: dict[str, Any], prefix: str = "") -> list[tuple[str, str]]:
    """Stripe's form encoding: {"a": {"b": 1}, "l": [{"x": 2}]} -> a[b]=1, l[0][x]=2."""
    out: list[tuple[str, str]] = []
    for k, v in data.items():
        key = f"{prefix}[{k}]" if prefix else str(k)
        if isinstance(v, dict):
            out += _form(v, key)
        elif isinstance(v, list):
            for i, item in enumerate(v):
                out += _form(item, f"{key}[{i}]") if isinstance(item, dict) else [(f"{key}[{i}]", str(item))]
        elif isinstance(v, bool):
            out.append((key, "true" if v else "false"))
        elif v is not None:
            out.append((key, str(v)))
    return out


async def stripe(method: str, path: str, data: dict[str, Any] | None = None) -> dict:
    s = get_settings()
    if not s.stripe_secret_key:
        raise BillingError("Billing isn't set up on this server")
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.request(method, f"{API}{path}", data=_form(data or {}) or None, auth=(s.stripe_secret_key, ""))
    body = r.json() if r.content else {}
    if r.status_code >= 400:
        raise BillingError((body.get("error") or {}).get("message") or f"Stripe error {r.status_code}")
    return body


def plan_for_price(price_id: str | None) -> str | None:
    return next((plan for (plan, _), pid in get_settings().stripe_prices().items() if pid == price_id), None)


async def checkout_url(db: AsyncSession, org: m.Organization, user: m.User, plan: str, interval: str, app_url: str) -> str:
    price = get_settings().stripe_prices().get((plan, interval))
    if not price:
        raise BillingError("That plan isn't available")
    seats = max(1, await plans.active_members(db, org.id))
    back = f"{app_url}/o/{org.slug}/admin/settings"
    session = await stripe(
        "POST",
        "/checkout/sessions",
        {
            "mode": "subscription",
            "line_items": [{"price": price, "quantity": seats}],
            "success_url": f"{back}?billing=success",
            "cancel_url": f"{back}?billing=cancelled",
            "client_reference_id": str(org.id),
            **({"customer": org.billing_customer_id} if org.billing_customer_id else {"customer_email": user.email}),
            "metadata": {"org_id": str(org.id)},
            "subscription_data": {"metadata": {"org_id": str(org.id)}},
            "allow_promotion_codes": True,
        },
    )
    return session["url"]


async def portal_url(org: m.Organization, app_url: str) -> str:
    if not org.billing_customer_id:
        raise BillingError("There's no billing account yet: upgrade first")
    session = await stripe("POST", "/billing_portal/sessions", {"customer": org.billing_customer_id, "return_url": f"{app_url}/o/{org.slug}/admin/settings"})
    return session["url"]


def verify(payload: bytes, header: str | None) -> bool:
    """Stripe-Signature: t=<unix>,v1=<hex hmac-sha256 of "t.payload">[,v1=…]."""
    secret = get_settings().stripe_webhook_secret
    if not secret or not header:
        return False
    parts = [p.split("=", 1) for p in header.split(",") if "=" in p]
    ts = next((v for k, v in parts if k == "t"), "")
    sigs = [v for k, v in parts if k == "v1"]
    if not ts.isdigit() or abs(time.time() - int(ts)) > TOLERANCE:
        return False
    expected = hmac.new(secret.encode(), f"{ts}.".encode() + payload, hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(expected, s) for s in sigs)


async def _org_for(db: AsyncSession, obj: dict) -> m.Organization | None:
    oid = (obj.get("metadata") or {}).get("org_id") or obj.get("client_reference_id")
    try:
        if oid and (org := await db.get(m.Organization, uuid.UUID(oid))):
            return org
    except ValueError:
        pass
    if obj.get("customer"):
        return (await db.execute(select(m.Organization).where(m.Organization.billing_customer_id == obj["customer"]))).scalar_one_or_none()
    return None


async def handle_event(db: AsyncSession, event: dict) -> None:
    """Apply a verified Stripe event. Every handler sets state, so redelivery is harmless."""
    kind = event.get("type", "")
    obj = (event.get("data") or {}).get("object") or {}
    org = await _org_for(db, obj)
    if not org:
        log.info("stripe event %s for an unknown org; ignored", kind)
        return
    if kind == "checkout.session.completed":
        org.billing_customer_id = obj.get("customer") or org.billing_customer_id
        org.billing_subscription_id = obj.get("subscription") or org.billing_subscription_id
    elif kind.startswith("customer.subscription."):
        status = obj.get("status")
        items = ((obj.get("items") or {}).get("data")) or [{}]
        plan = plan_for_price(((items[0] or {}).get("price") or {}).get("id"))
        org.billing_customer_id = obj.get("customer") or org.billing_customer_id
        if kind == "customer.subscription.deleted" or status in ("canceled", "unpaid", "incomplete_expired"):
            org.plan, org.billing_status, org.billing_subscription_id = "free", "canceled", None
        else:
            org.billing_subscription_id = obj.get("id") or org.billing_subscription_id
            if plan and status in ("active", "trialing", "past_due"):
                org.plan = plan
            org.billing_status = {"active": "active", "trialing": "trialing", "past_due": "past_due"}.get(status or "", org.billing_status)


async def sync_seats(org_id: uuid.UUID) -> None:
    """Make the subscription's quantity match active members (after joins and removals)."""
    from .db import sessionmaker

    if not get_settings().billing_enabled:
        return
    async with sessionmaker()() as db:
        org = await db.get(m.Organization, org_id)
        if not org or not org.billing_subscription_id:
            return
        seats = max(1, await plans.active_members(db, org.id))
    sub = await stripe("GET", f"/subscriptions/{org.billing_subscription_id}")
    item = ((sub.get("items") or {}).get("data") or [{}])[0]
    if item.get("id") and item.get("quantity") != seats:
        await stripe("POST", f"/subscriptions/{org.billing_subscription_id}", {"items": [{"id": item["id"], "quantity": seats}], "proration_behavior": "create_prorations"})


def after_commit_sync_seats(db: AsyncSession, org_id: uuid.UUID) -> None:
    """Queue a seat sync for once this request's changes are saved (see db.get_db)."""
    if get_settings().billing_enabled:
        db.info.setdefault("after_commit", []).append(lambda: sync_seats(org_id))
