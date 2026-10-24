"""Plan limits (Free: 10 members, 1 workspace, no private workspaces, 2 GB, 5 imports/month)
and profile photos (stored, re-encoded, visible only within shared orgs)."""

from __future__ import annotations

import io

from PIL import Image
from sqlalchemy import update


def png(w: int = 600, h: int = 400, color=(200, 30, 30)) -> bytes:
    out = io.BytesIO()
    img = Image.new("RGB", (w, h), color)
    exif = Image.Exif()
    exif[0x010F] = "SecretCam"  # camera make; must not survive re-encoding
    img.save(out, "PNG", exif=exif.tobytes())
    return out.getvalue()


async def signup(client, email: str, org: str | None = "Acme Lab") -> dict:
    client.cookies.clear()
    r = await client.post("/v1/auth/register", json={"name": email.split("@")[0], "email": email, "password": "correct-horse"})
    assert r.status_code == 201, r.text
    if org:
        r = await client.post("/v1/orgs", json={"name": org, "slug": org.lower().replace(" ", "-"), "workspaceName": "General"})
        assert r.status_code == 201, r.text
    return r.json()


# ---------------------------------------------------------------- plans


async def test_new_orgs_are_free_and_report_usage(client):
    me = await signup(client, "owner@example.test")
    org = me["orgs"][0]["org"]["id"]
    p = (await client.get(f"/v1/orgs/{org}/plan")).json()
    assert p["plan"] == "free" and p["limits"]["members"] == 10 and p["limits"]["workspaces"] == 1
    assert p["limits"]["storageBytes"] == 2 * 1024**3 and p["usage"] == {"members": 1, "pendingInvites": 0, "workspaces": 1, "storageBytes": 0, "importsThisMonth": 0}


async def test_free_member_limit_counts_pending_invites(client):
    me = await signup(client, "owner@example.test")
    org = me["orgs"][0]["org"]["id"]
    invites = [{"email": f"p{i}@example.test", "role": "member", "workspaceIds": []} for i in range(10)]
    res = (await client.post(f"/v1/orgs/{org}/invites", json={"invites": invites})).json()
    ok = [r for r in res if "invite" in r]
    refused = [r for r in res if "error" in r]
    assert len(ok) == 9 and len(refused) == 1  # owner + 9 pending = 10
    assert "up to 10 members" in refused[0]["error"]


async def test_free_workspace_limits(client):
    me = await signup(client, "owner@example.test")
    org = me["orgs"][0]["org"]["id"]
    r = await client.post(f"/v1/orgs/{org}/workspaces", json={"name": "Second", "allOrgMembers": True})
    assert r.status_code == 403 and r.json()["code"] == "plan_limit" and r.json()["details"]["limit"] == "workspaces"
    r = await client.post(f"/v1/orgs/{org}/workspaces", json={"name": "Secret", "allOrgMembers": False})
    assert r.status_code == 403 and r.json()["details"]["limit"] == "private_workspaces"
    ws = me["orgs"][0]["workspaces"][0]["id"]
    r = await client.patch(f"/v1/orgs/{org}/workspaces/{ws}", json={"allOrgMembers": False})
    assert r.status_code == 403 and r.json()["details"]["limit"] == "private_workspaces"


async def test_team_plan_lifts_workspace_limits(client):
    from tal import models as m
    from tal.db import sessionmaker

    me = await signup(client, "owner@example.test")
    org = me["orgs"][0]["org"]["id"]
    async with sessionmaker()() as s:
        await s.execute(update(m.Organization).values(plan="team"))
        await s.commit()
    r = await client.post(f"/v1/orgs/{org}/workspaces", json={"name": "Secret", "allOrgMembers": False})
    assert r.status_code == 201


async def upload(client, org: str, data: bytes, name: str = "plot.png"):
    r = await client.post(f"/v1/orgs/{org}/uploads", json={"filename": name, "mime": "image/png", "bytes": len(data)})
    assert r.status_code == 201, r.text
    up = r.json()
    await client.put(up["uploadUrl"], content=data)
    return await client.post(f"/v1/orgs/{org}/uploads/{up['uploadId']}/complete")


async def test_storage_limit_blocks_new_images_but_duplicates_are_free(client):
    from tal import models as m
    from tal.db import sessionmaker

    me = await signup(client, "owner@example.test")
    org = me["orgs"][0]["org"]["id"]
    first = png(color=(1, 2, 3))
    assert (await upload(client, org, first)).status_code == 201
    async with sessionmaker()() as s:
        await s.execute(update(m.Organization).values(storage_quota_bytes=len(first) + 10))
        await s.commit()
    assert (await upload(client, org, first)).status_code == 200  # same bytes: deduped, allowed
    r = await upload(client, org, png(color=(9, 9, 9)))
    assert r.status_code == 403 and r.json()["details"]["limit"] == "storage"


async def test_imports_per_month(client):
    me = await signup(client, "owner@example.test")
    org, ws = me["orgs"][0]["org"]["id"], me["orgs"][0]["workspaces"][0]["id"]
    body = {"filename": "deck.pptx", "bytes": 1000, "mode": "per_slide", "defaults": {"tagIds": [], "guessDates": True, "collectionName": "deck"}}
    for _ in range(5):
        assert (await client.post(f"/v1/orgs/{org}/workspaces/{ws}/imports", json=body)).status_code == 201
    r = await client.post(f"/v1/orgs/{org}/workspaces/{ws}/imports", json=body)
    assert r.status_code == 403 and r.json()["details"]["limit"] == "imports"


# ---------------------------------------------------------------- avatars


async def test_avatar_upload_is_reencoded_and_shared_only_within_orgs(client):
    me = await signup(client, "ada@example.test")
    uid = me["user"]["id"]
    r = await client.put("/v1/me/avatar", content=png(1200, 800))
    assert r.status_code == 200
    url = r.json()["user"]["avatarUrl"]
    assert url.startswith(f"/v1/users/{uid}/avatar?v=")
    img = await client.get(url)
    assert img.status_code == 200 and img.headers["content-type"] == "image/jpeg"
    pic = Image.open(io.BytesIO(img.content))
    assert pic.size == (256, 256) and 0x010F not in pic.getexif()

    # Someone in no shared org can't see it.
    await signup(client, "stranger@example.test", org="Other Org")
    assert (await client.get(url)).status_code == 404


async def test_avatar_rejects_svg_and_ignores_client_urls(client):
    await signup(client, "ada@example.test")
    svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    r = await client.put("/v1/me/avatar", content=svg)
    assert r.status_code == 415
    r = await client.patch("/v1/me", json={"avatarUrl": "javascript:alert(1)"})
    assert r.status_code == 200 and "avatarUrl" not in r.json()["user"]


async def test_avatar_remove(client):
    me = await signup(client, "ada@example.test")
    url = (await client.put("/v1/me/avatar", content=png())).json()["user"]["avatarUrl"]
    r = await client.delete("/v1/me/avatar")
    assert r.status_code == 200 and "avatarUrl" not in r.json()["user"]
    assert (await client.get(url)).status_code == 404
    assert me["user"]["id"]
