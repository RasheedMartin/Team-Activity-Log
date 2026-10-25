"""Slide themes on posts and notebooks: sanitized, and not treated as content edits."""

from test_plans_and_avatars import signup  # noqa: I001 (sibling test module)


def ids(me: dict) -> tuple[str, str]:
    return me["orgs"][0]["org"]["id"], me["orgs"][0]["workspaces"][0]["id"]


THEME = {"theme": {"name": "Midnight", "background": "#0F172A", "text": "#e2e8f0", "heading": "#ffffff", "accent": "#2dd4bf", "headingFont": "Georgia", "bodyFont": "Verdana"}}


async def test_post_theme_is_sanitized_and_not_a_revision(client):
    org, ws = ids(await signup(client, "ada@example.test"))
    blocks = [{"id": "b", "type": "text", "doc": {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "hi"}]}]}}]
    post = (await client.post(f"/v1/orgs/{org}/workspaces/{ws}/posts", json={"title": "T", "blocks": blocks})).json()["post"]
    post = (await client.post(f"/v1/orgs/{org}/posts/{post['id']}/publish", json={"version": post["version"]})).json()["post"]
    evil = {"theme": {**THEME["theme"], "accent": "red;background:url(x)", "bodyFont": "Arial</style>", "extra": 1}}
    r = await client.patch(f"/v1/orgs/{org}/posts/{post['id']}", json={"version": post["version"], "presentation": evil})
    assert r.status_code == 200, r.text
    after = r.json()["post"]
    assert after["presentation"] == {"theme": {"background": "#0f172a", "heading": "#ffffff", "text": "#e2e8f0", "headingFont": "Georgia", "name": "Midnight"}}
    assert after["revision"] == post["revision"]  # a theme change isn't a content edit
    r = await client.patch(f"/v1/orgs/{org}/posts/{post['id']}", json={"version": after["version"], "presentation": None})
    assert "presentation" not in r.json()["post"]


async def test_notebook_theme(client):
    org, ws = ids(await signup(client, "ada@example.test"))
    nb = (await client.post(f"/v1/orgs/{org}/workspaces/{ws}/collections", json={"name": "Talk", "kind": "notebook", "postIds": []})).json()
    r = await client.patch(f"/v1/orgs/{org}/workspaces/{ws}/collections/{nb['id']}", json={"presentation": THEME})
    assert r.status_code == 200, r.text
    assert r.json()["presentation"]["theme"]["accent"] == "#2dd4bf"
