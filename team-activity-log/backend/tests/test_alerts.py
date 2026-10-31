"""Saved-search alerts: follow a saved search; new matches go to Activity (and email for digests).
Elasticsearch is stubbed: these tests cover what tal.alerts asks and what it does with the answer."""

import datetime as dt

from sqlalchemy import select, update
from test_plans_and_avatars import signup  # noqa: I001 (sibling test module)

from tal import alerts
from tal import models as m
from tal.db import sessionmaker
from tal.timeutil import iso, now

TEXT = {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "noise floor"}]}]}


class FakeEs:
    def __init__(self):
        self.calls: list[dict] = []
        self.hits: list[tuple[str, str]] = []

    async def search(self, **kw):
        self.calls.append(kw)
        return {"hits": {"hits": [{"_id": pid, "_source": {"published_at": at}} for pid, at in self.hits]}}


async def test_follow_a_saved_search(client, monkeypatch):
    fake = FakeEs()
    monkeypatch.setattr(alerts, "es", lambda: fake)
    me = await signup(client, "alerts@example.test")
    org, ws = me["orgs"][0]["org"]["id"], me["orgs"][0]["workspaces"][0]["id"]
    base = f"/v1/orgs/{org}/workspaces/{ws}/saved-views"
    v = (await client.post(base, json={"name": "Noise", "filterSpec": {"q": "noise"}})).json()
    assert "alert" not in v

    # Subscribe; the saved search reports your alert, in the library too.
    assert (await client.put(f"{base}/{v['id']}/alert", json={"mode": "sometimes"})).status_code == 422
    assert (await client.put(f"{base}/{v['id']}/alert", json={"mode": "instant"})).json()["alert"] == "instant"
    assert (await client.get(f"{base}/{v['id']}")).json()["alert"] == "instant"

    # Nothing published in the workspace: no search runs at all.
    assert await alerts.run_once() == 0
    assert fake.calls == []

    post = (await client.post(f"/v1/orgs/{org}/workspaces/{ws}/posts", json={"title": "Preamp noise", "blocks": [{"id": "t", "type": "text", "doc": TEXT}]})).json()["post"]
    assert (await client.post(f"/v1/orgs/{org}/posts/{post['id']}/publish", json={})).status_code == 200
    fake.hits = [(post["id"], iso(now()))]
    assert await alerts.run_once() == 1
    q = fake.calls[-1]["query"]["bool"]
    assert q["must_not"] == [{"term": {"author_ids": me["user"]["id"]}}]  # your own posts never alert you
    assert "published_at" in q["filter"][-1]["range"]

    [n] = (await client.get(f"/v1/orgs/{org}/notifications")).json()
    assert n["kind"] == "alert" and n["viewName"] == "Noise" and n["count"] == 1 and n["postId"] == post["id"]
    assert "actorId" not in n and "commentId" not in n

    # Found again in the look-back window: not reported twice.
    assert await alerts.run_once() == 0
    assert len((await client.get(f"/v1/orgs/{org}/notifications")).json()) == 1

    # Daily digest: Activity plus an email listing the posts.
    assert (await client.put(f"{base}/{v['id']}/alert", json={"mode": "daily"})).json()["alert"] == "daily"
    async with sessionmaker()() as db:
        await db.execute(update(m.SearchAlert).values(checked_at=now() - dt.timedelta(days=2), recent_ids=[]))
        await db.commit()
    assert await alerts.run_once() == 1
    async with sessionmaker()() as db:
        email = (await db.execute(select(m.Email).where(m.Email.subject.like("%Noise%")))).scalar_one()
    assert "Preamp noise" in email.body and email.link.endswith(f"/search?view={v['id']}")
    assert await alerts.run_once() == 0  # not due again until tomorrow

    # Off: the alert is gone.
    assert "alert" not in (await client.put(f"{base}/{v['id']}/alert", json={"mode": "off"})).json()
    async with sessionmaker()() as db:
        assert (await db.execute(select(m.SearchAlert))).first() is None
