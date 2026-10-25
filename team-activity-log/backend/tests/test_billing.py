"""Free trial and Stripe billing: trials give Team then fall back to Free; webhooks are signed and
set the plan; checkout and portal are refused when billing isn't configured."""

import datetime as dt
import hashlib
import hmac
import json
import time

import pytest
from sqlalchemy import update

from test_plans_and_avatars import signup  # noqa: I001 (sibling test module)

SECRET = "whsec_test"


def ids(me: dict) -> tuple[str, str]:
    return me["orgs"][0]["org"]["id"], me["orgs"][0]["workspaces"][0]["id"]


@pytest.fixture
def stripe_on():
    from tal import config

    s = config.get_settings()
    saved = (s.stripe_secret_key, s.stripe_webhook_secret, s.stripe_price_team_month, s.stripe_price_business_year)
    s.stripe_secret_key, s.stripe_webhook_secret, s.stripe_price_team_month, s.stripe_price_business_year = "sk_test_x", SECRET, "price_team_m", "price_biz_y"
    yield s
    s.stripe_secret_key, s.stripe_webhook_secret, s.stripe_price_team_month, s.stripe_price_business_year = saved


def signed(event: dict, secret: str = SECRET, at: int | None = None) -> tuple[bytes, dict]:
    body = json.dumps(event).encode()
    t = str(at or int(time.time()))
    sig = hmac.new(secret.encode(), f"{t}.".encode() + body, hashlib.sha256).hexdigest()
    return body, {"stripe-signature": f"t={t},v1={sig}", "content-type": "application/json"}


async def test_new_orgs_get_a_team_trial_then_fall_back_to_free(client):
    from tal import config
    from tal import models as m
    from tal.db import sessionmaker

    config.get_settings().trial_days = 14
    try:
        org, ws = ids(await signup(client, "ada@example.test"))
    finally:
        config.get_settings().trial_days = 0
    p = (await client.get(f"/v1/orgs/{org}/plan")).json()
    assert p["plan"] == "team" and p["paidPlan"] == "free" and p["trial"]["active"] and p["trial"]["daysLeft"] == 14
    assert (await client.post(f"/v1/orgs/{org}/workspaces", json={"name": "Second", "allOrgMembers": True})).status_code == 201  # Team: more workspaces
    async with sessionmaker()() as s:
        await s.execute(update(m.Organization).values(trial_ends_at=dt.datetime.now(dt.UTC) - dt.timedelta(minutes=1)))
        await s.commit()
    p = (await client.get(f"/v1/orgs/{org}/plan")).json()
    assert p["plan"] == "free" and not p["trial"]["active"]
    r = await client.post(f"/v1/orgs/{org}/workspaces", json={"name": "Third", "allOrgMembers": True})
    assert r.status_code == 403 and r.json()["details"]["limit"] == "workspaces"  # nothing removed; just no more


async def test_billing_is_off_without_stripe_keys(client):
    org, _ = ids(await signup(client, "ada@example.test"))
    assert (await client.get(f"/v1/orgs/{org}/plan")).json()["billing"]["enabled"] is False
    r = await client.post(f"/v1/orgs/{org}/billing/checkout", json={"plan": "team", "interval": "month"})
    assert r.status_code == 409 and r.json()["code"] == "billing_off"


async def test_checkout_goes_to_stripe_with_seats(client, stripe_on, monkeypatch):
    from tal import billing

    calls = []

    async def fake(method, path, data=None):
        calls.append((method, path, data))
        return {"url": "https://checkout.stripe.test/s"}

    monkeypatch.setattr(billing, "stripe", fake)
    org, _ = ids(await signup(client, "ada@example.test"))
    r = await client.post(f"/v1/orgs/{org}/billing/checkout", json={"plan": "team", "interval": "month"})
    assert r.status_code == 200 and r.json()["url"] == "https://checkout.stripe.test/s"
    _, path, data = calls[0]
    assert path == "/checkout/sessions" and data["line_items"] == [{"price": "price_team_m", "quantity": 1}] and data["metadata"] == {"org_id": org}
    r = await client.post(f"/v1/orgs/{org}/billing/checkout", json={"plan": "business", "interval": "month"})  # not configured
    assert r.status_code == 502


async def test_webhooks_are_signed_and_set_the_plan(client, stripe_on):
    org, _ = ids(await signup(client, "ada@example.test"))
    sub = {"id": "sub_1", "customer": "cus_1", "status": "active", "metadata": {"org_id": org}, "items": {"data": [{"id": "si_1", "price": {"id": "price_biz_y"}}]}}
    body, headers = signed({"type": "customer.subscription.created", "data": {"object": sub}}, secret="whsec_wrong")
    assert (await client.post("/v1/billing/webhook", content=body, headers=headers)).status_code == 400  # forged
    body, headers = signed({"type": "customer.subscription.created", "data": {"object": sub}}, at=int(time.time()) - 3600)
    assert (await client.post("/v1/billing/webhook", content=body, headers=headers)).status_code == 400  # replayed
    body, headers = signed({"type": "customer.subscription.created", "data": {"object": sub}})
    assert (await client.post("/v1/billing/webhook", content=body, headers=headers)).status_code == 200
    p = (await client.get(f"/v1/orgs/{org}/plan")).json()
    assert p["plan"] == "business" and p["billing"]["subscribed"] and p["billing"]["canManage"]
    body, headers = signed({"type": "customer.subscription.deleted", "data": {"object": {**sub, "status": "canceled", "metadata": {}}}})  # found by customer id
    assert (await client.post("/v1/billing/webhook", content=body, headers=headers)).status_code == 200
    p = (await client.get(f"/v1/orgs/{org}/plan")).json()
    assert p["plan"] == "free" and p["billing"]["status"] == "canceled" and not p["billing"]["subscribed"]


def test_stripe_form_encoding():
    from tal.billing import _form

    assert _form({"a": {"b": 1}, "l": [{"x": 2}], "t": True, "n": None}) == [("a[b]", "1"), ("l[0][x]", "2"), ("t", "true")]
