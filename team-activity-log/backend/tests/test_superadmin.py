"""Super admin: only listed, verified accounts; deleting an org removes it with its data; wiping
everything needs ALLOW_WIPE and the phrase."""

import pytest
from sqlalchemy import func, select, update
from test_plans_and_avatars import png, signup, upload  # noqa: I001 (sibling test module)

from tal import models as m
from tal.db import sessionmaker


@pytest.fixture
def env(monkeypatch):
    from tal import config

    def apply(**kw):
        for k, v in kw.items():
            monkeypatch.setenv(k, v)
        config.get_settings.cache_clear()

    yield apply
    config.get_settings.cache_clear()


async def _verify(email: str) -> None:
    async with sessionmaker()() as s:
        await s.execute(update(m.User).where(m.User.email == email).values(email_verified_at=func.now()))
        await s.commit()


async def test_super_admin_can_delete_an_org_others_cannot_see_the_page(client, env):
    env(SUPERADMIN_EMAILS='["boss@example.test"]')
    victim = await signup(client, "victim@example.test", org="Victim Lab")
    org = victim["orgs"][0]["org"]["id"]
    ws = victim["orgs"][0]["workspaces"][0]["id"]
    asset = (await upload(client, org, png())).json()
    post = (await client.post(f"/v1/orgs/{org}/workspaces/{ws}/posts", json={"title": "Has an image"})).json()["post"]
    await client.post(f"/v1/orgs/{org}/image-instances", json={"assetId": asset["id"], "postId": post["id"]})
    assert (await client.get("/v1/super/overview")).status_code == 404  # not a super admin

    boss = await signup(client, "boss@example.test", org=None)
    assert "superAdmin" not in boss  # unverified: the listed email isn't proven yet
    await _verify("boss@example.test")
    me = (await client.get("/v1/me")).json()
    assert me.get("superAdmin") is True
    ov = (await client.get("/v1/super/overview")).json()
    assert any(o["slug"] == "victim-lab" and o["posts"] == 1 for o in ov["orgs"]) and ov["wipeAllowed"] is False

    assert (await client.request("DELETE", f"/v1/super/orgs/{org}", json={"confirm": "wrong"})).status_code == 422
    r = await client.request("DELETE", f"/v1/super/orgs/{org}", json={"confirm": "victim-lab"})
    assert r.status_code == 200, r.text
    async with sessionmaker()() as s:
        assert await s.scalar(select(func.count()).select_from(m.Organization).where(m.Organization.slug == "victim-lab")) == 0
        assert await s.scalar(select(func.count()).select_from(m.Asset)) == 0


async def test_wipe_needs_the_switch_and_the_phrase(client, env):
    env(SUPERADMIN_EMAILS='["boss@example.test"]')
    await signup(client, "boss@example.test", org="Keep Lab")
    await _verify("boss@example.test")
    assert (await client.post("/v1/super/wipe", json={"confirm": "DELETE EVERYTHING"})).status_code == 403
    env(ALLOW_WIPE="true")
    assert (await client.post("/v1/super/wipe", json={"confirm": "delete"})).status_code == 422
    assert (await client.post("/v1/super/wipe", json={"confirm": "DELETE EVERYTHING"})).status_code == 200
    async with sessionmaker()() as s:
        assert await s.scalar(select(func.count()).select_from(m.User)) == 0
