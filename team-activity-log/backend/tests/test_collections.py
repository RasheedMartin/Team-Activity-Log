"""Collections as other members see them: only published posts show and count; a collection with
nothing published yet isn't visible to them; rearranging never drops someone's drafts."""

from sqlalchemy import select
from test_plans_and_avatars import signup  # noqa: I001 (sibling test module)

from tal import models as m
from tal.db import sessionmaker

DOC = {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "x"}]}]}


async def login(client, email):
    client.cookies.clear()
    r = await client.post("/v1/auth/login", json={"email": email, "password": "correct-horse"})
    assert r.status_code == 200, r.text


async def add_member(client, org, email):
    await client.post(f"/v1/orgs/{org}/invites", json={"invites": [{"email": email, "role": "member", "workspaceIds": []}]})
    async with sessionmaker()() as s:
        link = (await s.execute(select(m.Email.link).where(m.Email.to == email))).scalar_one()
    client.cookies.clear()
    r = await client.post(f"/v1/invites/{link.rsplit('/', 1)[-1]}/accept", json={"name": email.split("@")[0], "password": "correct-horse"})
    assert r.status_code == 200, r.text


async def test_others_see_only_published_posts_in_a_collection(client):
    me = await signup(client, "owner@example.test")
    org, ws = me["orgs"][0]["org"]["id"], me["orgs"][0]["workspaces"][0]["id"]
    new = lambda t: client.post(f"/v1/orgs/{org}/workspaces/{ws}/posts", json={"title": t, "blocks": [{"id": "b", "type": "text", "doc": DOC}]})  # noqa: E731
    ids = [(await new(f"Slide {i}")).json()["post"]["id"] for i in range(3)]
    await client.post(f"/v1/orgs/{org}/posts/{ids[0]}/publish", json={})
    deck = (await client.post(f"/v1/orgs/{org}/workspaces/{ws}/collections", json={"name": "deck", "postIds": ids})).json()
    drafts_only = (await client.post(f"/v1/orgs/{org}/workspaces/{ws}/collections", json={"name": "drafts only", "postIds": ids[1:]})).json()
    assert deck["postIds"] == ids  # the author sees their drafts

    await add_member(client, org, "colleague@example.test")
    seen = (await client.get(f"/v1/orgs/{org}/workspaces/{ws}/collections/{deck['id']}")).json()
    assert seen["postIds"] == [ids[0]]  # only the published one
    lib = {i["id"]: i["postCount"] for i in (await client.get(f"/v1/orgs/{org}/workspaces/{ws}/library", params={"kind": "collection"})).json()["items"]}
    assert lib == {deck["id"]: 1}  # counts what they can see; the drafts-only collection isn't listed
    assert (await client.get(f"/v1/orgs/{org}/workspaces/{ws}/collections/{drafts_only['id']}")).status_code == 404

    # Everyone can view; changing it takes an editor (the owner decides).
    assert seen["myRole"] == "viewer"
    put = lambda: client.put(f"/v1/orgs/{org}/workspaces/{ws}/collections/{deck['id']}/posts", json={"postIds": [ids[0]]})  # noqa: E731
    assert (await put()).status_code == 403
    colleague = (await client.get("/v1/me")).json()["user"]["id"]
    await login(client, "owner@example.test")
    r = await client.put(f"/v1/orgs/{org}/workspaces/{ws}/collections/{deck['id']}/members", json={"members": [{"userId": colleague, "role": "editor"}]})
    assert r.status_code == 200 and {"userId": colleague, "role": "editor"} in r.json()["members"]

    # The editor rearranging what they see keeps the author's drafts in the collection; they still can't delete it.
    await login(client, "colleague@example.test")
    assert (await put()).status_code == 200
    assert (await client.delete(f"/v1/orgs/{org}/workspaces/{ws}/collections/{deck['id']}")).status_code == 403
    await login(client, "owner@example.test")
    assert (await client.get(f"/v1/orgs/{org}/workspaces/{ws}/collections/{deck['id']}")).json()["postIds"] == ids
