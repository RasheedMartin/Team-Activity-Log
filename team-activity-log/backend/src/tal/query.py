"""Boolean search language for FilterSpec.q (port of frontend/src/lib/query.ts; same AST, same rules).

    drift cooldown            implicit AND
    drift OR noise            OR (UPPERCASE operators, like Elasticsearch query_string)
    NOT pump  /  -pump        exclusion
    (drift OR noise) AND "detector B"
    title:drift  comment:"pump schedule"  image:keV  tag:calibration  body:(gain OR offset)
    calib*                    explicit prefix (the last word typed is always prefix-matched)

Never raises: malformed input degrades to plain words and reports hints.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

QUERY_FIELDS = ("title", "body", "comment", "image", "tag")

Node = dict[str, Any]  # {"type": "and"|"or", "children"} | {"type":"not","child"} | term | phrase


@dataclass
class Parsed:
    ast: Node | None
    errors: list[str] = field(default_factory=list)


def _tokenize(q: str, errors: list[str]) -> list[tuple[str, str | None]]:
    out: list[tuple[str, str | None]] = []
    i, n = 0, len(q)
    while i < n:
        c = q[i]
        if c.isspace():
            i += 1
            continue
        if c == "(":
            out.append(("lp", None))
            i += 1
            continue
        if c == ")":
            out.append(("rp", None))
            i += 1
            continue
        if c == '"':
            end = q.find('"', i + 1)
            if end == -1:
                errors.append("Unclosed quote")
                out.append(("phrase", q[i + 1 :].strip()))
                break
            out.append(("phrase", q[i + 1 : end].strip()))
            i = end + 1
            continue
        if c == "-" and i + 1 < n and not q[i + 1].isspace() and (i == 0 or q[i - 1].isspace() or q[i - 1] == "("):
            out.append(("minus", None))
            i += 1
            continue
        j = i
        while j < n and not (q[j].isspace() or q[j] in '()"'):
            j += 1
        word = q[i:j]
        i = j
        fm = re.match(r"^([a-z]+):$", word, re.I) or re.match(r"^([a-z]+):(.+)$", word, re.I)
        if fm and fm.group(1).lower() in QUERY_FIELDS:
            out.append(("field", fm.group(1).lower()))
            if fm.lastindex and fm.lastindex >= 2 and fm.group(2):
                out.append(("word", fm.group(2)))
            continue
        if word in ("AND", "&&"):
            out.append(("and", None))
        elif word in ("OR", "||"):
            out.append(("or", None))
        elif word == "NOT":
            out.append(("not", None))
        else:
            out.append(("word", word))
    return out


def parse_boolean(q: str | None) -> Parsed:
    errors: list[str] = []
    text = (q or "").strip()
    if not text:
        return Parsed(None, errors)
    toks = _tokenize(text, errors)
    pos = 0

    def peek() -> str | None:
        return toks[pos][0] if pos < len(toks) else None

    def with_field(node: Node, f: str) -> Node:
        if node["type"] in ("term", "phrase"):
            return {**node, "field": f}
        if node["type"] == "not":
            return {"type": "not", "child": with_field(node["child"], f)}
        return {"type": node["type"], "children": [with_field(c, f) for c in node["children"]]}

    def parse_or() -> Node | None:
        nonlocal pos
        parts: list[Node] = []
        first = parse_and()
        if first:
            parts.append(first)
        while peek() == "or":
            pos += 1
            nxt = parse_and()
            if nxt:
                parts.append(nxt)
            else:
                errors.append("OR needs something after it")
        return None if not parts else parts[0] if len(parts) == 1 else {"type": "or", "children": parts}

    def parse_and() -> Node | None:
        nonlocal pos
        parts: list[Node] = []
        while True:
            t = peek()
            if t is None or t in ("or", "rp"):
                break
            if t == "and":
                pos += 1
                if not parts:
                    errors.append("AND needs something before it")
                continue
            u = parse_unary()
            if u:
                parts.append(u)
        return None if not parts else parts[0] if len(parts) == 1 else {"type": "and", "children": parts}

    def parse_unary() -> Node | None:
        nonlocal pos
        if peek() in ("not", "minus"):
            pos += 1
            child = parse_unary()
            if not child:
                errors.append("NOT needs something after it")
                return None
            return {"type": "not", "child": child}
        return parse_primary()

    def parse_primary() -> Node | None:
        nonlocal pos
        if pos >= len(toks):
            return None
        k, v = toks[pos]
        pos += 1
        if k == "lp":
            inner = parse_or()
            if peek() == "rp":
                pos += 1
            else:
                errors.append("Missing )")
            return inner
        if k == "rp":
            errors.append("Unexpected )")
            return None
        if k == "field":
            inner = parse_primary()
            if not inner:
                errors.append(f"{v}: needs a word after it")
                return None
            return with_field(inner, v or "")
        if k == "phrase":
            return {"type": "phrase", "value": (v or "").lower()} if v else None
        if k == "word":
            assert v is not None
            prefix = v.endswith("*")
            value = v.rstrip("*").lower()
            if not value:
                return None
            return {"type": "term", "value": value, **({"prefix": True} if prefix else {})}
        return None

    ast = parse_or()
    while pos < len(toks):
        if toks[pos][0] == "rp":
            errors.append("Unexpected )")
        pos += 1
        rest = parse_or()
        if rest:
            ast = {"type": "and", "children": [ast, rest]} if ast else rest
    last = _last_term(ast)
    if last is not None:
        last["prefix"] = True
    return Parsed(ast, list(dict.fromkeys(errors)))


def _last_term(n: Node | None) -> Node | None:
    if not n:
        return None
    if n["type"] == "term":
        return n
    if n["type"] in ("and", "or"):
        return _last_term(n["children"][-1])
    return None


def positive_needles(n: Node | None, negated: bool = False) -> list[str]:
    if not n:
        return []
    if n["type"] in ("term", "phrase"):
        return [] if negated else [n["value"]]
    if n["type"] == "not":
        return positive_needles(n["child"], not negated)
    return [x for c in n["children"] for x in positive_needles(c, negated)]


def print_query(n: Node | None) -> str:
    if not n:
        return ""
    f = f"{n['field']}:" if n.get("field") else ""
    t = n["type"]
    if t == "term":
        return f"{f}{n['value']}{'*' if n.get('prefix') else ''}"
    if t == "phrase":
        return f'{f}"{n["value"]}"'
    if t == "not":
        c = n["child"]
        return f"NOT ({print_query(c)})" if c["type"] in ("and", "or") else f"NOT {print_query(c)}"
    if t == "and":
        return " ".join(f"({print_query(c)})" if c["type"] == "or" else print_query(c) for c in n["children"])
    return " OR ".join(print_query(c) for c in n["children"])
