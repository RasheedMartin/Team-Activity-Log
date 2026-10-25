"""Billing routes: upgrade (Stripe Checkout), manage (billing portal), and Stripe's webhook."""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Body, Depends, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from .. import billing
from .. import models as m
from ..config import get_settings
from ..context import org_ctx, require_user
from ..db import get_db
from ..errors import fail

router = APIRouter()
log = logging.getLogger("tal.billing")


def _app_url(request: Request) -> str:
    return (get_settings().public_app_url or str(request.base_url)).rstrip("/")


@router.post("/orgs/{org}/billing/checkout")
async def checkout(org: str, request: Request, body: dict = Body(...), u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await org_ctx(db, u, org, "admin")
    if not get_settings().billing_enabled:
        fail(409, "billing_off", "Billing isn't set up on this server yet")
    plan, interval = body.get("plan"), body.get("interval")
    if plan not in ("team", "business") or interval not in ("month", "year"):
        fail(422, "invalid", "Choose Team or Business, monthly or yearly")
    if ctx.org.billing_subscription_id:
        fail(409, "already_subscribed", "This organization already has a subscription: use Manage billing to change it")
    try:
        return {"url": await billing.checkout_url(db, ctx.org, u, plan, interval, _app_url(request))}
    except billing.BillingError as e:
        fail(502, "billing_error", str(e))


@router.post("/orgs/{org}/billing/portal")
async def portal(org: str, request: Request, u: m.User = Depends(require_user), db: AsyncSession = Depends(get_db, scope="function")):
    ctx = await org_ctx(db, u, org, "admin")
    if not get_settings().billing_enabled:
        fail(409, "billing_off", "Billing isn't set up on this server yet")
    try:
        return {"url": await billing.portal_url(ctx.org, _app_url(request))}
    except billing.BillingError as e:
        fail(409, "billing_error", str(e))


@router.post("/billing/webhook")
async def webhook(request: Request, db: AsyncSession = Depends(get_db, scope="function")):
    """Stripe → us. Unsigned or stale calls are refused; known events update the org's plan."""
    payload = await request.body()
    if not billing.verify(payload, request.headers.get("stripe-signature")):
        fail(400, "bad_signature", "Signature check failed")
    try:
        event = json.loads(payload)
    except ValueError:
        fail(400, "bad_payload", "Not JSON")
    await billing.handle_event(db, event)
    return Response(status_code=200)
