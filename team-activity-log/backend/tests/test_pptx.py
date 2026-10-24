"""Same expectations as frontend/src/mock/pptx.test.ts, on the same fixture deck."""

import json
from pathlib import Path

import pytest

from tal.pptx import PptxError, guess_date, parse_pptx
from tal.prosemirror import doc_text

FIXTURE = Path(__file__).resolve().parents[2] / "frontend" / "e2e" / "fixtures" / "Lab_Notes_2021.pptx"


@pytest.fixture(scope="module")
def deck():
    return parse_pptx(FIXTURE.read_bytes())


def test_order_titles_sections_notes_pictures(deck):
    assert [s.title for s in deck.slides] == ["Cooldown overview", "Cooldown curve", "", "Calibration results", "Gain plot", "Calibration issues", "Analysis summary", "Next steps"]
    assert deck.has_sections
    assert [s.section for s in deck.slides] == ["Cooldown", "Cooldown", "Cooldown", "Calibration", "Calibration", "Calibration", "Analysis", "Analysis"]
    assert deck.slides[0].notes == "Mention the pump schedule"
    assert len(deck.slides[1].images) == 1
    assert deck.slides[1].images[0].mime == "image/png"


def test_bullets_emphasis_tables(deck):
    assert deck.slides[0].content[0]["type"] == "bulletList"
    assert '"bold"' in json.dumps(deck.slides[0].content)
    assert '"italic"' in json.dumps(deck.slides[5].content)
    assert deck.slides[3].content[0]["type"] == "table"
    assert "1.02" in doc_text({"type": "doc", "content": deck.slides[3].content})


def test_dates(deck):
    assert [s.date for s in deck.slides] == ["2024-03-12", None, "2024-03-14", "2024-03-20", None, None, "2024-03-28", None]
    assert guess_date("no date here, run 4512") is None


def test_warnings(deck):
    assert "Animations not preserved" in deck.slides[1].warnings
    assert "No title on this slide" in deck.slides[2].warnings
    assert "Chart not converted (export it as an image)" in deck.slides[4].warnings
    assert "Slide transition not preserved" in deck.slides[7].warnings


def test_rejects_non_presentations():
    with pytest.raises(PptxError, match="isn't a valid .pptx"):
        parse_pptx(bytes(4000))
