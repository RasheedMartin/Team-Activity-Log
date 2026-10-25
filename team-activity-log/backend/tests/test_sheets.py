"""Sheets: .xlsx and .csv become typed tables; charts are saved and embeddable; search reads them."""

import io
import zipfile

from sqlalchemy import select
from test_plans_and_avatars import signup  # noqa: I001 (sibling test module)

from tal import models as m
from tal.db import sessionmaker
from tal.search.documents import build_documents
from tal.sheets import parse_sheet

CSV = b"run,date,channel,gain\n4512,2026-03-01,A,1.02\n4513,2026-03-02,A,1.04\n4514,2026-03-03,B,0.99\n"


def xlsx() -> bytes:
    """A one-sheet workbook: header row (shared strings), numbers, and a date-formatted cell."""
    ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    rel = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr("xl/workbook.xml", f'<workbook {ns} {rel}><sheets><sheet name="Runs" sheetId="1" r:id="rId1"/></sheets></workbook>')
        z.writestr("xl/_rels/workbook.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>')
        z.writestr("xl/sharedStrings.xml", f'<sst {ns}><si><t>run</t></si><si><t>date</t></si><si><t>gain</t></si></sst>')
        z.writestr("xl/styles.xml", f'<styleSheet {ns}><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>')
        rows = '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>'
        rows += '<row r="2"><c r="A2"><v>4512</v></c><c r="B2" s="1"><v>46082</v></c><c r="C2"><v>1.02</v></c></row>'
        z.writestr("xl/worksheets/sheet1.xml", f"<worksheet {ns}><sheetData>{rows}</sheetData></worksheet>")
    return out.getvalue()


def test_csv_and_xlsx_become_typed_tables():
    [t] = parse_sheet(CSV, "runs.csv")
    assert [(c["name"], c["type"]) for c in t.columns] == [("run", "number"), ("date", "date"), ("channel", "category"), ("gain", "number")]
    assert t.rows[0] == [4512.0, "2026-03-01", "A", 1.02]
    [x] = parse_sheet(xlsx(), "runs.xlsx")
    assert x.name == "Runs" and [c["type"] for c in x.columns] == ["number", "date", "number"]
    assert x.rows[0][1] == "2026-03-01"  # an Excel date serial, read as a date


async def test_import_chart_embed_search(client):
    me = await signup(client, "sheets@example.test")
    org, ws = me["orgs"][0]["org"]["id"], me["orgs"][0]["workspaces"][0]["id"]
    r = await client.post(f"/v1/orgs/{org}/workspaces/{ws}/sheets", params={"filename": "gain_runs.csv"}, content=CSV)
    assert r.status_code == 201, r.text
    s = r.json()
    assert s["name"] == "gain_runs" and s["rows"] == 3 and len(s["tabList"]) == 1
    tab = s["tabList"][0]
    rows = (await client.get(f"/v1/orgs/{org}/sheets/{s['id']}/tabs/{tab['id']}/rows")).json()["rows"]
    assert len(rows) == 3
    assert [x["name"] for x in (await client.get(f"/v1/orgs/{org}/workspaces/{ws}/sheets", params={"q": "channel"})).json()] == ["gain_runs"]

    spec = {"type": "line", "x": "c1", "y": ["c3"], "agg": "avg"}
    chart = (await client.post(f"/v1/orgs/{org}/sheets/{s['id']}/charts", json={"tabId": tab["id"], "name": "Gain over time", "spec": spec})).json()
    assert chart["spec"] == spec
    assert (await client.post(f"/v1/orgs/{org}/sheets/{s['id']}/charts", json={"tabId": tab["id"], "name": "Bad", "spec": {"x": "nope", "y": []}})).status_code == 422

    blocks = [{"id": "c", "type": "chart", "sheetId": s["id"], "chartId": chart["id"]}]
    post = (await client.post(f"/v1/orgs/{org}/workspaces/{ws}/posts", json={"title": "Weekly gain", "blocks": blocks})).json()["post"]
    assert post["blocks"][0]["type"] == "chart"
    await client.patch(f"/v1/orgs/{org}/posts/{post['id']}", json={"version": post["version"], "blocks": [*blocks, {"id": "t", "type": "text", "doc": {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "see chart"}]}]}}]})
    assert (await client.post(f"/v1/orgs/{org}/posts/{post['id']}/publish", json={})).status_code == 200
    async with sessionmaker()() as db:
        p = (await db.execute(select(m.Post).where(m.Post.title == "Weekly gain"))).scalar_one()
        docs, _ = await build_documents(db, [p.id])
    assert "Gain over time" in docs[p.id]["body"] and "gain_runs" in docs[p.id]["body"]

    assert (await client.get(f"/v1/orgs/{org}/sheets/{s['id']}/original")).content == CSV
    assert (await client.delete(f"/v1/orgs/{org}/sheets/{s['id']}")).status_code == 204
