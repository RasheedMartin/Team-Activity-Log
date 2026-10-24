"""Search, Explore, and Suggest (§B4): Elasticsearch decides which posts and in what order;
Postgres decides what is returned and whether the caller may see it (hydration).
"""

from __future__ import annotations

import base64
import datetime as dt
import re
import time
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models as m
from ..dates import ORDER, add_days, auto_interval, bucket_start, midnight_iso, next_bucket, parse_date, resolve_range
from ..views import asset_url, block_image_ids, post_views, tag_view
from .client import es
from .indexer import alias
from .translate import SORTS, SearchCtx, Translated, effective_sort, highlight, selected_values, translate

DEFAULT_LIMIT = 30
MAX_BUCKETS = 1500
MAX_WINDOW = 10_000
IMAGE_TYPES = ["chart", "photo", "screenshot", "diagram", "table"]
HL_FIELD = {"title": ("title", "title"), "summary": ("summary", "body"), "body": ("body", "body"), "tag_text": ("tags", "tag"), "comment_text": ("comments", "comment"), "image_text": ("images", "image text"), "annotation_text": ("annotations", "annotation")}
HL_ORDER = ["title", "summary", "body", "tag_text", "comment_text", "image_text", "annotation_text"]


def _cursor(offset: int) -> str:
    return base64.b64encode(str(offset).encode()).decode()


def _offset(cursor: str | None) -> int:
    if not cursor:
        return 0
    try:
        return max(0, int(base64.b64decode(cursor).decode()))
    except (ValueError, UnicodeDecodeError):
        return 0


# ---------------------------------------------------------------- images (hydration side)


def _lower(s: Any) -> str:
    return str(s or "").lower()


def match_image(inst: m.ImageInstance, asset: m.Asset, c: dict, today: dt.date) -> bool:
    """Same as the nested ES clause, evaluated on hydrated rows (gallery + 'matched in image')."""
    f, v = c.get("field"), c.get("value")
    meta = asset.metadata_ or {}
    s = _lower(v)
    if f == "image.ocrText":
        return s in _lower(meta.get("ocrText"))
    if f == "image.type":
        want = [str(x) for x in v] if isinstance(v, list) else [str(v)]
        t = meta.get("detectedType") or ""
        op = c.get("op")
        return all(w == t for w in want) if op == "in_all" else (t not in want) if op == "not_in" else t in want
    if f == "image.figureLabel":
        return _lower(inst.figure_label) == s if c.get("op") == "eq" else s in _lower(inst.figure_label)
    if f == "image.filename":
        return s in _lower(asset.original_filename)
    if f == "image.capturedAt":
        at = ((meta.get("exif") or {}).get("capturedAt") or "")[:10]
        if not at:
            return False
        op = c.get("op")
        if op == "between":
            r = resolve_range(v, today)
            return (not r["from"] or at >= r["from"]) and (not r["to"] or at <= r["to"])
        return at >= str(v) if op == "gte" else at <= str(v) if op == "lte" else at == str(v)
    if f == "image.minWidth":
        return asset.width >= float(v or 0)
    if f == "image.minHeight":
        return asset.height >= float(v or 0)
    if f == "image.custom":
        kv = v if isinstance(v, dict) else {}
        actual = (inst.custom_fields or {}).get(kv.get("key") or "")
        return actual is not None and (kv.get("value") is None or _lower(actual) == _lower(kv["value"]))
    if f == "image.annotationText":
        return s in _lower(" ".join(x.get("text") or "" for x in (inst.annotation or {}).get("shapes") or []))
    return True


async def _post_images(db: AsyncSession, posts: list[m.Post]) -> dict[uuid.UUID, list[tuple[m.ImageInstance, m.Asset]]]:
    ids = [i for p in posts for i in block_image_ids(p.blocks)]
    found: dict[uuid.UUID, tuple[m.ImageInstance, m.Asset]] = {}
    if ids:
        for inst, asset in await db.execute(select(m.ImageInstance, m.Asset).join(m.Asset, m.Asset.id == m.ImageInstance.asset_id).where(m.ImageInstance.id.in_(ids))):
            found[inst.id] = (inst, asset)
    return {p.id: [found[i] for i in block_image_ids(p.blocks) if i in found] for p in posts}


def _variant(asset: m.Asset, name: str) -> str:
    names = [v["name"] for v in asset.variants or []]
    return asset_url(asset.org_id, asset.id, name if name in names else (names[0] if names else "original"))


def gallery_image(p: m.Post, inst: m.ImageInstance, asset: m.Asset) -> dict:
    out = {
        "imageInstanceId": str(inst.id),
        "postId": str(p.id),
        "postTitle": p.title,
        "thumbUrl": _variant(asset, "small"),
        "width": asset.width,
        "height": asset.height,
        "blurhash": asset.blurhash,
        "dominantColor": (asset.dominant_colors or [None])[0],
        "caption": inst.caption,
        "figureLabel": inst.figure_label,
    }
    return {k: v for k, v in out.items() if v is not None}


async def _hydrate(db: AsyncSession, ids: list[str]) -> list[m.Post]:
    """Load in ES order; drop anything Postgres says isn't searchable any more (stale index)."""
    if not ids:
        return []
    uids = [uuid.UUID(i) for i in ids]
    rows = {p.id: p for p in (await db.execute(select(m.Post).where(m.Post.id.in_(uids)))).scalars()}
    return [rows[i] for i in uids if i in rows and rows[i].status == "published" and not rows[i].deleted_at]


# ---------------------------------------------------------------- histogram


def _hist_field(spec: dict) -> str:
    return (spec.get("histogram") or {}).get("field") or "workDate"


async def _histogram(t: Translated, spec: dict, ctx: SearchCtx, es_field: str, minmax: tuple[str | None, str | None]) -> dict:
    field_ = _hist_field(spec)
    h = spec.get("histogram") or {}
    date_cond = next((c for c in spec.get("all") or [] if c.get("field") == field_ and c.get("op") == "between"), None)
    selected = resolve_range(date_cond.get("value"), ctx.today) if date_cond else None
    today = ctx.today.isoformat()
    start, end = (h.get("bounds") or {}).get("from"), (h.get("bounds") or {}).get("to")
    if not start or not end:
        lo, hi = minmax
        if selected and selected["from"] and (not lo or selected["from"] < lo):
            lo = selected["from"]
        if selected and selected["to"] and (not hi or selected["to"] > hi):
            hi = selected["to"]
        start = lo or add_days(today, -29)
        end = hi or today
        if end > today and not (selected and selected["to"]):
            end = today
    requested = h.get("interval") or "auto"
    interval = auto_interval(start, end) if requested == "auto" else requested

    def count(iv: str) -> int:
        n, b, last = 0, bucket_start(parse_date(start), iv), parse_date(end)
        while b <= last and n <= MAX_BUCKETS:
            n, b = n + 1, next_bucket(b, iv)
        return n

    while count(interval) > MAX_BUCKETS and interval != "year":
        interval = ORDER[ORDER.index(interval) + 1]

    agg = {
        "filter": t.except_("date"),
        "aggs": {
            "range": {
                "filter": {"range": {es_field: {"gte": start, "lte": end}}},
                "aggs": {
                    "h": {
                        "date_histogram": {"field": es_field, "calendar_interval": "quarter" if interval == "quarter" else interval, "min_doc_count": 1, "format": "yyyy-MM-dd"},
                        "aggs": {"top": {"terms": {"field": "tag_ids", "size": 3}}},
                    }
                },
            }
        },
    }
    res = await es().search(index=alias(), size=0, query=t.query(), aggs={"hist": agg}, routing=ctx.org_id)
    got = {b["key_as_string"]: b for b in res["aggregations"]["hist"]["range"]["h"]["buckets"]}
    buckets = []
    b, last = bucket_start(parse_date(start), interval), parse_date(end)
    while b <= last:
        nb = next_bucket(b, interval)
        hit = got.get(b.isoformat())
        bucket: dict = {"start": midnight_iso(b), "end": midnight_iso(nb), "count": hit["doc_count"] if hit else 0}
        if hit:
            bucket["topTags"] = [{"tagId": x["key"], "count": x["doc_count"]} for x in hit["top"]["buckets"]]
        buckets.append(bucket)
        b = nb
    out: dict = {"field": field_, "interval": interval, "buckets": buckets}
    if selected and (selected["from"] or selected["to"]):
        out["selectedRange"] = {"from": f"{selected['from'] or start}T00:00:00.000Z", "to": f"{add_days(selected['to'] or end, 1)}T00:00:00.000Z"}
    return out


# ---------------------------------------------------------------- search


async def search(db: AsyncSession, spec: dict, ctx: SearchCtx) -> dict:
    t0 = time.perf_counter()
    t = translate(spec, ctx)
    limit = max(1, min(int(spec.get("limit") or DEFAULT_LIMIT), 200))
    offset = _offset(spec.get("cursor"))
    gallery = spec.get("view") == "gallery"
    sort = SORTS[effective_sort(spec)] if effective_sort(spec) in SORTS else SORTS["newest"]
    hist_field = {"workDate": "work_date", "publishedAt": "published_day", "updatedAt": "updated_day"}[_hist_field(spec)]

    tags = list((await db.execute(select(m.Tag).where(m.Tag.org_id == uuid.UUID(ctx.org_id)).order_by(m.Tag.name))).scalars())
    aggs = {
        "f_tags": {"filter": t.except_("tag"), "aggs": {"v": {"terms": {"field": "tag_ids", "size": max(10, len(tags))}}}},
        "f_authors": {"filter": t.except_("author"), "aggs": {"v": {"terms": {"field": "author_ids", "size": 500}}}},
        "f_types": {"filter": t.except_("imageType"), "aggs": {"v": {"terms": {"field": "image_types", "size": 10}}}},
        "f_dates": {"filter": t.except_("date"), "aggs": {"lo": {"min": {"field": hist_field, "format": "yyyy-MM-dd"}}, "hi": {"max": {"field": hist_field, "format": "yyyy-MM-dd"}}}},
    }
    body: dict[str, Any] = {"query": t.query(), "post_filter": t.except_(None), "aggs": aggs, "sort": sort, "track_total_hits": True}
    if gallery:
        body.update(size=MAX_WINDOW, _source=False)
    else:
        body.update(**{"from": min(offset, MAX_WINDOW - limit), "size": limit, "_source": False})
        hl = highlight(t.needles)
        if hl:
            body["highlight"] = hl
    res = await es().search(index=alias(), routing=ctx.org_id, **body)
    a = res["aggregations"]

    # Facets: every org tag (zero counts included), authors seen or selected, fixed image types.
    sel_tags, sel_authors, sel_types = selected_values(spec, "tag"), selected_values(spec, "author"), selected_values(spec, "image.type")
    tag_counts = {b["key"]: b["doc_count"] for b in a["f_tags"]["v"]["buckets"]}
    author_counts = {b["key"]: b["doc_count"] for b in a["f_authors"]["v"]["buckets"]}
    type_counts = {b["key"]: b["doc_count"] for b in a["f_types"]["v"]["buckets"]}
    facet_tags = sorted(
        ({"value": str(tg.id), "label": tg.name, "count": tag_counts.get(str(tg.id), 0), **({"selected": True} if str(tg.id) in sel_tags else {})} for tg in tags),
        key=lambda b: (-b["count"], b["label"]),
    )
    facet_authors = sorted(
        ({"value": u, "count": author_counts.get(u, 0), **({"selected": True} if u in sel_authors else {})} for u in {*author_counts, *sel_authors}),
        key=lambda b: -b["count"],
    )
    facet_types = [{"value": x, "label": x, "count": type_counts.get(x, 0), **({"selected": True} if x in sel_types else {})} for x in IMAGE_TYPES]

    minmax = (a["f_dates"]["lo"].get("value_as_string"), a["f_dates"]["hi"].get("value_as_string"))
    histogram = await _histogram(t, spec, ctx, hist_field, minmax)

    hits_raw = res["hits"]["hits"]
    total = res["hits"]["total"]["value"]
    out: dict[str, Any] = {"facets": {"tags": facet_tags, "authors": facet_authors, "imageTypes": facet_types}, "histogram": histogram}

    if gallery:
        posts = await _hydrate(db, [h["_id"] for h in hits_raw])
        imgs = await _post_images(db, posts)
        all_imgs = [gallery_image(p, inst, asset) for p in posts for inst, asset in imgs[p.id] if all(match_image(inst, asset, c, ctx.today) for c in t.image_conds)]
        out.update(hits=[], images=all_imgs[offset : offset + limit], total=len(all_imgs), nextCursor=_cursor(offset + limit) if offset + limit < len(all_imgs) else None)
    else:
        posts = await _hydrate(db, [h["_id"] for h in hits_raw])
        hl_by_id = {h["_id"]: h.get("highlight") or {} for h in hits_raw}
        views = {v["id"]: v for v in await post_views(db, posts)}
        imgs = await _post_images(db, posts)
        hits = []
        for p in posts:
            hl = hl_by_id.get(str(p.id), {})
            matched: list[str] = []
            highlights = []
            for f in HL_ORDER:
                if f in hl and hl[f]:
                    name, label = HL_FIELD[f]
                    if label not in matched:
                        matched.append(label)
                    if f != "tag_text":
                        highlights.append({"field": name, "snippet": hl[f][0]})
            pis = imgs[p.id]
            image_hits = None
            if t.image_conds or (t.needles and "image text" in matched):
                keep = [
                    (i, a_)
                    for i, a_ in pis
                    if (all(match_image(i, a_, c, ctx.today) for c in t.image_conds) if t.image_conds else any(n in _lower(f"{(a_.metadata_ or {}).get('ocrText') or ''} {i.caption or ''}") for n in t.needles))
                ]
                image_hits = [{"imageInstanceId": str(i.id), "thumbUrl": _variant(a_, "thumb")} for i, a_ in keep]
            hit = {
                "post": views[str(p.id)],
                "highlights": highlights,
                "matchedIn": matched,
                "images": [
                    {k: v for k, v in {"imageInstanceId": str(i.id), "thumbUrl": _variant(a_, "thumb"), "blurhash": a_.blurhash, "width": a_.width, "height": a_.height, "dominantColor": (a_.dominant_colors or [None])[0]}.items() if v is not None}
                    for i, a_ in pis
                ],
            }
            if image_hits is not None:
                hit["imageHits"] = image_hits
            hits.append(hit)
        out.update(hits=hits, total=total, nextCursor=_cursor(offset + limit) if offset + limit < min(total, MAX_WINDOW) else None)
    if out.get("nextCursor") is None:
        out.pop("nextCursor", None)
    out["tookMs"] = round((time.perf_counter() - t0) * 1000)
    return out


# ---------------------------------------------------------------- explore & suggest


def _excerpt(p: m.Post) -> str:
    from ..prosemirror import doc_text

    text = p.summary or "\n".join(doc_text(b.get("doc")) for b in p.blocks or [] if b.get("type") in ("text", "table"))
    text = re.sub(r"\s+", " ", text).strip()
    return f"{text[:240]}…" if len(text) > 240 else text


async def explore(db: AsyncSession, ctx: SearchCtx, per_shelf: int = 12, max_shelves: int = 40) -> dict:
    base = {"bool": {"filter": [{"term": {"org_id": ctx.org_id}}, {"terms": {"workspace_id": ctx.workspace_ids}}, {"term": {"status": "published"}}, {"term": {"visibility": "visible"}}]}}
    newest = [{"published_at": "desc"}, {"post_id": "asc"}]
    aggs = {
        "shelves": {
            "terms": {"field": "tag_ids", "size": max_shelves, "order": {"latest": "desc"}},
            "aggs": {
                "latest": {"max": {"field": "published_at"}},
                "images": {"sum": {"field": "image_count"}},
                "top": {"top_hits": {"size": per_shelf, "sort": newest, "_source": ["last_activity", "published_at"]}},
            },
        }
    }
    res = await es().search(index=alias(), routing=ctx.org_id, query=base, size=max(per_shelf, 24), sort=newest, _source=False, aggs=aggs)
    latest_ids = [h["_id"] for h in res["hits"]["hits"]]
    shelves_raw = res["aggregations"]["shelves"]["buckets"]
    all_ids = list(dict.fromkeys([*latest_ids, *[h["_id"] for b in shelves_raw for h in b["top"]["hits"]["hits"]]]))
    posts = {str(p.id): p for p in await _hydrate(db, all_ids)}
    imgs = await _post_images(db, list(posts.values()))
    tags = {str(t.id): t for t in (await db.execute(select(m.Tag).where(m.Tag.org_id == uuid.UUID(ctx.org_id)))).scalars()}

    def card(p: m.Post) -> dict:
        first = imgs[p.id][0] if imgs[p.id] else None
        c = {
            "id": str(p.id),
            "title": p.title,
            "workDate": p.work_date.isoformat(),
            "authorId": str(p.author_id),
            "excerpt": _excerpt(p),
            "imageCount": len(imgs[p.id]),
            "commentCount": p.comment_count,
            "thumbUrl": _variant(first[1], "small") if first else None,
            "dominantColor": (first[1].dominant_colors or [None])[0] if first else None,
        }
        return {k: v for k, v in c.items() if v is not None}

    shelves = []
    for b in shelves_raw:
        tag = tags.get(b["key"])
        list_ = [posts[h["_id"]] for h in b["top"]["hits"]["hits"] if h["_id"] in posts]
        if not tag or not list_:
            continue
        # Same as the mock: the newest post's activity (its comments) or its publish time.
        newest_src = b["top"]["hits"]["hits"][0].get("_source") or {}
        last = max(newest_src.get("last_activity") or "", newest_src.get("published_at") or "")
        shelves.append(
            {
                "tag": tag_view(tag),
                "count": b["doc_count"],
                "imageCount": int(b["images"]["value"] or 0),
                "lastActivity": last,
                "posts": [card(p) for p in list_],
                "images": [gallery_image(p, i, a_) for p in list_ for i, a_ in imgs[p.id]][:per_shelf],
            }
        )
    # Ties (shelves whose newest post is the same) keep that post's tag order, like the mock.
    newest_ids = [uuid.UUID(sh["posts"][0]["id"]) for sh in shelves]
    tag_pos = {(pid, str(tid)): pos for pid, tid, pos in await db.execute(select(m.PostTag.post_id, m.PostTag.tag_id, m.PostTag.position).where(m.PostTag.post_id.in_(newest_ids)))} if newest_ids else {}
    shelves.sort(key=lambda sh: tag_pos.get((uuid.UUID(sh["posts"][0]["id"]), sh["tag"]["id"]), 0))
    shelves.sort(key=lambda sh: sh["lastActivity"], reverse=True)
    latest = [posts[i] for i in latest_ids if i in posts]
    recent = [gallery_image(p, i, a_) for p in latest for i, a_ in imgs[p.id]][:24]
    return {"shelves": shelves, "recent": recent, "latest": [card(p) for p in latest[:per_shelf]]}
