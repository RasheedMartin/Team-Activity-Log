"""Sheets v2: edit cells, rows, and columns; start a blank sheet; replace the data with a new file
and keep charts; who may edit."""

from test_plans_and_avatars import signup  # noqa: I001 (sibling test module)
from test_collections import add_member, login  # noqa: I001

CSV = b"run,date,channel,gain\n4512,2026-03-01,A,1.02\n4513,2026-03-02,A,1.04\n4514,2026-03-03,B,0.99\n"
CSV2 = b"run,channel,gain,noise\n4515,A,1.01,0.2\n4516,C,1.07,0.4\n"


async def test_edit_a_sheet(client):
    me = await signup(client, "edit@example.test")
    org, ws = me["orgs"][0]["org"]["id"], me["orgs"][0]["workspaces"][0]["id"]
    s = (await client.post(f"/v1/orgs/{org}/workspaces/{ws}/sheets", params={"filename": "runs.csv"}, content=CSV)).json()
    assert s["canEdit"] and s["hasOriginal"] and s["editAccess"] == "owner"
    tab = s["tabList"][0]
    base = f"/v1/orgs/{org}/sheets/{s['id']}/tabs/{tab['id']}"
    data = (await client.get(f"{base}/rows")).json()
    ids = data["ids"]
    assert len(ids) == 3 and data["rows"][0][0] == 4512

    # Cells keep their column's type; a wrong one is refused with a reason.
    r = await client.patch(f"{base}/rows", json={"ops": [{"op": "set", "id": ids[0], "col": "c3", "value": "n/a"}]})
    assert r.status_code == 422 and "isn't a number" in r.json()["message"]
    r = (await client.patch(f"{base}/rows", json={"ops": [{"op": "set", "id": ids[0], "col": "c3", "value": "1,005"}]})).json()
    assert r["rows"] == [{"id": ids[0], "cells": [4512, "2026-03-01", "A", 1005]}]

    # Insert after a row, delete one: only what changed comes back.
    r = (await client.patch(f"{base}/rows", json={"ops": [{"op": "insert", "after": ids[0], "cells": {"c0": "4600", "c2": "C"}}, {"op": "delete", "ids": [ids[2]]}]})).json()
    new = r["inserted"][0]
    assert new["after"] == ids[0] and new["cells"][:3] == [4600, None, "C"] and r["deleted"] == [ids[2]] and r["rowCount"] == 3
    order = (await client.get(f"{base}/rows")).json()["ids"]
    assert order == [ids[0], new["id"], ids[1]]

    # Undo of a delete puts rows back where they were: first, or several after one row (last-first).
    r = (await client.patch(f"{base}/rows", json={"ops": [{"op": "insert", "first": True, "cells": {"c0": "1"}}, {"op": "insert", "after": ids[1], "cells": {"c0": "3"}}, {"op": "insert", "after": ids[1], "cells": {"c0": "2"}}]})).json()
    one, three, two = (x["id"] for x in r["inserted"])
    assert [x["after"] for x in r["inserted"]] == [None, two, ids[1]]
    assert (await client.get(f"{base}/rows")).json()["ids"] == [one, ids[0], new["id"], ids[1], two, three]
    await client.patch(f"{base}/rows", json={"ops": [{"op": "delete", "ids": [one, two, three]}]})

    # Columns: add (follows what's typed), rename, type, delete.
    t = (await client.patch(f"{base}/columns", json={"ops": [{"op": "add", "name": "Noise"}]})).json()
    noise = t["columns"][-1]
    assert noise["auto"] and noise["key"] == "c4"
    r = (await client.patch(f"{base}/rows", json={"ops": [{"op": "set", "id": i, "col": "c4", "value": v} for i, v in zip(order, ["0.2", "0.3", "0.25"], strict=True)]})).json()
    assert r["retyped"] and next(c for c in r["columns"] if c["key"] == "c4")["type"] == "number"
    r = await client.patch(f"{base}/columns", json={"ops": [{"op": "type", "key": "c2", "type": "number"}]})
    assert r.status_code == 422 and "Row 1" in r.json()["message"]
    t = (await client.patch(f"{base}/columns", json={"ops": [{"op": "rename", "key": "c3", "name": "Gain (dB)"}, {"op": "type", "key": "c2", "type": "text"}]})).json()
    assert [c["name"] for c in t["columns"]][3] == "Gain (dB)"

    chart = (await client.post(f"/v1/orgs/{org}/sheets/{s['id']}/charts", json={"tabId": tab["id"], "name": "Gain", "spec": {"type": "line", "x": "c0", "y": ["c3"], "agg": "none"}})).json()
    r = await client.patch(f"{base}/columns", json={"ops": [{"op": "delete", "key": "c3"}]})
    assert r.status_code == 409 and "“Gain”" in r.json()["message"]
    t = (await client.patch(f"{base}/columns", json={"ops": [{"op": "delete", "key": "c1"}]})).json()
    assert "c1" not in [c["key"] for c in t["columns"]]
    t = (await client.patch(f"{base}/columns", json={"ops": [{"op": "add"}]})).json()
    assert t["columns"][-1]["key"] == "c5"  # keys are never reused

    # Search reads edits.
    await client.patch(f"{base}/rows", json={"ops": [{"op": "set", "id": order[0], "col": "c2", "value": "Zeppelin"}]})
    assert [x["id"] for x in (await client.get(f"/v1/orgs/{org}/workspaces/{ws}/sheets", params={"q": "zeppelin"})).json()] == [s["id"]]

    # Replace with a new version: columns match by name and keep their keys, so the chart lives.
    r = (await client.post(f"/v1/orgs/{org}/sheets/{s['id']}/replace", params={"filename": "runs_v2.csv"}, content=CSV2.replace(b"gain,", b"Gain (dB),"))).json()
    assert r["filename"] == "runs_v2.csv" and r["tabList"][0]["id"] == tab["id"] and r["removedCharts"] == 0 and r["brokenCharts"] == []
    cols = {c["name"]: c["key"] for c in r["tabList"][0]["columns"]}
    assert cols["run"] == "c0" and cols["Gain (dB)"] == "c3" and cols["noise"] == "c4"  # matched the Noise column added earlier
    assert (await client.get(f"{base}/rows")).json()["rows"][1][3] == 1.07
    assert (await client.get(f"/v1/orgs/{org}/sheets/{s['id']}")).json()["charts"][0]["id"] == chart["id"]


async def test_blank_sheet_and_who_edits(client):
    me = await signup(client, "owner@example.test")
    org, ws = me["orgs"][0]["org"]["id"], me["orgs"][0]["workspaces"][0]["id"]
    s = (await client.post(f"/v1/orgs/{org}/workspaces/{ws}/sheets/blank", json={"name": "Shift log"})).json()
    assert not s["hasOriginal"] and s["rows"] == 5 and [c["name"] for c in s["tabList"][0]["columns"]] == ["Column 1", "Column 2", "Column 3"]
    assert (await client.get(f"/v1/orgs/{org}/sheets/{s['id']}/original")).status_code == 404

    await add_member(client, org, "colleague@example.test")
    tab = s["tabList"][0]
    ids = (await client.get(f"/v1/orgs/{org}/sheets/{s['id']}/tabs/{tab['id']}/rows")).json()["ids"]
    edit = {"ops": [{"op": "set", "id": ids[0], "col": "c0", "value": "hello"}]}
    assert (await client.patch(f"/v1/orgs/{org}/sheets/{s['id']}/tabs/{tab['id']}/rows", json=edit)).status_code == 403
    assert (await client.patch(f"/v1/orgs/{org}/sheets/{s['id']}", json={"editAccess": "workspace"})).status_code == 403

    await login(client, "owner@example.test")
    assert (await client.patch(f"/v1/orgs/{org}/sheets/{s['id']}", json={"editAccess": "workspace"})).json()["editAccess"] == "workspace"
    await login(client, "colleague@example.test")
    assert (await client.patch(f"/v1/orgs/{org}/sheets/{s['id']}/tabs/{tab['id']}/rows", json=edit)).status_code == 200


async def test_a_csv_replaces_only_the_open_tab(client):
    """A CSV has no tab names: it's a new version of the open tab (else the first); other tabs stay."""
    from pathlib import Path

    me = await signup(client, "csvtab@example.test")
    org, ws = me["orgs"][0]["org"]["id"], me["orgs"][0]["workspaces"][0]["id"]
    book = (Path(__file__).parents[2] / "frontend" / "e2e" / "fixtures" / "Gain_Runs.xlsx").read_bytes()
    s = (await client.post(f"/v1/orgs/{org}/workspaces/{ws}/sheets", params={"filename": "Gain_Runs.xlsx"}, content=book)).json()
    runs, cal = s["tabList"]
    assert (runs["name"], cal["name"]) == ("Runs", "Calibration")

    r = (await client.post(f"/v1/orgs/{org}/sheets/{s['id']}/replace", params={"filename": "cal.csv", "tab": "calibration"}, content=b"Owner,Calibrated,Instrument\nLee,2026-05-01,Laser\n")).json()
    assert [(t["id"], t["name"], t["rowCount"]) for t in r["tabList"]] == [(runs["id"], "Runs", 40), (cal["id"], "Calibration", 1)]
    cols = {c["name"]: c["key"] for c in r["tabList"][1]["columns"]}
    assert cols == {"Owner": "c2", "Calibrated": "c1", "Instrument": "c0"}  # matched by name, keys kept

    # No tab given: the first tab.
    r = (await client.post(f"/v1/orgs/{org}/sheets/{s['id']}/replace", params={"filename": "runs.csv"}, content=b"Run,Gain\n5000,1.1\n")).json()
    assert [(t["id"], t["rowCount"]) for t in r["tabList"]] == [(runs["id"], 1), (cal["id"], 1)]
