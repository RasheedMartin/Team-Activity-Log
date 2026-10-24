"""FilterSpec -> Elasticsearch query parts (§B4). Pure functions; no I/O.

Mirrors the mock engine (frontend/src/mock/search/engine.ts) group for group:

    security filters (always on, server-injected; never from the client)
    text query (boolean AST from tal.query)
    filters, split into groups: tag | author | imageType | date | other

`other` goes in the query; the four facetable groups go in `post_filter`, and each facet's
aggregation is wrapped in every *other* group's filter. That gives disjunctive facets: counts
"as if my own selection weren't applied" (§W4.7). The histogram drops only the date group.
"""

from __future__ import annotations

import datetime as dt
import re
from dataclasses import dataclass, field
from typing import Any

from ..dates import resolve_range
from ..query import Node, parse_boolean, positive_needles

GROUPS = ("tag", "author", "imageType", "date", "other")
FACET_GROUPS = ("tag", "author", "imageType", "date")
DATE_FIELDS = {"workDate": "work_date", "publishedAt": "published_day", "updatedAt": "updated_day"}

# Text fields and their relevance boosts (§B4.2).
FIELD_MAP = {
    "title": ["title"],
    "body": ["summary", "body"],
    "comment": ["comment_text"],
    "image": ["image_text", "annotation_text"],
    "tag": ["tag_text"],
}
BOOST = {"title": 4, "tag_text": 3, "summary": 2, "body": 1, "comment_text": 0.7, "image_text": 0.8, "annotation_text": 0.8}
ALL_TEXT = list(BOOST)

SORTS = {
    "relevance": [{"_score": "desc"}, {"published_at": "desc"}, {"post_id": "asc"}],
    "newest": [{"published_at": "desc"}, {"post_id": "asc"}],
    "oldest": [{"published_at": "asc"}, {"post_id": "asc"}],
    "workDate": [{"work_date": "desc"}, {"published_at": "desc"}, {"post_id": "asc"}],
    "mostDiscussed": [{"comment_count": "desc"}, {"published_at": "desc"}, {"post_id": "asc"}],
    "recentActivity": [{"last_activity": "desc"}, {"post_id": "asc"}],
}

MATCH_ALL: dict = {"match_all": {}}
MATCH_NONE: dict = {"match_none": {}}


@dataclass
class SearchCtx:
    org_id: str
    workspace_ids: list[str]
    me: str
    can_see_hidden: bool
    today: dt.date


@dataclass
class Translated:
    security: list[dict]
    text: dict | None
    groups: dict[str, list[dict]] = field(default_factory=lambda: {g: [] for g in GROUPS})
    needles: list[str] = field(default_factory=list)
    image_conds: list[dict] = field(default_factory=list)

    def query(self) -> dict:
        """Main query: security + text + the non-facet group."""
        b: dict[str, Any] = {"filter": [*self.security, *self.groups["other"]]}
        if self.text:
            b["must"] = [self.text]
        return {"bool": b}

    def except_(self, skip: str | None) -> dict:
        """The facetable groups' filters minus one (for post_filter and facet aggregations)."""
        clauses = [c for g in FACET_GROUPS if g != skip for c in self.groups[g]]
        return {"bool": {"filter": clauses}} if clauses else MATCH_ALL


def effective_sort(spec: dict) -> str:
    return spec.get("sort") or ("relevance" if (spec.get("q") or "").strip() else "newest")


# ---------------------------------------------------------------- helpers


def _values(c: dict) -> list[str]:
    v = c.get("value")
    return [str(x) for x in v] if isinstance(v, list) else [str(v)]


def _set(field_: str, c: dict) -> dict:
    """in (any), in_all (every), not_in (none)."""
    want = _values(c)
    op = c.get("op")
    if op == "in_all":
        return {"bool": {"filter": [{"term": {field_: w}} for w in want]}}
    if op == "not_in":
        return {"bool": {"must_not": [{"terms": {field_: want}}]}}
    return {"terms": {field_: want}}


def _date(field_: str, c: dict, today: dt.date) -> dict:
    op = c.get("op")
    if op == "between":
        r = resolve_range(c.get("value"), today)
        rng = {k: v for k, v in {"gte": r["from"], "lte": r["to"]}.items() if v}
        return {"range": {field_: rng}} if rng else MATCH_ALL
    if op == "gte":
        return {"range": {field_: {"gte": str(c.get("value"))}}}
    if op == "lte":
        return {"range": {field_: {"lte": str(c.get("value"))}}}
    return {"term": {field_: str(c.get("value"))}}


def _flag(clause: dict, truthy: bool) -> dict:
    return clause if truthy else {"bool": {"must_not": [clause]}}


def _escape_wild(s: str) -> str:
    return re.sub(r"([*?\\])", r"\\\1", s)


def _contains(field_: str, value: Any) -> dict:
    return {"wildcard": {field_: {"value": f"*{_escape_wild(str(value or '').lower())}*", "case_insensitive": True}}}


# ---------------------------------------------------------------- conditions


def image_clause(c: dict, today: dt.date) -> dict:
    """One image-level condition, inside the `images` nested path."""
    f, v = c.get("field"), c.get("value")
    if f == "image.ocrText":
        return _contains("images.ocr_text", v)
    if f == "image.type":
        return _set("images.type", c)
    if f == "image.figureLabel":
        if c.get("op") == "eq":
            return {"wildcard": {"images.figure_label": {"value": _escape_wild(str(v or "")), "case_insensitive": True}}}
        return _contains("images.figure_label", v)
    if f == "image.filename":
        return _contains("images.filename", v)
    if f == "image.capturedAt":
        return {"bool": {"filter": [{"exists": {"field": "images.captured_day"}}, _date("images.captured_day", c, today)]}}
    if f == "image.minWidth":
        return {"range": {"images.width": {"gte": _num(v)}}}
    if f == "image.minHeight":
        return {"range": {"images.height": {"gte": _num(v)}}}
    if f == "image.custom":
        kv = v if isinstance(v, dict) else {}
        key = str(kv.get("key") or "")
        if not key:
            return MATCH_NONE
        if kv.get("value") is None:
            return {"exists": {"field": f"images.custom.{key}"}}
        return {"term": {f"images.custom.{key}": str(kv["value"]).lower()}}
    if f == "image.annotationText":
        return _contains("images.annotation_text", v)
    return MATCH_ALL


def _num(v: Any) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0


def nested(*clauses: dict) -> dict:
    return {"nested": {"path": "images", "query": {"bool": {"filter": list(clauses)}}}}


def post_clause(c: dict, ctx: SearchCtx) -> dict:
    f = c.get("field") or ""
    truthy = c.get("value") is not False
    me = ctx.me
    if f == "author":
        return _set("author_ids", c)
    if f == "coAuthor":
        return _set("co_author_ids", c)
    if f == "tag":
        return _set("tag_ids", c)
    if f in DATE_FIELDS:
        return _date(DATE_FIELDS[f], c, ctx.today)
    if f == "hasImages":
        return {"term": {"has_images": truthy}}
    if f == "hasAnnotations":
        return {"term": {"has_annotations": truthy}}
    if f == "hasComments":
        return _flag({"range": {"comment_count": {"gt": 0}}}, truthy)
    if f == "unansweredQuestion":
        return {"term": {"unanswered": truthy}}
    if f == "resolved":
        return {"term": {"resolved": truthy}}
    if f == "mentionsMe":
        return _flag({"term": {"mentioned_ids": me}}, truthy)
    if f == "iCommented":
        return _flag({"term": {"commenter_ids": me}}, truthy)
    if f == "iReacted":
        return _flag({"term": {"reactor_ids": me}}, truthy)
    if f == "mine":
        return _flag({"term": {"author_ids": me}}, truthy)
    if f == "collection":
        return _set("collection_ids", c)
    if f == "status":
        return _set("status", c)
    if f == "visibility":
        return MATCH_ALL if "any" in _values(c) else _set("visibility", c)
    if f == "importedFrom":
        if c.get("op") == "contains":
            return _contains("imported_from", c.get("value"))
        return {"term": {"imported_from": str(c.get("value"))}}
    if f == "workDateGuessed":
        return _flag({"bool": {"must_not": [{"term": {"work_date_source": "user"}}]}}, truthy)
    if f.startswith("image."):
        return nested(image_clause(c, ctx.today))
    return MATCH_ALL


def group_of(c: dict) -> str:
    f = c.get("field")
    if f == "tag":
        return "tag"
    if f in ("author", "coAuthor"):
        return "author"
    if f == "image.type":
        return "imageType"
    if f in DATE_FIELDS:
        return "date"
    return "other"


def filter_group(g: dict, ctx: SearchCtx) -> dict:
    """The advanced builder's nested and/or/not tree."""
    items = g.get("items") or []
    if not items:
        return MATCH_ALL
    clauses = [filter_group(x, ctx) if "items" in x else post_clause(x, ctx) for x in items]
    op = g.get("op")
    if op == "or":
        return {"bool": {"should": clauses, "minimum_should_match": 1}}
    if op == "not":
        return {"bool": {"must_not": clauses}}
    return {"bool": {"filter": clauses}}


# ---------------------------------------------------------------- text


def _fields(field_: str | None) -> list[str]:
    names = FIELD_MAP[field_] if field_ else ALL_TEXT
    return [f"{n}^{BOOST[n]}" for n in names]


def text_clause(n: Node) -> dict:
    t = n["type"]
    if t == "term":
        v = n["value"]
        fields = _fields(n.get("field"))
        should: list[dict] = [{"multi_match": {"query": v, "fields": fields, "fuzziness": "AUTO" if len(v) > 4 else 0, "operator": "and"}}]
        if n.get("prefix") or len(v) > 2:
            should.append({"multi_match": {"query": v, "fields": fields, "type": "phrase_prefix"}})
        return {"bool": {"should": should, "minimum_should_match": 1}}
    if t == "phrase":
        return {"multi_match": {"query": n["value"], "fields": _fields(n.get("field")), "type": "phrase"}}
    if t == "not":
        return {"bool": {"must_not": [text_clause(n["child"])]}}
    if t == "and":
        return {"bool": {"must": [text_clause(c) for c in n["children"]]}}
    return {"bool": {"should": [text_clause(c) for c in n["children"]], "minimum_should_match": 1}}


def highlight(needles: list[str]) -> dict | None:
    if not needles:
        return None
    hq = {"bool": {"should": [{"multi_match": {"query": x, "fields": ALL_TEXT, "type": "phrase_prefix"}} for x in needles]}}
    opts = {"fragment_size": 180, "number_of_fragments": 1, "no_match_size": 0}
    return {
        "pre_tags": ["<mark>"],
        "post_tags": ["</mark>"],
        "encoder": "html",
        "highlight_query": hq,
        "fields": {"title": {"number_of_fragments": 0}, **{f: opts for f in ALL_TEXT if f != "title"}},
    }


# ---------------------------------------------------------------- entry


def translate(spec: dict, ctx: SearchCtx) -> Translated:
    all_ = spec.get("all") or []
    want_hidden = any(c.get("field") == "visibility" and {"hidden", "any"} & set(_values(c)) for c in all_)
    visible_or_mine = [{"term": {"visibility": "visible"}}]
    if want_hidden:
        visible_or_mine.append({"bool": {"filter": [{"term": {"visibility": "hidden"}}, *([] if ctx.can_see_hidden else [{"term": {"author_id": ctx.me}}])]}})
    security = [
        {"term": {"org_id": ctx.org_id}},
        {"terms": {"workspace_id": ctx.workspace_ids}},
        {"term": {"status": "published"}},
        {"bool": {"should": visible_or_mine, "minimum_should_match": 1}},
    ]
    ast = parse_boolean(spec.get("q")).ast
    out = Translated(security=security, text=text_clause(ast) if ast else None, needles=positive_needles(ast))

    # Image-level conditions in `all` must hold for the *same* image (nested semantics).
    image_all = [c for c in all_ if str(c.get("field", "")).startswith("image.") and c.get("field") != "image.type"]
    type_all = [c for c in all_ if c.get("field") == "image.type"]
    if image_all:
        out.groups["other"].append(nested(*[image_clause(c, ctx.today) for c in image_all]))
    if type_all:
        out.groups["imageType"].append(nested(*[image_clause(c, ctx.today) for c in [*image_all, *type_all]]))
    out.image_conds = [c for c in all_ if str(c.get("field", "")).startswith("image.")]

    for c in all_:
        if str(c.get("field", "")).startswith("image."):
            continue
        out.groups[group_of(c)].append(post_clause(c, ctx))
    if spec.get("any"):
        out.groups["other"].append({"bool": {"should": [post_clause(c, ctx) for c in spec["any"]], "minimum_should_match": 1}})
    if (spec.get("where") or {}).get("items"):
        out.groups["other"].append(filter_group(spec["where"], ctx))
    for c in spec.get("none") or []:
        out.groups[group_of(c)].append({"bool": {"must_not": [post_clause(c, ctx)]}})
    return out


def selected_values(spec: dict, field_: str) -> set[str]:
    return {v for c in [*(spec.get("all") or []), *(spec.get("none") or [])] if c.get("field") == field_ for v in _values(c)}
