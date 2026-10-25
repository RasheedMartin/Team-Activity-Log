"""Files attached to posts: stored once, text searchable, downloadable by people who can see the post."""

from sqlalchemy import select
from test_collections import add_member, login  # noqa: I001 (sibling test modules)
from test_documents import docx, text_pdf
from test_plans_and_avatars import signup

from tal import models as m
from tal.attachments import extract_text
from tal.db import sessionmaker
from tal.search.documents import build_documents


def test_text_comes_out_of_common_files():
    assert "Calibration table" in extract_text(text_pdf(["Calibration table"]), "a.pdf")
    assert "We cooled it." in extract_text(docx([("Heading1", "Method"), ("", "We cooled it.")]), "b.docx")
    assert extract_text(b"run,gain\n4512,1.02\n", "c.csv").startswith("run,gain")
    assert extract_text(b"\x00\x01", "d.bin") is None


async def test_attach_a_file_to_a_post(client):
    me = await signup(client, "attach@example.test")
    org, ws = me["orgs"][0]["org"]["id"], me["orgs"][0]["workspaces"][0]["id"]
    data = text_pdf(["Vendor datasheet for preamp X7"])
    r = await client.post(f"/v1/orgs/{org}/attachments", params={"filename": "datasheet.pdf"}, content=data, headers={"content-type": "application/pdf"})
    assert r.status_code == 201, r.text
    att = r.json()
    assert att["searchable"] and att["bytes"] == len(data)
    again = (await client.post(f"/v1/orgs/{org}/attachments", params={"filename": "copy.pdf"}, content=data)).json()
    assert again["id"] == att["id"]  # stored once
    assert (await client.post(f"/v1/orgs/{org}/attachments", params={"filename": "run.exe"}, content=b"MZ")).status_code == 415

    blocks = [{"id": "f1", "type": "file", "attachmentId": att["id"]}]
    post = (await client.post(f"/v1/orgs/{org}/workspaces/{ws}/posts", json={"title": "Preamp notes", "blocks": blocks})).json()
    assert post["attachments"][0]["filename"] == "datasheet.pdf"
    await client.post(f"/v1/orgs/{org}/posts/{post['post']['id']}/publish", json={})
    async with sessionmaker()() as s:
        p = (await s.execute(select(m.Post).where(m.Post.title == "Preamp notes"))).scalar_one()
        docs, _ = await build_documents(s, [p.id])
    assert "preamp X7" in docs[p.id]["body"]  # the file's text is searchable

    await add_member(client, org, "reader@example.test")
    dl = await client.get(f"/v1/orgs/{org}/attachments/{att['id']}")
    assert dl.status_code == 200 and dl.content == data and "datasheet.pdf" in dl.headers["content-disposition"]

    # A file only in someone's draft isn't downloadable by others.
    await login(client, "attach@example.test")
    hidden = (await client.post(f"/v1/orgs/{org}/attachments", params={"filename": "secret.csv"}, content=b"a,b\n1,2\n")).json()
    await client.post(f"/v1/orgs/{org}/workspaces/{ws}/posts", json={"title": "Draft", "blocks": [{"id": "f2", "type": "file", "attachmentId": hidden["id"]}]})
    await login(client, "reader@example.test")
    assert (await client.get(f"/v1/orgs/{org}/attachments/{hidden['id']}")).status_code == 404
