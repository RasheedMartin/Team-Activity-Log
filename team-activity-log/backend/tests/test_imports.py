"""Your imports list: unfinished ones are easy to find again; failed/deleted ones and other people's aren't listed."""

from test_plans_and_avatars import signup  # noqa: I001 (sibling test module)

BODY = {"filename": "deck.pptx", "bytes": 1000, "mode": "per_slide", "defaults": {"tagIds": [], "guessDates": True, "collectionName": "deck"}}


async def test_my_imports_lists_mine_with_progress(client):
    from sqlalchemy import update

    from tal import models as m
    from tal.db import sessionmaker

    me = await signup(client, "owner@example.test")
    org, ws = me["orgs"][0]["org"]["id"], me["orgs"][0]["workspaces"][0]["id"]
    kept = (await client.post(f"/v1/orgs/{org}/workspaces/{ws}/imports", json={**BODY, "filename": "kept.pptx"})).json()
    gone = (await client.post(f"/v1/orgs/{org}/workspaces/{ws}/imports", json={**BODY, "filename": "gone.pptx"})).json()
    async with sessionmaker()() as s:
        await s.execute(update(m.ImportJobRow).where(m.ImportJobRow.id == gone["id"]).values(status="failed"))  # e.g. deleted
        await s.execute(update(m.ImportJobRow).where(m.ImportJobRow.id == kept["id"]).values(status="review", slide_count=8))
        await s.commit()
    r = await client.get(f"/v1/orgs/{org}/workspaces/{ws}/imports")
    assert r.status_code == 200
    assert [(i["sourceFilename"], i["status"], i["slideCount"], i["drafts"], i["published"]) for i in r.json()] == [("kept.pptx", "review", 8, 0, 0)]


async def test_deleted_drafts_leave_collections_until_restored(client):
    me = await signup(client, "drafts@example.test")
    org, ws = me["orgs"][0]["org"]["id"], me["orgs"][0]["workspaces"][0]["id"]
    ids = [(await client.post(f"/v1/orgs/{org}/workspaces/{ws}/posts", json={"title": f"Slide {i}"})).json()["post"]["id"] for i in range(3)]
    c = (await client.post(f"/v1/orgs/{org}/workspaces/{ws}/collections", json={"name": "deck", "postIds": ids})).json()

    async def listed():
        one = (await client.get(f"/v1/orgs/{org}/workspaces/{ws}/collections/{c['id']}")).json()["postIds"]
        lib = (await client.get(f"/v1/orgs/{org}/workspaces/{ws}/library", params={"kind": "collection"})).json()["items"]
        return one, next(i["postCount"] for i in lib if i["id"] == c["id"])

    assert await listed() == (ids, 3)
    assert (await client.delete(f"/v1/orgs/{org}/posts/{ids[1]}")).status_code == 204
    assert await listed() == ([ids[0], ids[2]], 2)  # gone from the collection page and its count
    assert (await client.post(f"/v1/orgs/{org}/posts/{ids[1]}/restore", json={})).status_code == 200
    assert await listed() == (ids, 3)  # back in its place


async def test_combine_drafts_and_split_them_back(client):
    me = await signup(client, "combine@example.test")
    org, ws = me["orgs"][0]["org"]["id"], me["orgs"][0]["workspaces"][0]["id"]
    ids = [(await client.post(f"/v1/orgs/{org}/workspaces/{ws}/posts", json={"title": f"Slide {i}"})).json()["post"]["id"] for i in range(3)]
    c = (await client.post(f"/v1/orgs/{org}/workspaces/{ws}/collections", json={"name": "deck", "postIds": ids})).json()
    deck = lambda: client.get(f"/v1/orgs/{org}/workspaces/{ws}/collections/{c['id']}")  # noqa: E731

    r = await client.post(f"/v1/orgs/{org}/posts/combine", json={"postIds": [ids[1], ids[2]]})
    assert r.status_code == 200, r.text
    combined = r.json()["post"]
    assert combined["id"] == ids[1] and [x["postId"] for x in combined["source"]["mergedFrom"]] == [ids[2]]
    assert len(combined["blocks"]) > 1  # slide 2's content, then a break, slide 3's title and content
    assert (await deck()).json()["postIds"] == [ids[0], ids[1]]  # slide 3 is set aside

    # Combine again (swap more in), then split everything back out, in deck order.
    r = await client.post(f"/v1/orgs/{org}/posts/combine", json={"postIds": [ids[1], ids[0]]})
    assert [x["postId"] for x in r.json()["post"]["source"]["mergedFrom"]] == [ids[2], ids[0]]
    assert (await deck()).json()["postIds"] == [ids[1]]
    r = await client.post(f"/v1/orgs/{org}/posts/{ids[1]}/split")
    assert r.status_code == 200, r.text
    assert "mergedFrom" not in (r.json()["post"]["source"] or {})
    assert len(r.json()["post"]["blocks"]) == 1
    assert (await deck()).json()["postIds"] == ids
