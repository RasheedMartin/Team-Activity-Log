"""Each protection, tested against the attack it exists for."""

from __future__ import annotations

import io
import zipfile

import pytest
from sqlalchemy import update

from test_plans_and_avatars import png, signup, upload  # noqa: I001 (sibling test module)


async def make_post(client, org: str, ws: str, **body) -> dict:
    r = await client.post(f"/v1/orgs/{org}/workspaces/{ws}/posts", json=body)
    assert r.status_code == 201, r.text
    return r.json()["post"]


def ids(me: dict) -> tuple[str, str]:
    return me["orgs"][0]["org"]["id"], me["orgs"][0]["workspaces"][0]["id"]


# ---------------------------------------------------------------- stored content


async def test_rich_text_is_rebuilt_from_an_allow_list(client):
    org, ws = ids(await signup(client, "ada@example.test"))
    evil = {
        "type": "doc",
        "content": [
            {"type": "paragraph", "attrs": {"onclick": "alert(1)"}, "content": [
                {"type": "text", "text": "click me", "marks": [{"type": "link", "attrs": {"href": "javascript:alert(1)"}}]},
                {"type": "text", "text": " safe", "marks": [{"type": "link", "attrs": {"href": "https://example.test", "onmouseover": "x"}}]},
            ]},
            {"type": "iframe", "attrs": {"src": "https://evil.test"}},
            {"type": "heading", "attrs": {"level": 99}, "content": [{"type": "text", "text": "big‮evil"}]},
        ],
    }  # fmt: skip
    post = await make_post(client, org, ws, title="T", blocks=[{"id": "b1", "type": "text", "doc": evil}])
    doc = post["blocks"][0]["doc"]
    para, heading = doc["content"]  # iframe dropped
    assert "attrs" not in para
    assert "marks" not in para["content"][0]  # javascript: link removed, text kept
    assert para["content"][1]["marks"] == [{"type": "link", "attrs": {"href": "https://example.test"}}]
    assert "attrs" not in heading and heading["content"][0]["text"] == "bigevil"  # bidi override stripped


def test_colors_and_alignment_accept_only_plain_values():
    from tal.sanitize import doc

    d = doc({"type": "doc", "content": [{"type": "paragraph", "attrs": {"textAlign": "center;position:fixed"}, "content": [
        {"type": "text", "text": "ok", "marks": [{"type": "textStyle", "attrs": {"color": "#C00000"}}, {"type": "highlight", "attrs": {"color": "#ffff00"}}]},
        {"type": "text", "text": " css", "marks": [{"type": "textStyle", "attrs": {"color": "red;background:url(https://evil.test)"}}]},
        {"type": "text", "text": " var", "marks": [{"type": "highlight", "attrs": {"color": "var(--x)"}}]},
    ]}, {"type": "heading", "attrs": {"level": 3, "textAlign": "right"}, "content": [{"type": "text", "text": "h"}]}]})  # fmt: skip
    para, heading = d["content"]
    assert "attrs" not in para  # unknown alignment dropped
    assert para["content"][0]["marks"] == [{"type": "textStyle", "attrs": {"color": "#c00000"}}, {"type": "highlight", "attrs": {"color": "#ffff00"}}]
    assert "marks" not in para["content"][1] and "marks" not in para["content"][2]  # anything but #rrggbb: mark dropped, text kept
    assert heading["attrs"] == {"level": 3, "textAlign": "right"}


async def test_text_fields_are_cleaned_and_bounded(client):
    org, ws = ids(await signup(client, "ada@example.test"))
    post = await make_post(client, org, ws, title="  Hello\u0000 world​  ")
    assert post["title"] == "Hello world"
    r = await client.post(f"/v1/orgs/{org}/workspaces/{ws}/posts", json={"title": "x" * 301})
    assert r.status_code == 422 and r.json()["details"]["field"] == "title"
    r = await client.post(f"/v1/orgs/{org}/workspaces/{ws}/posts", json={"workDate": "not-a-date"})
    assert r.status_code == 422  # was a 500 before validation
    r = await client.patch("/v1/me", json={"timezone": "Mars/Olympus"})
    assert r.status_code == 422


async def test_validation_errors_never_echo_input(client):
    await signup(client, "ada@example.test")
    r = await client.post("/v1/auth/login", content=b'["<script>secret-value</script>"]', headers={"content-type": "application/json"})
    assert r.status_code == 422 and "secret-value" not in r.text


# ---------------------------------------------------------------- tenancy


async def test_cannot_render_another_orgs_image_by_id(client):
    a_org, a_ws = ids(await signup(client, "a@example.test", org="Org A"))
    asset = (await upload(client, a_org, png(color=(5, 6, 7)))).json()
    a_post = await make_post(client, a_org, a_ws, title="A")
    inst = (await client.post(f"/v1/orgs/{a_org}/image-instances", json={"assetId": asset["id"], "postId": a_post["id"]})).json()

    b_org, b_ws = ids(await signup(client, "b@example.test", org="Org B"))
    b_post = await make_post(client, b_org, b_ws, title="B", blocks=[{"id": "x", "type": "image", "imageInstanceId": inst["id"]}])
    detail = (await client.get(f"/v1/orgs/{b_org}/posts/{b_post['id']}")).json()
    assert detail["images"] == []  # Org A's image never resolves inside Org B
    assert (await client.get(f"/v1/orgs/{a_org}/assets/{asset['id']}/original")).status_code == 404


async def test_private_workspace_images_stay_private(client):
    from tal import models as m
    from tal.db import sessionmaker

    owner = await signup(client, "owner@example.test")
    org, _ = ids(owner)
    async with sessionmaker()() as s:
        await s.execute(update(m.Organization).values(plan="team"))
        await s.commit()
    secret = (await client.post(f"/v1/orgs/{org}/workspaces", json={"name": "Secret", "allOrgMembers": False})).json()
    asset = (await upload(client, org, png(color=(42, 42, 42)))).json()
    post = await make_post(client, org, secret["id"], title="Secret plot")
    await client.post(f"/v1/orgs/{org}/image-instances", json={"assetId": asset["id"], "postId": post["id"]})
    invite = (await client.post(f"/v1/orgs/{org}/invites", json={"invites": [{"email": "member@example.test", "role": "member", "workspaceIds": []}]})).json()
    assert "invite" in invite[0]

    # The member joins (token from the queued email) and tries the asset URL.
    async with sessionmaker()() as s:
        from sqlalchemy import select

        link = (await s.execute(select(m.Email.link).where(m.Email.to == "member@example.test"))).scalar_one()
    client.cookies.clear()
    token = link.rsplit("/", 1)[-1]
    r = await client.post(f"/v1/invites/{token}/accept", json={"name": "Mem", "password": "correct-horse"})
    assert r.status_code == 200, r.text
    assert (await client.get(f"/v1/orgs/{org}/assets/{asset['id']}/original")).status_code == 404


async def test_imports_belong_to_their_starter(client):
    from tal import models as m
    from tal.db import sessionmaker

    owner = await signup(client, "owner@example.test")
    org, ws = ids(owner)
    body = {"filename": "deck.pptx", "bytes": 10, "mode": "per_slide", "defaults": {}}
    job = (await client.post(f"/v1/orgs/{org}/workspaces/{ws}/imports", json=body)).json()
    # A second member of the same org can't see or change it.
    member = await signup(client, "member@example.test", org=None)
    async with sessionmaker()() as s:
        from tal.ids import uuid7

        s.add(m.Membership(id=uuid7(), org_id=org, user_id=member["user"]["id"], role="member", status="active"))
        await s.commit()
    assert (await client.get(f"/v1/orgs/{org}/imports/{job['id']}")).status_code == 404
    assert (await client.delete(f"/v1/orgs/{org}/imports/{job['id']}")).status_code == 404


async def test_tag_group_from_another_org_is_ignored(client):
    from sqlalchemy import select

    from tal import models as m
    from tal.db import sessionmaker

    a_org, _ = ids(await signup(client, "a@example.test", org="Org A"))
    async with sessionmaker()() as s:
        a_group = (await s.execute(select(m.TagGroup.id).where(m.TagGroup.org_id == a_org))).scalars().first()
    b_org, _ = ids(await signup(client, "b@example.test", org="Org B"))
    tag = (await client.post(f"/v1/orgs/{b_org}/tags", json={"name": "x", "groupId": str(a_group)})).json()
    assert "groupId" not in tag


async def test_join_link_accounts_are_not_marked_verified(client):
    from sqlalchemy import select

    from tal import models as m
    from tal.db import sessionmaker

    org, _ = ids(await signup(client, "owner@example.test"))
    link = (await client.post(f"/v1/orgs/{org}/invite-links", json={"roleCap": "member", "days": 7})).json()
    client.cookies.clear()
    r = await client.post(f"/v1/invites/{link['token']}/accept", json={"name": "Someone", "email": "claims@example.test", "password": "correct-horse"})
    assert r.status_code == 200, r.text
    async with sessionmaker()() as s:
        u = (await s.execute(select(m.User).where(m.User.email == "claims@example.test"))).scalar_one()
        assert u.email_verified_at is None


# ---------------------------------------------------------------- transport & abuse


async def test_security_headers(client):
    r = await client.get("/v1/health")
    for h in ("content-security-policy", "x-content-type-options", "x-frame-options", "referrer-policy"):
        assert h in r.headers
    assert "script-src 'self'" in r.headers["content-security-policy"] and r.headers["cache-control"] == "no-store"


async def test_cross_site_writes_are_refused(client):
    await signup(client, "ada@example.test")
    bad = await client.patch("/v1/me", json={"title": "x"}, headers={"origin": "https://evil.example"})
    assert bad.status_code == 403 and bad.json()["code"] == "cross_site"
    ok = await client.patch("/v1/me", json={"title": "x"}, headers={"origin": "https://app.example.test"})
    assert ok.status_code == 200


async def test_oversized_json_is_refused_before_parsing(client):
    await signup(client, "ada@example.test")
    r = await client.patch("/v1/me", content=b"{" + b" " * (3 * 1024 * 1024) + b"}", headers={"content-type": "application/json"})
    assert r.status_code == 413


@pytest.fixture
def rate_limits_on():
    from tal import config, security

    config.get_settings().rate_limit = True
    security.reset_limits()
    yield
    config.get_settings().rate_limit = False
    security.reset_limits()


async def test_password_guessing_is_rate_limited(client, rate_limits_on):
    await signup(client, "ada@example.test", org=None)
    codes = [(await client.post("/v1/auth/login", json={"email": "ada@example.test", "password": f"wrong-{i}"})).status_code for i in range(7)]
    assert codes[:5] == [401] * 5 and codes[5] == 429  # per-account lockout after 5 wrong passwords
    # The correct password is also refused while locked: guessing can't confirm a hit.
    assert (await client.post("/v1/auth/login", json={"email": "ada@example.test", "password": "correct-horse"})).status_code == 429


def test_zip_bomb_decks_are_refused():
    from tal.pptx import PptxError, parse_pptx

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("ppt/presentation.xml", "<x/>")
        z.writestr("ppt/media/huge.png", b"\0" * (300 * 1024 * 1024))
    with pytest.raises(PptxError, match="unreasonable size"):
        parse_pptx(buf.getvalue())


def test_slide_designs_keep_only_safe_plain_values():
    from tal.sanitize import blocks

    iid = "0192f0c0-0000-7000-8000-000000000001"
    [b] = blocks([{"id": "s", "type": "slide", "notes": "n", "design": {
        "size": {"w": 960, "h": 540}, "background": "url(javascript:x)", "fonts": {"body": "Arial</style>", "heading": "Georgia"},
        "elements": [
            {"id": "a", "kind": "text", "x": 1e9, "y": 0, "w": 100, "h": 50, "color": "red", "fill": "#ABCDEF", "valign": "sideways", "onclick": "x",
             "doc": {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "hi", "marks": [{"type": "textStyle", "attrs": {"fontSize": "12px;position:fixed", "color": "#c00000"}}]}]}]}},
            {"id": "b", "kind": "shape", "shape": "script", "x": 0, "y": 0, "w": 10, "h": 10, "lineWidth": float("nan")},
            {"id": "c", "kind": "image", "imageInstanceId": "not-a-uuid", "x": 0, "y": 0, "w": 1, "h": 1},
            {"id": "d", "kind": "image", "imageInstanceId": iid, "x": 0, "y": 0, "w": 1, "h": 1, "decorative": "yes"},
            {"id": "e", "kind": "iframe", "x": 0, "y": 0, "w": 1, "h": 1},
            {"id": "f", "kind": "text", "x": "0", "y": 0, "w": 1, "h": 1},
        ]}}])  # fmt: skip
    d = b["design"]
    assert b["notes"] == "n" and "background" not in d and d["fonts"] == {"heading": "Georgia"}
    text, shape, image = d["elements"]  # bad image id, unknown kind, and non-numeric geometry dropped
    assert text["x"] == 2880 and text["fill"] == "#abcdef" and "color" not in text and "valign" not in text and "onclick" not in text
    assert text["doc"]["content"][0]["content"][0]["marks"] == [{"type": "textStyle", "attrs": {"color": "#c00000"}}]  # bad size dropped
    assert shape["shape"] == "rect" and "lineWidth" not in shape
    assert image == {"id": "d", "kind": "image", "x": 0, "y": 0, "w": 1, "h": 1, "imageInstanceId": iid}  # "yes" is not True
