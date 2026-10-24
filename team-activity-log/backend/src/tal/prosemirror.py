"""ProseMirror JSON helpers (port of frontend/src/lib/prosemirror.ts). Rich text is never raw HTML."""

from __future__ import annotations

import re
from typing import Any

_BLOCK_TYPES = {"paragraph", "heading", "listItem", "blockquote", "codeBlock", "tableRow"}

PMNode = dict[str, Any]


def doc_text(doc: Any) -> str:
    """Plain text with block boundaries as newlines (indexing, snippets, excerpts)."""
    out: list[str] = []

    def walk(n: Any) -> None:
        if not isinstance(n, dict):
            return
        t = n.get("type")
        if t == "text" and n.get("text"):
            out.append(n["text"])
        attrs = n.get("attrs") or {}
        if t == "mention" and attrs.get("label"):
            out.append(f"@{attrs['label']}")
        if t == "hardBreak":
            out.append("\n")
        for c in n.get("content") or []:
            walk(c)
        if t in _BLOCK_TYPES:
            out.append("\n")

    walk(doc)
    return re.sub(r"\n{2,}", "\n", "".join(out)).strip()


def is_doc_empty(doc: Any) -> bool:
    return not doc_text(doc).strip()


def mentioned_ids(doc: Any) -> list[str]:
    ids: list[str] = []

    def walk(n: Any) -> None:
        if not isinstance(n, dict):
            return
        attrs = n.get("attrs") or {}
        if n.get("type") == "mention" and isinstance(attrs.get("id"), str):
            ids.append(attrs["id"])
        for c in n.get("content") or []:
            walk(c)

    walk(doc)
    return list(dict.fromkeys(ids))


def text_node(text: str, marks: list[dict] | None = None) -> PMNode:
    return {"type": "text", "text": text, **({"marks": marks} if marks else {})}


def paragraph(text: str) -> PMNode:
    return {"type": "paragraph", "content": [text_node(text)] if text else []}


def heading(text: str, level: int = 2) -> PMNode:
    return {"type": "heading", "attrs": {"level": level}, "content": [text_node(text)]}


def doc(*content: PMNode) -> PMNode:
    return {"type": "doc", "content": list(content)}


def empty_doc() -> PMNode:
    return {"type": "doc", "content": [{"type": "paragraph"}]}
