"""Text in images (OCR): new images are queued and read, cloud engines are a Business option with
keys that never come back, and text a person corrected survives a re-read."""

import io

import pytest
from PIL import Image, ImageDraw, ImageFont
from test_plans_and_avatars import signup, upload  # noqa: I001 (sibling test module)

from tal import ocr

needs_tesseract = pytest.mark.skipif(not ocr.tesseract_available(), reason="Tesseract isn't installed")


def picture(words: str) -> bytes:
    img = Image.new("RGB", (1000, 240), "white")
    ImageDraw.Draw(img).text((40, 70), words, fill="black", font=ImageFont.load_default(size=64))
    out = io.BytesIO()
    img.save(out, "PNG")
    return out.getvalue()


async def _asset(asset_id: str):
    import uuid

    from tal import models as m
    from tal.db import sessionmaker

    async with sessionmaker()() as s:
        return await s.get(m.Asset, uuid.UUID(asset_id))


@needs_tesseract
async def test_tesseract_reads_a_picture():
    text = await ocr.read("tesseract", picture("Cryostat cooldown 4512"), {})
    assert "Cryostat" in text and "4512" in text


@needs_tesseract
async def test_uploads_are_queued_then_read(client):
    me = await signup(client, "ocr@example.test")
    org = me["orgs"][0]["org"]["id"]
    r = await upload(client, org, picture("Gain drift channel 12"))
    assert r.status_code == 201, r.text
    asset_id = r.json()["id"]
    assert (await _asset(asset_id)).metadata_["ocrState"] == "pending"

    assert await ocr.ocr_once() >= 1
    meta = (await _asset(asset_id)).metadata_
    assert meta["ocrState"] == "ready" and meta["ocrEngine"] == "tesseract"
    assert "drift" in meta["ocrText"] and "12" in meta["ocrText"]

    view = (await client.get(f"/v1/orgs/{org}/ocr")).json()
    assert view["active"] == "tesseract" and view["builtInReady"] is True and view["counts"].get("ready") == 1

    # A person's correction wins, and survives "re-read all".
    r = await client.put(f"/v1/orgs/{org}/assets/{asset_id}/ocr", json={"text": "Gain drift on channel 12, week 3"})
    assert r.json() == {"ocrState": "edited", "ocrText": "Gain drift on channel 12, week 3"}
    assert (await client.post(f"/v1/orgs/{org}/ocr/reread", json={"which": "all"})).json() == {"queued": 0}
    assert (await _asset(asset_id)).metadata_["ocrText"] == "Gain drift on channel 12, week 3"


async def test_cloud_engines_need_business_and_a_working_key(client, monkeypatch):
    from sqlalchemy import update

    from tal import models as m
    from tal.db import sessionmaker

    me = await signup(client, "admin@example.test")
    org = me["orgs"][0]["org"]["id"]
    google = {"provider": "google", "credentials": {"apiKey": "AIzaSyFAKE-key-1234abcd"}}
    r = await client.put(f"/v1/orgs/{org}/ocr", json=google)
    assert r.status_code == 402 and "Business" in r.json()["message"]  # Free (and Team) use the built-in engine

    async with sessionmaker()() as s:
        await s.execute(update(m.Organization).where(m.Organization.id == org).values(plan="business"))
        await s.commit()

    async def bad(provider, creds):
        raise ocr.OcrError("Google Cloud Vision: API key not valid.")

    monkeypatch.setattr(ocr, "check", bad)
    r = await client.put(f"/v1/orgs/{org}/ocr", json=google)
    assert r.status_code == 422 and "API key not valid" in r.json()["message"]

    async def good(provider, creds):
        return None

    monkeypatch.setattr(ocr, "check", good)
    r = await client.put(f"/v1/orgs/{org}/ocr", json=google)
    assert r.status_code == 200, r.text
    v = r.json()
    assert v["provider"] == v["active"] == "google" and v["cloudAllowed"] is True
    assert v["saved"] == {"google": {"apiKey": "…abcd"}}
    assert "AIzaSyFAKE" not in r.text  # the key itself never comes back

    async with sessionmaker()() as s:
        o = await s.get(m.Organization, __import__("uuid").UUID(org))
        assert "AIzaSyFAKE" not in (o.ocr_secret or "")  # stored encrypted
        assert ocr.unseal(o.ocr_secret)["google"]["apiKey"] == "AIzaSyFAKE-key-1234abcd"
        # Downgrading falls back to the built-in engine without losing the key.
        o.plan = "team"
        await s.commit()
    v = (await client.get(f"/v1/orgs/{org}/ocr")).json()
    assert v["provider"] == "google" and v["active"] == "tesseract"

    async with sessionmaker()() as s:
        await s.execute(update(m.Organization).where(m.Organization.id == org).values(plan="business"))
        await s.commit()
    v = (await client.put(f"/v1/orgs/{org}/ocr", json={"provider": "google", "forget": True})).json()
    assert v["provider"] == "tesseract" and v["saved"] == {}


async def test_only_admins_change_ocr(client):
    owner = await signup(client, "owner2@example.test")
    org = owner["orgs"][0]["org"]["id"]
    await signup(client, "outsider@example.test", org=None)
    assert (await client.get(f"/v1/orgs/{org}/ocr")).status_code in (403, 404)
