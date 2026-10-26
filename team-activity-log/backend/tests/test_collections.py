"""Collections as other members see them: only published posts show and count; a collection with
nothing published yet isn't visible to them; rearranging never drops someone's drafts."""

from sqlalchemy import select

from tal import models as m
from tal.db import sessionmaker
from test_plans_and_avatars import signup  # noqa: I001 (sibling test module)

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
    lib = {i["id"]: i["postCount"] for i in (await client.get(f"/v1/orgs/{org}/workspaces/{ws}/library", params={"kind": "notebook"})).json()["items"]}
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


async def test_a_notebook_shared_with_people_is_hidden_from_everyone_else(client):
    me = await signup(client, "author@example.test")
    org, ws = me["orgs"][0]["org"]["id"], me["orgs"][0]["workspaces"][0]["id"]
    post = (await client.post(f"/v1/orgs/{org}/workspaces/{ws}/posts", json={"title": "Page", "blocks": [{"id": "b", "type": "text", "doc": DOC}]})).json()["post"]
    await client.post(f"/v1/orgs/{org}/posts/{post['id']}/publish", json={})
    nb = (await client.post(f"/v1/orgs/{org}/workspaces/{ws}/collections", json={"name": "Private book", "kind": "notebook", "postIds": [post["id"]]})).json()
    assert nb["visibility"] == "workspace"  # public to the workspace by default

    await add_member(client, org, "friend@example.test")
    friend = (await client.get("/v1/me")).json()["user"]["id"]
    await login(client, "author@example.test")
    await add_member(client, org, "stranger@example.test")
    await login(client, "author@example.test")
    r = await client.put(f"/v1/orgs/{org}/workspaces/{ws}/collections/{nb['id']}/members", json={"visibility": "people", "members": [{"userId": friend, "role": "viewer"}]})
    assert r.status_code == 200 and r.json()["visibility"] == "people"

    url = f"/v1/orgs/{org}/workspaces/{ws}/collections/{nb['id']}"
    lib = lambda **p: client.get(f"/v1/orgs/{org}/workspaces/{ws}/library", params={"kind": "notebook", **p})  # noqa: E731
    await login(client, "stranger@example.test")
    assert (await client.get(url)).status_code == 404
    assert (await lib()).json()["items"] == []

    await login(client, "friend@example.test")
    assert (await client.get(url)).json()["myRole"] == "viewer"
    shared = (await lib(shared="1")).json()["items"]
    assert [(i["id"], i["sharedWithMe"]) for i in shared] == [(nb["id"], True)]
    assert (await client.put(f"{url}/posts", json={"postIds": []})).status_code == 403  # viewing only


async def test_a_notebook_can_follow_a_tag(client):
    me = await signup(client, "follow@example.test")
    org, ws = me["orgs"][0]["org"]["id"], me["orgs"][0]["workspaces"][0]["id"]
    tag = (await client.post(f"/v1/orgs/{org}/tags", json={"name": "calibration"})).json()
    tid = tag.get("id") or tag.get("tag", {}).get("id")
    new = lambda t, tags: client.post(f"/v1/orgs/{org}/workspaces/{ws}/posts", json={"title": t, "tagIds": tags, "blocks": [{"id": "b", "type": "text", "doc": DOC}]})  # noqa: E731
    old = (await new("Old calibration", [tid])).json()["post"]["id"]
    await client.post(f"/v1/orgs/{org}/posts/{old}/publish", json={})
    nb = (await client.post(f"/v1/orgs/{org}/workspaces/{ws}/collections", json={"name": "Calibration log", "postIds": []})).json()
    assert nb["kind"] == "notebook" and not nb.get("followsTag")  # manual unless asked

    url = f"/v1/orgs/{org}/workspaces/{ws}/collections/{nb['id']}"
    r = await client.patch(url, json={"followTagId": tid})
    assert r.json()["followsTag"] is True and r.json()["postIds"] == [old]  # existing posts come in
    fresh = (await new("New calibration", [tid])).json()["post"]["id"]
    assert (await client.get(url)).json()["postIds"] == [old]  # drafts don't
    await client.post(f"/v1/orgs/{org}/posts/{fresh}/publish", json={})
    assert (await client.get(url)).json()["postIds"] == [old, fresh]  # published ones are appended
    await client.patch(url, json={"followTagId": None})
    other = (await new("Later", [tid])).json()["post"]["id"]
    await client.post(f"/v1/orgs/{org}/posts/{other}/publish", json={})
    assert (await client.get(url)).json()["postIds"] == [old, fresh]  # stopped following
