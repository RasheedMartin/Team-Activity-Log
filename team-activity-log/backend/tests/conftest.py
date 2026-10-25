"""Shared fixtures: the API in-process against a real Postgres (the local dev server), with a
clean database per test. Tests that need it are skipped when that Postgres isn't running."""

from __future__ import annotations

import asyncio
import os

import asyncpg
import httpx
import pytest
from sqlalchemy import text

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
        RATE_LIMIT="false",
        TRIAL_DAYS="0",  # plan tests start on Free; trials have their own tests
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
        await s.execute(text("truncate users, organizations, emails, outbox, blobs cascade"))
        await s.commit()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://app.example.test") as c:
        yield c
