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


# ---- formatting (Formatting_2024.pptx, from the same generator) ----


@pytest.fixture(scope="module")
def fmt():
    return parse_pptx(FIXTURE.with_name("Formatting_2024.pptx").read_bytes())


def marks_of(nodes, text):
    """Marks on the text node with exactly this text."""
    found = []

    def walk(n):
        if n.get("type") == "text" and n.get("text") == text:
            found.append(n.get("marks", []))
        for c in n.get("content", []):
            walk(c)

    walk({"type": "doc", "content": nodes})
    assert found, text
    return found[0]


def test_reading_order_follows_the_slide_not_z_order(fmt):
    s = fmt.slides[1]
    assert [k for k, _ in s.parts] == ["text", "image", "text"]
    first = doc_text({"type": "doc", "content": s.parts[0][1]})
    assert first.index("Gain stable") < first.index("Right column")  # inherited layout position, then the right column
    assert s.parts[2][1][0] == {"type": "heading", "attrs": {"level": 3}, "content": [{"type": "text", "text": "Big takeaway"}]}  # 36 pt


def test_lists_nest_and_number(fmt):
    bullets, numbered = fmt.slides[1].content[:2]
    assert bullets["content"][0]["content"][1]["type"] == "bulletList"  # lvl=1 nests under the item above
    assert numbered["type"] == "orderedList" and numbered["attrs"] == {"start": 3} and len(numbered["content"]) == 2


def test_colors_links_highlight_strike_alignment(fmt):
    c = fmt.slides[1].content
    assert marks_of(c, "critical") == [{"type": "textStyle", "attrs": {"color": "#c00000"}}]
    assert marks_of(c, " accent") == [{"type": "textStyle", "attrs": {"color": "#c55a11"}}]  # theme accent2, lumMod 75%
    assert marks_of(c, " plain") == []  # black follows the app theme
    assert marks_of(c, "flagged") == [{"type": "highlight", "attrs": {"color": "#ffff00"}}]
    assert marks_of(c, " run log") == [{"type": "link", "attrs": {"href": "https://example.test/run"}}]
    assert marks_of(c, " old value") == [{"type": "strike"}]
    assert c[-1]["attrs"] == {"textAlign": "center"}
    assert fmt.slides[0].content == [{"type": "heading", "attrs": {"level": 3, "textAlign": "center"}, "content": [{"type": "text", "text": "Detector group"}]}]


def test_tables_charts_and_smartart(fmt):
    s = fmt.slides[2]
    table, caption, chart, smart = s.content
    assert table["content"][0]["content"] == [{"type": "tableHeader", "attrs": {"colspan": 2}, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Run summary"}]}]}]
    assert doc_text({"type": "doc", "content": [table]}).split() == ["Run", "summary", "Gain", "1.02", "stable"]
    assert doc_text(caption) == "Gain by channel"
    assert doc_text(chart).split() == ["Run", "A", "Run", "B", "Ch", "12", "1.02", "1.01", "Ch", "13", "0.98", "0.97"]
    assert doc_text(smart).split() == ["Plan", "Build", "Test"]
    assert s.warnings == ["Chart imported as a table of its data", "SmartArt imported as a list"]


def test_matches_the_shared_expectation(fmt):
    """frontend/src/mock/pptx.test.ts checks the mock parser against the same file, so the two
    parsers can't drift. After an intended change, regenerate it from this parser."""
    expected = json.loads(FIXTURE.with_name("Formatting_2024.expected.json").read_text())
    got = [{"title": s.title, "warnings": s.warnings, "parts": [{"kind": "text", "content": p} if k == "text" else {"kind": "image", "index": p} for k, p in s.parts]} for s in fmt.slides]
    assert got == expected
