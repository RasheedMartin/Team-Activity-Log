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
