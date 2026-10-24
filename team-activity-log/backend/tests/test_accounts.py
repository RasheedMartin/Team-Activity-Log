"""Google sign-in and email delivery, against a real Postgres (the local dev server) with fake
Google and Resend endpoints. Skipped when that Postgres isn't running."""

from __future__ import annotations

import asyncio
import base64
import json
import os
import time
from urllib.parse import parse_qs, urlparse

import asyncpg
import httpx
import pytest
from sqlalchemy import func, select, text

ADMIN = "postgresql://postgres@localhost:5433/postgres"
DB = "tal_test"
CLIENT_ID = "test-client.apps.googleusercontent.com"


async def _pg_up() -> bool:
    try:
        c = await asyncpg.connect(ADMIN, timeout=2)
    except Exception:  # noqa: BLE001
        return False
    if not await c.fetchval("select 1 from pg_database where datname = $1", DB):
        await c.execute(f"create database {DB} owner tal")
    await c.close()
    return True


@pytest.fixture(scope="module")
async def app():
    if not await _pg_up():
        pytest.skip("local Postgres on :5433 isn't running (see backend/README.md)")
    os.environ.update(
        DATABASE_URL=f"postgresql://tal:tal@localhost:5433/{DB}",
        GOOGLE_CLIENT_ID=CLIENT_ID,
        GOOGLE_CLIENT_SECRET="test-secret",
        PUBLIC_APP_URL="https://app.example.test",
        EMAIL_PROVIDER="resend",
        EMAIL_API_KEY="re_test",
        EMAIL_FROM="Team Activity Log <noreply@example.test>",
        TAL_ENV_FILE="/nonexistent",
    )
    from tal import config, db

    config.get_settings.cache_clear()
    await db.dispose()
    from alembic import command

    from tal.cli import _alembic_cfg

    await asyncio.to_thread(command.upgrade, _alembic_cfg(), "head")  # alembic runs its own event loop
    from tal.main import create_app

    yield create_app()
    await db.dispose()


@pytest.fixture
async def client(app):
    from tal.db import sessionmaker

    async with sessionmaker()() as s:
        await s.execute(text("truncate identities, emails, sessions, auth_tokens, users cascade"))
        await s.commit()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://app.example.test") as c:
        yield c


def id_token(**claims) -> str:
    base = {"iss": "https://accounts.google.com", "aud": CLIENT_ID, "exp": int(time.time()) + 300, "sub": "g-123", "email": "ada@example.test", "email_verified": True, "name": "Ada Lovelace"}
    enc = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()  # noqa: E731
    return f"{enc({'alg': 'RS256'})}.{enc({**base, **claims})}.sig"


def fake_google(token: str, seen: list | None = None) -> httpx.MockTransport:
    def handle(req: httpx.Request) -> httpx.Response:
        assert req.url == "https://oauth2.googleapis.com/token"
        form = parse_qs(req.content.decode())
        if seen is not None:
            seen.append(form)
        return httpx.Response(200, json={"id_token": token, "access_token": "x"})

    return httpx.MockTransport(handle)


async def sign_in_with_google(client: httpx.AsyncClient, token: str, next_: str = "/o/x", seen: list | None = None) -> httpx.Response:
    from tal.routes import oauth

    oauth._transport = fake_google(token, seen)
    start = await client.get("/v1/auth/google/start", params={"next": next_})
    assert start.status_code == 303
    q = parse_qs(urlparse(start.headers["location"]).query)
    return await client.get("/v1/auth/google/callback", params={"code": "c0de", "state": q["state"][0]})


# ---------------------------------------------------------------- Google


async def test_start_redirects_to_google_with_pkce(client):
    r = await client.get("/v1/auth/google/start", params={"next": "/o/acme"})
    assert r.status_code == 303
    url = urlparse(r.headers["location"])
    q = parse_qs(url.query)
    assert url.netloc == "accounts.google.com"
    assert q["client_id"] == [CLIENT_ID] and q["redirect_uri"] == ["https://app.example.test/v1/auth/google/callback"]
    assert q["code_challenge_method"] == ["S256"] and q["state"][0]
    assert "tal_oauth" in r.cookies


async def test_new_user_signs_in_and_lands_where_they_were_going(client):
    seen: list = []
    r = await sign_in_with_google(client, id_token(), "/o/acme/w/general", seen)
    assert r.status_code == 303 and r.headers["location"] == "/o/acme/w/general"
    assert seen[0]["code_verifier"][0] and seen[0]["client_secret"] == ["test-secret"]
    me = await client.get("/v1/me")
    assert me.status_code == 200 and me.json()["user"]["email"] == "ada@example.test" and me.json()["orgs"] == []


async def test_existing_password_account_is_linked_not_duplicated(client):
    from tal import models as m
    from tal.db import sessionmaker

    await client.post("/v1/auth/register", json={"name": "Ada", "email": "Ada@Example.test", "password": "correct-horse"})
    client.cookies.clear()
    r = await sign_in_with_google(client, id_token())
    assert r.status_code == 303
    async with sessionmaker()() as s:
        assert await s.scalar(select(func.count()).select_from(m.User)) == 1
        assert await s.scalar(select(func.count()).select_from(m.Identity)) == 1
    # A second Google sign-in finds the same account through the identity.
    client.cookies.clear()
    await sign_in_with_google(client, id_token(email="renamed@example.test"))
    assert (await client.get("/v1/me")).json()["user"]["email"] == "Ada@Example.test"


async def test_rejects_forged_state_wrong_audience_unverified_email_and_open_redirects(client):
    from tal.routes import oauth

    oauth._transport = fake_google(id_token())
    await client.get("/v1/auth/google/start")
    bad_state = await client.get("/v1/auth/google/callback", params={"code": "c", "state": "forged"})
    assert bad_state.headers["location"] == "/signin?error=google_expired"

    assert (await sign_in_with_google(client, id_token(aud="someone-else"))).headers["location"] == "/signin?error=google_failed"
    assert (await sign_in_with_google(client, id_token(exp=int(time.time()) - 10))).headers["location"] == "/signin?error=google_failed"
    assert (await sign_in_with_google(client, id_token(email_verified=False))).headers["location"] == "/signin?error=google_unverified"
    assert (await sign_in_with_google(client, id_token(), next_="//evil.example")).headers["location"] == "/"
    cancelled = await client.get("/v1/auth/google/callback", params={"error": "access_denied"})
    assert cancelled.headers["location"] == "/signin?error=google_cancelled"


async def test_providers_endpoint(client):
    assert (await client.get("/v1/auth/providers")).json() == {"google": True}


# ---------------------------------------------------------------- email


async def test_registration_email_is_delivered_with_an_absolute_link(client):
    from tal import mailer
    from tal import models as m
    from tal.db import sessionmaker

    sent: list[dict] = []

    def resend(req: httpx.Request) -> httpx.Response:
        assert req.headers["authorization"] == "Bearer re_test"
        sent.append(json.loads(req.content))
        return httpx.Response(200, json={"id": "msg_1"})

    mailer._transport = httpx.MockTransport(resend)
    r = await client.post("/v1/auth/register", json={"name": "Grace", "email": "grace@example.test", "password": "correct-horse"})
    assert r.status_code == 201
    await mailer.deliver_once()
    assert len(sent) == 1
    msg = sent[0]
    assert msg["to"] == ["grace@example.test"] and msg["from"] == "Team Activity Log <noreply@example.test>"
    assert "https://app.example.test/verify/" in msg["text"] and "https://app.example.test/verify/" in msg["html"]
    async with sessionmaker()() as s:
        row = (await s.execute(select(m.Email))).scalar_one()
        assert row.status == "sent" and row.delivered_at is not None


async def test_failed_delivery_is_retried_then_marked_failed(client):
    from tal import mailer
    from tal import models as m
    from tal.db import sessionmaker

    mailer._transport = httpx.MockTransport(lambda req: httpx.Response(403, json={"message": "The example.test domain is not verified"}))
    await client.post("/v1/auth/forgot", json={"email": "nobody@example.test"})  # no account: nothing queued
    await client.post("/v1/auth/register", json={"name": "Linus", "email": "linus@example.test", "password": "correct-horse"})
    await mailer.deliver_once()
    async with sessionmaker()() as s:
        row = (await s.execute(select(m.Email))).scalar_one()
        assert row.status == "pending" and row.attempts == 1 and "not verified" in row.last_error
        row.attempts = mailer.MAX_ATTEMPTS - 1
        row.last_error = None  # skip the backoff wait
        await s.commit()
    await mailer.deliver_once()
    async with sessionmaker()() as s:
        assert (await s.execute(select(m.Email))).scalar_one().status == "failed"
