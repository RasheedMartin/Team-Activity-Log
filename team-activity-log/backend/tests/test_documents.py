"""Document import: PDF pages and Word sections become notebook pages; originals are kept and
downloadable; text is searchable (a PDF page's text rides on its picture)."""

import io
import zipfile

from tal.docs import parse_docx, parse_pdf
from test_plans_and_avatars import signup  # noqa: I001 (sibling test module)


def text_pdf(pages: list[str]) -> bytes:
    """A minimal PDF with one line of Helvetica text per page."""
    objs = ["<< /Type /Catalog /Pages 2 0 R >>", ""]
    kids = []
    for i, text in enumerate(pages):
        page_no, content_no = 3 + i * 2, 4 + i * 2
        kids.append(f"{page_no} 0 R")
        stream = f"BT /F1 24 Tf 72 700 Td ({text}) Tj ET"
        objs.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents {content_no} 0 R /Resources << /Font << /F1 {3 + len(pages) * 2} 0 R >> >> >>")
        objs.append(f"<< /Length {len(stream)} >>\nstream\n{stream}\nendstream")
    objs[1] = f"<< /Type /Pages /Kids [{' '.join(kids)}] /Count {len(pages)} >>"
    objs.append("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    out, offsets = io.BytesIO(), []
    out.write(b"%PDF-1.4\n")
    for n, body in enumerate(objs, 1):
        offsets.append(out.tell())
        out.write(f"{n} 0 obj\n{body}\nendobj\n".encode())
    xref = out.tell()
    out.write(f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode())
    for off in offsets:
        out.write(f"{off:010d} 00000 n \n".encode())
    out.write(f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF".encode())
    return out.getvalue()


def docx(paragraphs: list[tuple[str, str]]) -> bytes:
    """A minimal .docx: [(style, text)], style "" for body text."""
    W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
    style = '<w:pPr><w:pStyle w:val="{}"/></w:pPr>'
    body = "".join(f"<w:p>{style.format(st) if st else ''}<w:r><w:t>{t}</w:t></w:r></w:p>" for st, t in paragraphs)
    styles = f'<w:styles xmlns:w="{W}"><w:style w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>'
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
        z.writestr("word/document.xml", f'<w:document xmlns:w="{W}"><w:body>{body}</w:body></w:document>')
        z.writestr("word/styles.xml", styles)
    return out.getvalue()


def test_pdf_pages_keep_their_text():
    deck = parse_pdf(text_pdf(["Cooldown curve run 4512", "Gain drift on channel 12"]))
    assert [s.title for s in deck.slides] == ["Cooldown curve run 4512", "Gain drift on channel 12"]
    assert deck.slides[1].images[0].text == "Gain drift on channel 12"  # searchable without OCR


def test_word_headings_split_into_pages():
    deck = parse_docx(docx([("", "Intro line"), ("Heading1", "Method"), ("", "We cooled it."), ("Heading1", "Results"), ("", "It worked.")]))
    assert [s.title for s in deck.slides] == ["Intro line", "Method", "Results"]
    assert "We cooled it." in deck.slides[1].text


async def test_pdf_import_makes_a_notebook_and_keeps_the_original(client):
    import asyncio

    me = await signup(client, "docs@example.test")
    org, ws = me["orgs"][0]["org"]["id"], me["orgs"][0]["workspaces"][0]["id"]
    data = text_pdf(["Detector B noise study", "Shielding results"])
    job = (await client.post(f"/v1/orgs/{org}/workspaces/{ws}/imports", json={"filename": "noise.pdf", "bytes": len(data), "mode": "per_slide", "defaults": {"collectionName": "Noise study"}})).json()
    await client.put(f"/v1/orgs/{org}/imports/{job['id']}/upload", content=data)
    for _ in range(50):
        j = (await client.get(f"/v1/orgs/{org}/imports/{job['id']}")).json()
        if j["status"] != "parsing":
            break
        await asyncio.sleep(0.1)
    assert j["status"] == "review" and len(j["items"]) == 2
    done = (await client.post(f"/v1/orgs/{org}/imports/{job['id']}/commit", json={})).json()
    coll = (await client.get(f"/v1/orgs/{org}/workspaces/{ws}/collections/{done['collectionId']}")).json()
    assert coll["kind"] == "notebook" and coll["name"] == "Noise study" and len(coll["postIds"]) == 2

    r = await client.get(f"/v1/orgs/{org}/imports/{job['id']}/original")
    assert r.status_code == 200 and r.content == data and "noise.pdf" in r.headers["content-disposition"]

    assert (await client.post(f"/v1/orgs/{org}/workspaces/{ws}/imports", json={"filename": "data.xlsx", "bytes": 10})).status_code == 415


async def test_an_import_can_extend_an_existing_notebook(client):
    import asyncio

    me = await signup(client, "extend@example.test")
    org, ws = me["orgs"][0]["org"]["id"], me["orgs"][0]["workspaces"][0]["id"]
    nb = (await client.post(f"/v1/orgs/{org}/workspaces/{ws}/collections", json={"name": "Lab book", "postIds": []})).json()
    page = (await client.post(f"/v1/orgs/{org}/workspaces/{ws}/posts", json={"collectionId": nb["id"], "title": "My own page"})).json()["post"]

    async def run(data: bytes, name: str) -> dict:
        job = (await client.post(f"/v1/orgs/{org}/workspaces/{ws}/imports", json={"filename": name, "bytes": len(data), "mode": "per_slide", "defaults": {"intoId": nb["id"]}})).json()
        await client.put(f"/v1/orgs/{org}/imports/{job['id']}/upload", content=data)
        for _ in range(50):
            if (await client.get(f"/v1/orgs/{org}/imports/{job['id']}")).json()["status"] != "parsing":
                break
            await asyncio.sleep(0.1)
        return (await client.post(f"/v1/orgs/{org}/imports/{job['id']}/commit", json={})).json()

    a = await run(text_pdf(["First import page"]), "a.pdf")
    b = await run(docx([("Heading1", "Second import")]), "b.docx")
    assert a["collectionId"] == b["collectionId"] == nb["id"]
    view = (await client.get(f"/v1/orgs/{org}/workspaces/{ws}/collections/{nb['id']}")).json()
    assert len(view["postIds"]) == 3 and view["postIds"][0] == page["id"]  # appended after what was there
    assert [x["fileName"] for x in view["sources"]] == ["a.pdf", "b.docx"]

    # Deleting one import keeps the notebook (it holds other things too).
    assert (await client.delete(f"/v1/orgs/{org}/imports/{a['id']}")).status_code == 204
    view = (await client.get(f"/v1/orgs/{org}/workspaces/{ws}/collections/{nb['id']}")).json()
    assert len(view["postIds"]) == 2 and [x["fileName"] for x in view["sources"]] == ["b.docx"]
