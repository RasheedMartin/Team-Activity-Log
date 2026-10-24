"""The posts index (§B4). Versioned name + alias, so mappings can change with zero downtime:
create posts_v2, reindex from Postgres, swap the alias (`tal reindex --new-version`).

One document per *published, not deleted* post. Drafts are never indexed. Comments and images
are folded in: their text for full-text search, and images as `nested` objects so image-level
conditions ("a chart whose text contains keV") must hold for the same image.
"""

from __future__ import annotations

MAPPING_VERSION = 1

TEXT = {"type": "text", "analyzer": "text_en"}
KW = {"type": "keyword"}
WILD = {"type": "wildcard"}  # case-insensitive substring filters ("contains")

SETTINGS = {
    "number_of_shards": 1,
    "refresh_interval": "1s",
    "analysis": {
        "filter": {
            "en_possessive": {"type": "stemmer", "language": "possessive_english"},
            "en_stem": {"type": "stemmer", "language": "light_english"},
        },
        "analyzer": {"text_en": {"type": "custom", "tokenizer": "standard", "filter": ["lowercase", "asciifolding", "en_possessive", "en_stem"]}},
    },
}

POSTS = {
    "dynamic": "strict",
    "properties": {
        "post_id": KW,
        "org_id": KW,
        "workspace_id": KW,
        "status": KW,
        "visibility": KW,
        "author_id": KW,
        "co_author_ids": KW,
        "author_ids": KW,
        "tag_ids": KW,
        "collection_ids": KW,
        "title": TEXT,
        "summary": TEXT,
        "body": TEXT,
        "tag_text": TEXT,
        "comment_text": TEXT,
        "image_text": TEXT,
        "annotation_text": TEXT,
        "work_date": {"type": "date", "format": "strict_date"},
        "work_date_source": KW,
        "published_at": {"type": "date"},
        "published_day": {"type": "date", "format": "strict_date"},
        "updated_day": {"type": "date", "format": "strict_date"},
        "last_activity": {"type": "date"},
        "has_images": {"type": "boolean"},
        "has_annotations": {"type": "boolean"},
        "unanswered": {"type": "boolean"},
        "resolved": {"type": "boolean"},
        "comment_count": {"type": "integer"},
        "reaction_count": {"type": "integer"},
        "image_count": {"type": "integer"},
        "mentioned_ids": KW,
        "commenter_ids": KW,
        "reactor_ids": KW,
        "imported_from": WILD,
        "image_types": KW,
        "images": {
            "type": "nested",
            "properties": {
                "instance_id": KW,
                "type": KW,
                "ocr_text": WILD,
                "figure_label": WILD,
                "filename": WILD,
                "captured_day": {"type": "date", "format": "strict_date"},
                "width": {"type": "integer"},
                "height": {"type": "integer"},
                "custom": {"type": "flattened"},
                "annotation_text": WILD,
            },
        },
    },
}


def index_name(prefix: str, version: int = MAPPING_VERSION) -> str:
    return f"{prefix}_posts_v{version}"


def alias_name(prefix: str) -> str:
    return f"{prefix}_posts"
