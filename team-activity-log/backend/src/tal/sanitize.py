"""Input sanitizing at the boundary. Everything people type is stored only after passing here.

- Text: must be a string; Unicode-normalized; control characters removed (newlines and tabs kept
  where multi-line text is allowed); trimmed; length-capped. Too long -> 422, never silently cut.
- Rich text (ProseMirror JSON): rebuilt from an allow-list of the node types, marks, and
  attributes our editors produce (TipTap StarterKit + tables + mentions). Unknown nodes and marks
  are dropped; links keep only http(s)/mailto hrefs, so `javascript:` can never reach a browser.
  Size and depth are capped.
- Ids, lists, numbers, colors, dates, time zones: parsed strictly, with caps on counts.

The frontend renders through React (escaped) and TipTap (schema-checked); this is the server's
own guarantee, because API callers don't have to be our frontend.
"""

from __future__ import annotations

import datetime as dt
import json
import math
import re
import unicodedata
import uuid
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .errors import fail
from .ids import parse_uuid

_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f​-‏‪-‮⁦-⁩﻿]")
_CONTROL_SINGLE = re.compile(r"[\x00-\x1f\x7f​-‏‪-‮⁦-⁩﻿]")
EMAIL_RE = re.compile(r"^[^\s@<>()\[\],;:\"]+@[^\s@<>()\[\],;:\"]+\.[^\s@<>()\[\],;:\"]+$")
HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{3,8}$")
FIELD_KEY = re.compile(r"^[A-Za-z0-9 _.\-]{1,64}$")


def invalid(field: str, message: str) -> None:
    fail(422, "invalid", message, {"field": field})


# ---------------------------------------------------------------- text


def text(value: Any, field: str, max_len: int, *, multiline: bool = False, required: bool = False, label: str | None = None) -> str | None:
    """A clean string, or None when absent/blank and not required."""
    name = label or field
    if value is None:
        if required:
            invalid(field, f"{name} is required")
        return None
    if not isinstance(value, str):
        invalid(field, f"{name} must be text")
    s = unicodedata.normalize("NFC", value)
    s = (_CONTROL if multiline else _CONTROL_SINGLE).sub("", s).replace("\r\n", "\n").strip()
    if not s:
        if required:
            invalid(field, f"{name} can't be empty")
        return None
    if len(s) > max_len:
        invalid(field, f"{name} must be at most {max_len} characters")
    return s


def email(value: Any, field: str = "email") -> str:
    s = text(value, field, 254, required=True, label="Email") or ""
    if not EMAIL_RE.match(s):
        invalid(field, "Enter a valid email")
    return s


def password(value: Any, field: str = "password") -> str:
    if not isinstance(value, str):
        invalid(field, "Enter a password")
    if len(value) < 8:
        fail(422, "weak_password", "Use at least 8 characters")
    if len(value) > 256:  # hashing very long inputs is a denial-of-service vector
        invalid(field, "Use at most 256 characters")
    return value


def timezone(value: Any, field: str = "timezone") -> str | None:
    s = text(value, field, 64)
    if s is None:
        return None
    try:
        ZoneInfo(s)
    except (ZoneInfoNotFoundError, ValueError):
        invalid(field, "Unknown time zone")
    return s


def iso_date(value: Any, field: str) -> dt.date:
    try:
        d = dt.date.fromisoformat(str(value)[:10]) if isinstance(value, str) else None
    except ValueError:
        d = None
    if not d or not (1900 <= d.year <= 2200):
        invalid(field, "Enter a valid date (YYYY-MM-DD)")
    return d  # type: ignore[return-value]


def color(value: Any, field: str = "color") -> str:
    if not isinstance(value, str) or not HEX_COLOR.match(value):
        invalid(field, "Use a hex color like #2563eb")
    return value


def number(value: Any, field: str, lo: float, hi: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not lo <= value <= hi:
        invalid(field, f"{field} must be a number between {lo} and {hi}")
    return float(value)


def uuid_list(value: Any, field: str, max_items: int) -> list[uuid.UUID]:
    if value is None:
        return []
    if not isinstance(value, list):
        invalid(field, f"{field} must be a list")
    if len(value) > max_items:
        invalid(field, f"At most {max_items} items in {field}")
    return list(dict.fromkeys(u for u in (parse_uuid(x) for x in value) if u))


def string_list(value: Any, field: str, max_items: int, max_len: int) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list) or len(value) > max_items:
        invalid(field, f"{field} must be a list of at most {max_items} items")
    return list(dict.fromkeys(s for s in (text(x, field, max_len) for x in value) if s))


def json_size(value: Any, field: str, max_bytes: int) -> Any:
    if len(json.dumps(value, separators=(",", ":"))) > max_bytes:
        invalid(field, f"{field} is too large")
    return value


# ---------------------------------------------------------------- rich text

NODES: dict[str, set[str]] = {
    "doc": set(),
    "paragraph": {"textAlign"},
    "text": set(),
    "heading": {"level", "textAlign"},
    "blockquote": set(),
    "bulletList": set(),
    "orderedList": {"start", "type"},
    "listItem": set(),
    "codeBlock": {"language"},
    "hardBreak": set(),
    "horizontalRule": set(),
    "table": set(),
    "tableRow": set(),
    "tableCell": {"colspan", "rowspan", "colwidth"},
    "tableHeader": {"colspan", "rowspan", "colwidth"},
    "mention": {"id", "label", "mentionSuggestionChar"},
}
MARKS: dict[str, set[str]] = {"bold": set(), "italic": set(), "underline": set(), "strike": set(), "code": set(), "link": {"href"}, "textStyle": {"color"}, "highlight": {"color"}}
ALIGNMENTS = {"left", "center", "right", "justify"}
HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")
SAFE_HREF = re.compile(r"^(https?://|mailto:)", re.I)
MAX_DEPTH = 40
MAX_NODES = 20_000
MAX_TEXT = 300_000


def _attr(node_type: str, key: str, v: Any) -> Any:
    if key in ("level",):
        return int(v) if isinstance(v, int) and 1 <= v <= 6 else None
    if key in ("start", "colspan", "rowspan"):
        return int(v) if isinstance(v, int) and 0 <= v <= 10_000 else None
    if key == "colwidth":
        return [int(x) for x in v if isinstance(x, int) and 0 <= x <= 10_000][:100] if isinstance(v, list) else None
    if key == "href":
        s = v.strip() if isinstance(v, str) else ""
        return s[:2048] if SAFE_HREF.match(s) and not _CONTROL_SINGLE.search(s) else None
    if key == "textAlign":
        return v if v in ALIGNMENTS else None
    if key == "color":
        return v.lower() if isinstance(v, str) and HEX_COLOR.match(v) else None  # never a CSS expression
    if key in ("id",):
        return str(v)[:64] if isinstance(v, str) and parse_uuid(v) else None
    if isinstance(v, str):
        return _CONTROL_SINGLE.sub("", v)[:200]
    return None


def doc(value: Any, field: str = "doc") -> dict:
    """A ProseMirror document rebuilt from the allow-list."""
    budget = {"nodes": 0, "text": 0}

    def walk(n: Any, depth: int) -> dict | None:
        if not isinstance(n, dict) or n.get("type") not in NODES:
            return None
        budget["nodes"] += 1
        if budget["nodes"] > MAX_NODES or depth > MAX_DEPTH:
            invalid(field, "This text is too large or too deeply nested")
        t = n["type"]
        out: dict[str, Any] = {"type": t}
        attrs = n.get("attrs") if isinstance(n.get("attrs"), dict) else {}
        clean = {k: _attr(t, k, attrs[k]) for k in NODES[t] if k in attrs}
        clean = {k: v for k, v in clean.items() if v is not None}
        if t == "mention" and "id" not in clean:
            return {"type": "text", "text": f"@{clean.get('label', 'someone')}"}  # broken mention -> plain text
        if clean:
            out["attrs"] = clean
        if t == "text":
            s = n.get("text")
            if not isinstance(s, str) or not s:
                return None
            s = unicodedata.normalize("NFC", _CONTROL.sub("", s))
            budget["text"] += len(s)
            if budget["text"] > MAX_TEXT:
                invalid(field, "This text is too long")
            out["text"] = s
            marks = []
            for mk in n.get("marks") or []:
                if isinstance(mk, dict) and mk.get("type") in MARKS:
                    ma = mk.get("attrs") if isinstance(mk.get("attrs"), dict) else {}
                    mclean = {k: _attr(mk["type"], k, ma[k]) for k in MARKS[mk["type"]] if k in ma}
                    if (mk["type"] == "link" and not mclean.get("href")) or (mk["type"] in ("textStyle", "highlight") and not mclean.get("color")):
                        continue  # unsafe or missing value: keep the text, drop the mark
                    marks.append({"type": mk["type"], **({"attrs": {k: v for k, v in mclean.items() if v is not None}} if mclean else {})})
            if marks:
                out["marks"] = marks
            return out
        content = [c for c in (walk(c, depth + 1) for c in (n.get("content") or []) if isinstance(n.get("content"), list)) if c]
        if content:
            out["content"] = content
        return out

    if value is None:
        return {"type": "doc", "content": [{"type": "paragraph"}]}
    root = walk(value, 0)
    if not root or root["type"] != "doc":
        invalid(field, "Text must be a document")
    return root  # type: ignore[return-value]


BLOCK_TYPES = {"text", "table", "image", "slide_break"}


def blocks(value: Any, field: str = "blocks") -> list[dict]:
    if not isinstance(value, list):
        invalid(field, "blocks must be a list")
    if len(value) > 1000:
        invalid(field, "A post can have at most 1,000 blocks")
    out = []
    for b in value:
        if not isinstance(b, dict) or b.get("type") not in BLOCK_TYPES:
            continue
        bid = text(b.get("id"), f"{field}.id", 64) or ""
        if b["type"] in ("text", "table"):
            out.append({"id": bid, "type": b["type"], "doc": doc(b.get("doc"), f"{field}.doc")})
        elif b["type"] == "image":
            iid = parse_uuid(b.get("imageInstanceId"))
            if iid:
                out.append({"id": bid, "type": "image", "imageInstanceId": str(iid)})
        else:
            notes = text(b.get("notes"), f"{field}.notes", 10_000, multiline=True)
            out.append({"id": bid, "type": "slide_break", **({"notes": notes} if notes else {})})
    return out


# ---------------------------------------------------------------- images & annotations

TOOLS = {"pen", "line", "rect", "ellipse", "arrow", "text", "highlight"}


def shapes(value: Any, field: str = "shapes") -> list[dict]:
    if not isinstance(value, list) or len(value) > 2000:
        invalid(field, "At most 2,000 shapes per image")
    out = []
    for s in value:
        if not isinstance(s, dict) or s.get("tool") not in TOOLS:
            continue
        pts = s.get("points")
        if not isinstance(pts, list) or not 1 <= len(pts) <= 10_000:
            continue
        clean_pts = []
        for p in pts:
            if isinstance(p, list) and len(p) == 2:
                clean_pts.append([number(p[0], "point", -1, 2), number(p[1], "point", -1, 2)])
        shape = {
            "id": text(s.get("id"), "shape.id", 64) or "",
            "tool": s["tool"],
            "color": color(s.get("color"), "shape.color"),
            "opacity": number(s.get("opacity", 1), "shape.opacity", 0, 1),
            "size": number(s.get("size", 0.003), "shape.size", 0, 1),
            "points": clean_pts,
        }
        t = text(s.get("text"), "shape.text", 500)
        if t:
            shape["text"] = t
        out.append(shape)
    return out


def custom_fields(value: Any, field: str = "customFields") -> dict[str, str]:
    if value is None:
        return {}
    if not isinstance(value, dict) or len(value) > 50:
        invalid(field, "At most 50 custom fields")
    out = {}
    for k, v in value.items():
        if not isinstance(k, str) or not FIELD_KEY.match(k):
            invalid(field, "Field names may use letters, numbers, spaces, and _ . - (up to 64)")
        out[k] = text(v, f"{field}.{k}", 500) or ""
    return out


def anchor(value: Any, field: str = "anchor") -> dict | None:
    if value is None:
        return None
    if not isinstance(value, dict):
        invalid(field, "Invalid pin")
    iid = parse_uuid(value.get("imageInstanceId"))
    if not iid:
        invalid(field, "Invalid pin")
    out: dict[str, Any] = {"imageInstanceId": str(iid), "x": number(value.get("x"), "anchor.x", 0, 1), "y": number(value.get("y"), "anchor.y", 0, 1)}
    sid = text(value.get("annotationShapeId"), "anchor.annotationShapeId", 64)
    if sid:
        out["annotationShapeId"] = sid
    return out


# ---------------------------------------------------------------- preferences & search

_PREF_ENUMS = {"theme": {"light", "dark", "system"}, "density": {"compact", "comfortable"}, "histogramDateField": {"workDate", "publishedAt", "updatedAt"}, "digest": {"off", "daily", "weekly"}}


def preferences(value: Any) -> dict:
    if not isinstance(value, dict):
        invalid("preferences", "Invalid preferences")
    out: dict[str, Any] = {}
    for k, allowed in _PREF_ENUMS.items():
        if value.get(k) in allowed:
            out[k] = value[k]
    for k in ("shortcuts", "reducedMotion"):
        if isinstance(value.get(k), bool):
            out[k] = value[k]
    if parse_uuid(value.get("defaultWorkspaceId")):
        out["defaultWorkspaceId"] = str(parse_uuid(value["defaultWorkspaceId"]))
    tz = timezone(value.get("timezone"))
    if tz:
        out["timezone"] = tz
    return out


def filter_spec(value: Any, field: str = "filterSpec") -> dict:
    if value is None:
        return {}
    if not isinstance(value, dict):
        invalid(field, "Invalid search")
    json_size(value, field, 20_000)
    q = value.get("q")
    if q is not None and (not isinstance(q, str) or len(q) > 1000):
        invalid(f"{field}.q", "Search text must be at most 1,000 characters")
    return value
