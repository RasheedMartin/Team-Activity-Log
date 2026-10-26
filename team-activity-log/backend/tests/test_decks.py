"""Decks built in the app (owner request): a deck made slide by slide, no PowerPoint needed."""

from test_plans_and_avatars import signup  # noqa: I001 (sibling test module)

SLIDE = {"id": "s1", "type": "slide", "design": {"size": {"w": 960, "h": 540}, "elements": [{"id": "t", "kind": "text", "x": 60, "y": 40, "w": 840, "h": 80, "doc": {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Q3 results"}]}]}}]}}


async def test_build_a_deck(client):
    me = await signup(client, "decks@example.test")
    org, ws = me["orgs"][0]["org"]["id"], me["orgs"][0]["workspaces"][0]["id"]
    w = f"/v1/orgs/{org}/workspaces/{ws}"
    deck = (await client.post(f"{w}/collections", json={"name": "Quarterly review", "kind": "deck"})).json()
    assert deck["kind"] == "deck"
    # Two decks may share a name (only notebook names are unique).
    assert (await client.post(f"{w}/collections", json={"name": "Quarterly review", "kind": "deck"})).status_code == 201

    # "Add slide": a draft with a designed slide, appended to the deck.
    r = await client.post(f"{w}/posts", json={"title": "Q3 results", "blocks": [SLIDE], "collectionId": deck["id"]})
    assert r.status_code == 201, r.text
    slide = r.json()["post"]
    got = (await client.get(f"{w}/collections/{deck['id']}")).json()
    assert got["postIds"] == [slide["id"]]

    # Listed with decks, not notebooks.
    items = (await client.get(f"{w}/library", params={"kind": "collection"})).json()["items"]
    assert deck["id"] in [i["id"] for i in items]
    notebooks = (await client.get(f"{w}/library", params={"kind": "notebook"})).json()["items"]
    assert deck["id"] not in [i["id"] for i in notebooks]

    # Deleting the deck can take its slides (the caller's own) with it.
    r = await client.delete(f"{w}/collections/{deck['id']}", params={"deleteMyPosts": "true"})
    assert r.json()["deletedPostIds"] == [slide["id"]]
