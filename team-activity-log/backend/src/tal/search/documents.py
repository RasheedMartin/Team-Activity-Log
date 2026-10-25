"""Build search documents from Postgres (§B5: the indexer never trusts a payload; it rebuilds).

Derivation matches the mock engine's `derive()` (frontend/src/mock/search/engine.ts), so the
same FilterSpec selects the same posts in mock and live mode.
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models as m
from ..attachments import block_attachment_ids
from ..ids import parse_uuid
from ..prosemirror import doc_text, mentioned_ids
from ..timeutil import iso
from ..views import block_docs, block_image_ids


def image_search_fields(inst: m.ImageInstance, asset: m.Asset) -> dict:
    meta = asset.metadata_ or {}
    captured = ((meta.get("exif") or {}).get("capturedAt") or "")[:10] or None
    shapes = (inst.annotation or {}).get("shapes") or []
    return {
        "instance_id": str(inst.id),
        "type": meta.get("detectedType"),
        "ocr_text": meta.get("ocrText") or "",
        "figure_label": inst.figure_label or "",
        "filename": asset.original_filename or "",
        "captured_day": captured,
        "width": asset.width,
        "height": asset.height,
        "custom": {k: str(v).lower() for k, v in (inst.custom_fields or {}).items() if str(v).strip()},
        "annotation_text": " ".join(s.get("text") or "" for s in shapes).strip(),
    }


async def build_documents(db: AsyncSession, post_ids: Sequence[uuid.UUID]) -> tuple[dict[uuid.UUID, dict], set[uuid.UUID]]:
    """Returns (documents to index, ids to remove from the index)."""
    if not post_ids:
        return {}, set()
    posts = list((await db.execute(select(m.Post).where(m.Post.id.in_(post_ids)))).scalars())
    live = [p for p in posts if p.status == "published" and not p.deleted_at]
    remove = set(post_ids) - {p.id for p in live}
    if not live:
        return {}, remove
    ids = [p.id for p in live]
    org_ids = {p.org_id for p in live}

    tag_names = {t.id: t.name for t in (await db.execute(select(m.Tag).where(m.Tag.org_id.in_(org_ids)))).scalars()}
    tags: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
    for pid, tid in await db.execute(select(m.PostTag.post_id, m.PostTag.tag_id).where(m.PostTag.post_id.in_(ids)).order_by(m.PostTag.position)):
        tags[pid].append(tid)
    co: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
    for pid, uid in await db.execute(select(m.PostCoAuthor.post_id, m.PostCoAuthor.user_id).where(m.PostCoAuthor.post_id.in_(ids))):
        co[pid].append(uid)
    colls: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
    for pid, cid in await db.execute(select(m.CollectionPost.post_id, m.CollectionPost.collection_id).where(m.CollectionPost.post_id.in_(ids))):
        colls[pid].append(cid)
    comments: dict[uuid.UUID, list[m.CommentRow]] = defaultdict(list)
    for c in (await db.execute(select(m.CommentRow).where(m.CommentRow.post_id.in_(ids), m.CommentRow.deleted_at.is_(None), m.CommentRow.hidden.is_(False)))).scalars():
        comments[c.post_id].append(c)
    inst_ids = [i for p in live for i in block_image_ids(p.blocks, content_only=True)]
    images: dict[uuid.UUID, tuple[m.ImageInstance, m.Asset]] = {}
    if inst_ids:
        for inst, asset in await db.execute(select(m.ImageInstance, m.Asset).join(m.Asset, m.Asset.id == m.ImageInstance.asset_id).where(m.ImageInstance.id.in_(inst_ids))):
            images[inst.id] = (inst, asset)

    # Attached files: their names and text are part of the post's searchable body.
    file_ids = [x for p in live for x in (parse_uuid(i) for i in block_attachment_ids(p.blocks)) if x]
    files = {a.id: a for a in (await db.execute(select(m.Attachment).where(m.Attachment.id.in_(file_ids)))).scalars()} if file_ids else {}

    chart_ids = [x for p in live for b in p.blocks or [] if b.get("type") == "chart" and (x := parse_uuid(b.get("chartId")))]
    charts = {cid: (cname, sname) for cid, cname, sname in (await db.execute(select(m.SheetChart.id, m.SheetChart.name, m.Sheet.name).join(m.Sheet, m.Sheet.id == m.SheetChart.sheet_id).where(m.SheetChart.id.in_(chart_ids)))).all()} if chart_ids else {}

    docs: dict[uuid.UUID, dict] = {}
    for p in live:
        blocks = p.blocks or []
        body = "\n".join(doc_text(d) for d in block_docs(blocks))
        for b in blocks:  # an embedded chart: its name and its sheet's name are findable
            if b.get("type") == "chart" and (ch := charts.get(parse_uuid(b.get("chartId")))):
                body += f"\n{ch[0]}\n{ch[1]}"
        for fid in (parse_uuid(i) for i in block_attachment_ids(blocks)):
            a = files.get(fid) if fid else None
            if a and a.org_id == p.org_id:
                body += f"\n{a.filename}\n{a.text or ''}"
        imgs = [images[i] for i in block_image_ids(blocks, content_only=True) if i in images and images[i][0].org_id == p.org_id and images[i][1].org_id == p.org_id]
        cs = comments[p.id]
        img_fields = [image_search_fields(inst, asset) for inst, asset in imgs]
        image_text = "\n".join(
            " ".join(x for x in [inst.caption, inst.alt_text, inst.figure_label, (asset.metadata_ or {}).get("ocrText"), *map(str, (inst.custom_fields or {}).values())] if x)
            for inst, asset in imgs
        )
        reactors = {u for users in (p.reactions or {}).values() for u in users}
        for c in cs:
            reactors |= {u for users in (c.reactions or {}).values() for u in users}
        mentioned = set(mentioned_ids({"type": "doc", "content": block_docs(blocks)}))
        for c in cs:
            mentioned |= set(mentioned_ids(c.doc))
        questions = [c for c in cs if c.is_question]
        last = max([p.updated_at, *[c.created_at for c in cs]])
        published = p.published_at or p.created_at
        authors = [str(p.author_id), *[str(u) for u in co[p.id] if u != p.author_id]]
        docs[p.id] = {
            "post_id": str(p.id),
            "org_id": str(p.org_id),
            "workspace_id": str(p.workspace_id),
            "status": p.status,
            "visibility": p.visibility,
            "author_id": str(p.author_id),
            "co_author_ids": [str(u) for u in co[p.id]],
            "author_ids": authors,
            "tag_ids": [str(t) for t in tags[p.id]],
            "collection_ids": [str(c) for c in colls[p.id]],
            "title": p.title,
            "summary": p.summary or "",
            "body": body,
            "tag_text": " ".join(tag_names.get(t, "") for t in tags[p.id]),
            "comment_text": "\n".join(doc_text(c.doc) for c in cs),
            "image_text": image_text,
            "annotation_text": " ".join(f["annotation_text"] for f in img_fields if f["annotation_text"]),
            "work_date": p.work_date.isoformat(),
            "work_date_source": p.work_date_source,
            "published_at": iso(published),
            "published_day": published.date().isoformat(),
            "updated_day": p.updated_at.date().isoformat(),
            "last_activity": iso(last),
            "has_images": bool(imgs),
            "has_annotations": any(((inst.annotation or {}).get("shapes") or []) for inst, _ in imgs),
            "unanswered": any(not c.resolved for c in questions),
            "resolved": any(c.resolved for c in questions),
            "comment_count": p.comment_count,
            "reaction_count": p.reaction_count,
            "image_count": len(imgs),
            "mentioned_ids": sorted(mentioned),
            "commenter_ids": sorted({str(c.author_id) for c in cs}),
            "reactor_ids": sorted(reactors),
            "imported_from": (p.source or {}).get("fileName") or "",
            "image_types": sorted({f["type"] for f in img_fields if f["type"]}),
            "images": img_fields,
        }
    return docs, remove
