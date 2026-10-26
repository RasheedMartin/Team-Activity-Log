"""Postgres schema (system of record, §B1/§B9).

Relational columns for everything the app filters, joins, or constrains on; JSONB for documents
the UI owns (ProseMirror bodies, filter specs, import plans). No extensions are required, so any
hosted Postgres 14+ works with just a connection string. Tenancy is enforced in the service layer
(every query is scoped by org/workspace); row-level security is a later hardening step.
"""

from __future__ import annotations

import builtins
import datetime as dt
import uuid

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    type_annotation_map = {uuid.UUID: UUID(as_uuid=True), dict: JSONB, list: JSONB}


def ts(nullable: bool = True, default_now: bool = False):
    return mapped_column(DateTime(timezone=True), nullable=nullable, server_default=func.now() if default_now else None)


def fk(target: str, ondelete: str = "CASCADE", nullable: bool = False, index: bool = True):
    return mapped_column(UUID(as_uuid=True), ForeignKey(target, ondelete=ondelete), nullable=nullable, index=index)


ROLES = "('owner','admin','member','viewer')"

# ---------------------------------------------------------------- identity & tenancy


class User(Base):
    __tablename__ = "users"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(320))
    name: Mapped[str] = mapped_column(String(200))
    password_hash: Mapped[str | None] = mapped_column(Text)
    avatar_url: Mapped[str | None] = mapped_column(Text)
    title: Mapped[str | None] = mapped_column(String(200))
    bio: Mapped[str | None] = mapped_column(Text)
    pronouns: Mapped[str | None] = mapped_column(String(50))
    timezone: Mapped[str | None] = mapped_column(String(64))
    preferences: Mapped[dict | None] = mapped_column(JSONB)
    last_workspace_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    email_verified_at: Mapped[dt.datetime | None] = ts()
    deactivated_at: Mapped[dt.datetime | None] = ts()
    created_at: Mapped[dt.datetime] = ts(False, True)
    __table_args__ = (Index("users_email_lower_key", func.lower(text("email")), unique=True),)


class Session(Base):
    """Cookie sessions. The cookie holds a random token; only its SHA-256 is stored."""

    __tablename__ = "sessions"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    user_id: Mapped[uuid.UUID] = fk("users.id")
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    device: Mapped[str] = mapped_column(String(200), default="")
    ip: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[dt.datetime] = ts(False, True)
    expires_at: Mapped[dt.datetime] = ts(False)
    revoked_at: Mapped[dt.datetime | None] = ts()


class Identity(Base):
    """A sign-in method linked to a user other than a password (Google today; Microsoft/SAML later)."""

    __tablename__ = "identities"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    user_id: Mapped[uuid.UUID] = fk("users.id")
    provider: Mapped[str] = mapped_column(String(20))
    subject: Mapped[str] = mapped_column(String(255))  # the provider's stable user id ("sub")
    email: Mapped[str | None] = mapped_column(String(320))
    created_at: Mapped[dt.datetime] = ts(False, True)
    last_used_at: Mapped[dt.datetime | None] = ts()
    __table_args__ = (UniqueConstraint("provider", "subject"),)


class AuthToken(Base):
    """One-time links: email verification, magic sign-in, password reset."""

    __tablename__ = "auth_tokens"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    kind: Mapped[str] = mapped_column(String(16))
    user_id: Mapped[uuid.UUID] = fk("users.id")
    expires_at: Mapped[dt.datetime] = ts(False)
    __table_args__ = (CheckConstraint("kind in ('verify','magic','reset')", name="auth_tokens_kind"),)


class Organization(Base):
    __tablename__ = "organizations"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    slug: Mapped[str] = mapped_column(String(60), unique=True)
    # Billing (docs/PRICING.md). Entitlements live in code (tal.plans), not rows.
    plan: Mapped[str] = mapped_column(String(20), server_default="free")
    billing_status: Mapped[str] = mapped_column(String(20), server_default="active")
    billing_customer_id: Mapped[str | None] = mapped_column(String(100))
    billing_subscription_id: Mapped[str | None] = mapped_column(String(100))
    trial_ends_at: Mapped[dt.datetime | None] = ts()
    storage_quota_bytes: Mapped[int | None] = mapped_column(BigInteger)
    settings: Mapped[dict] = mapped_column(JSONB, server_default="{}")
    ocr_secret: Mapped[str | None] = mapped_column(Text)  # encrypted cloud OCR keys (tal.ocr.seal); never in a view
    created_at: Mapped[dt.datetime] = ts(False, True)
    __table_args__ = (
        CheckConstraint("plan in ('free','team','business','enterprise')", name="organizations_plan"),
        CheckConstraint("billing_status in ('active','trialing','past_due','canceled')", name="organizations_billing_status"),
    )


class Membership(Base):
    __tablename__ = "memberships"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    org_id: Mapped[uuid.UUID] = fk("organizations.id")
    user_id: Mapped[uuid.UUID] = fk("users.id")
    role: Mapped[str] = mapped_column(String(10))
    status: Mapped[str] = mapped_column(String(12), server_default="active")
    created_at: Mapped[dt.datetime] = ts(False, True)
    __table_args__ = (
        UniqueConstraint("org_id", "user_id"),
        CheckConstraint(f"role in {ROLES}", name="memberships_role"),
        CheckConstraint("status in ('active','invited','deactivated')", name="memberships_status"),
    )


class Workspace(Base):
    __tablename__ = "workspaces"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    org_id: Mapped[uuid.UUID] = fk("organizations.id")
    name: Mapped[str] = mapped_column(String(200))
    slug: Mapped[str] = mapped_column(String(60))
    description: Mapped[str | None] = mapped_column(Text)
    all_org_members: Mapped[bool] = mapped_column(Boolean, server_default="true")
    archived: Mapped[bool] = mapped_column(Boolean, server_default="false")
    created_at: Mapped[dt.datetime] = ts(False, True)
    __table_args__ = (UniqueConstraint("org_id", "slug"),)


class WorkspaceMember(Base):
    """Explicit access to a workspace (all-org workspaces don't need rows)."""

    __tablename__ = "workspace_members"
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True)


class Invite(Base):
    __tablename__ = "invites"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    org_id: Mapped[uuid.UUID] = fk("organizations.id")
    email: Mapped[str] = mapped_column(String(320))
    name: Mapped[str | None] = mapped_column(String(200))
    role: Mapped[str] = mapped_column(String(10))
    workspace_ids: Mapped[list[uuid.UUID]] = mapped_column(ARRAY(UUID(as_uuid=True)), server_default="{}")
    status: Mapped[str] = mapped_column(String(10), server_default="pending")
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[dt.datetime] = ts(False)
    invited_by: Mapped[uuid.UUID | None] = fk("users.id", "SET NULL", True, False)
    created_at: Mapped[dt.datetime] = ts(False, True)
    __table_args__ = (
        CheckConstraint(f"role in {ROLES}", name="invites_role"),
        CheckConstraint("status in ('pending','accepted','revoked')", name="invites_status"),
    )


class InviteLink(Base):
    """Shareable join links. The token is shown to admins, so it is stored as issued."""

    __tablename__ = "invite_links"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    org_id: Mapped[uuid.UUID] = fk("organizations.id")
    token: Mapped[str] = mapped_column(String(80), unique=True)
    role_cap: Mapped[str] = mapped_column(String(10))
    expires_at: Mapped[dt.datetime] = ts(False)


# ---------------------------------------------------------------- tags, posts


class TagGroup(Base):
    __tablename__ = "tag_groups"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    org_id: Mapped[uuid.UUID] = fk("organizations.id")
    name: Mapped[str] = mapped_column(String(100))


class Tag(Base):
    __tablename__ = "tags"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    org_id: Mapped[uuid.UUID] = fk("organizations.id")
    name: Mapped[str] = mapped_column(String(100))
    color: Mapped[str] = mapped_column(String(16))
    group_id: Mapped[uuid.UUID | None] = fk("tag_groups.id", "SET NULL", True, False)
    __table_args__ = (Index("tags_org_name_key", "org_id", func.lower(text("name")), unique=True),)


class Post(Base):
    __tablename__ = "posts"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    org_id: Mapped[uuid.UUID] = fk("organizations.id")
    workspace_id: Mapped[uuid.UUID] = fk("workspaces.id")
    author_id: Mapped[uuid.UUID] = fk("users.id", "RESTRICT")
    title: Mapped[str] = mapped_column(Text, server_default="")
    summary: Mapped[str | None] = mapped_column(Text)
    work_date: Mapped[dt.date] = mapped_column(Date)
    work_date_source: Mapped[str] = mapped_column(String(16), server_default="user")
    status: Mapped[str] = mapped_column(String(10), server_default="draft")
    visibility: Mapped[str] = mapped_column(String(10), server_default="visible")
    hidden_reason: Mapped[str | None] = mapped_column(Text)
    hidden_by: Mapped[uuid.UUID | None] = fk("users.id", "SET NULL", True, False)
    hidden_at: Mapped[dt.datetime | None] = ts()
    blocks: Mapped[list] = mapped_column(JSONB, server_default="[]")
    reactions: Mapped[dict] = mapped_column(JSONB, server_default="{}")
    source: Mapped[dict | None] = mapped_column(JSONB)
    presentation: Mapped[dict | None] = mapped_column(JSONB)  # {"theme": SlideTheme} for presenting
    revision: Mapped[int] = mapped_column(Integer, server_default="0")
    version: Mapped[int] = mapped_column(Integer, server_default="1")
    comment_count: Mapped[int] = mapped_column(Integer, server_default="0")
    reaction_count: Mapped[int] = mapped_column(Integer, server_default="0")
    image_count: Mapped[int] = mapped_column(Integer, server_default="0")
    created_at: Mapped[dt.datetime] = ts(False, True)
    updated_at: Mapped[dt.datetime] = ts(False, True)
    published_at: Mapped[dt.datetime | None] = ts()
    deleted_at: Mapped[dt.datetime | None] = ts()
    __table_args__ = (
        CheckConstraint("status in ('draft','published')", name="posts_status"),
        CheckConstraint("visibility in ('visible','hidden')", name="posts_visibility"),
        CheckConstraint("work_date_source in ('user','guessed','import_fallback')", name="posts_work_date_source"),
        CheckConstraint("status = 'published' or published_at is null", name="posts_draft_unpublished"),
        Index("posts_ws_status", "workspace_id", "status", "deleted_at"),
        Index("posts_author_drafts", "author_id", "workspace_id", postgresql_where=text("status = 'draft' and deleted_at is null")),
        # Saved-search alerts ask "anything published here lately?" every round (tal.alerts).
        Index("posts_ws_published", "workspace_id", "published_at", postgresql_where=text("status = 'published' and deleted_at is null")),
    )


class PostCoAuthor(Base):
    __tablename__ = "post_co_authors"
    post_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("posts.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True)
    position: Mapped[int] = mapped_column(Integer, server_default="0")


class PostTag(Base):
    __tablename__ = "post_tags"
    post_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("posts.id", ondelete="CASCADE"), primary_key=True)
    tag_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True, index=True)
    position: Mapped[int] = mapped_column(Integer, server_default="0")


class PostRevision(Base):
    __tablename__ = "post_revisions"
    post_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("posts.id", ondelete="CASCADE"), primary_key=True)
    revision: Mapped[int] = mapped_column(Integer, primary_key=True)
    edited_by: Mapped[uuid.UUID] = fk("users.id", "RESTRICT", False, False)
    edited_at: Mapped[dt.datetime] = ts(False, True)
    title: Mapped[str] = mapped_column(Text)
    blocks: Mapped[list] = mapped_column(JSONB)


# ---------------------------------------------------------------- collections, saved searches, favorites


class CollectionRow(Base):
    __tablename__ = "collections"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    org_id: Mapped[uuid.UUID] = fk("organizations.id")
    workspace_id: Mapped[uuid.UUID] = fk("workspaces.id")
    name: Mapped[str] = mapped_column(String(300))
    kind: Mapped[str] = mapped_column(String(20), server_default="manual")
    created_by: Mapped[uuid.UUID] = fk("users.id", "RESTRICT", False, False)
    source_tag_id: Mapped[uuid.UUID | None] = fk("tags.id", "SET NULL", True, False)
    presentation: Mapped[dict | None] = mapped_column(JSONB)  # {"theme": SlideTheme} for presenting
    # "workspace": everyone in it can view; "people": only those it's shared with (collection_members).
    visibility: Mapped[str] = mapped_column(String(12), server_default="workspace")
    # A notebook following source_tag_id: newly published posts with that tag are appended.
    follows_tag: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    created_at: Mapped[dt.datetime] = ts(False, True)
    updated_at: Mapped[dt.datetime] = ts(False, True)
    __table_args__ = (
        CheckConstraint("kind in ('manual','deck_import','saved_selection','notebook')", name="collections_kind"),
        CheckConstraint("visibility in ('workspace','people')", name="collections_visibility"),
        # One notebook per tag (survives renames); unique notebook names per workspace.
        Index("collections_tag_notebook", "workspace_id", "source_tag_id", unique=True, postgresql_where=text("kind = 'notebook' and source_tag_id is not null")),
        Index("collections_notebook_name", "workspace_id", func.lower(text("name")), unique=True, postgresql_where=text("kind = 'notebook'")),
    )


class Attachment(Base):
    """A file attached to a post (owner request): kept in object storage, deduplicated per org by
    content; `text` is what search reads (extracted from PDF, Word, Excel, CSV, plain text)."""

    __tablename__ = "attachments"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    org_id: Mapped[uuid.UUID] = fk("organizations.id")
    sha256: Mapped[str] = mapped_column(String(64))
    filename: Mapped[str] = mapped_column(Text)
    mime: Mapped[str] = mapped_column(String(200))
    bytes: Mapped[int] = mapped_column(BigInteger)
    text: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[uuid.UUID | None] = fk("users.id", "SET NULL", True)
    created_at: Mapped[dt.datetime] = ts(False, True)
    __table_args__ = (UniqueConstraint("org_id", "sha256"),)


class Sheet(Base):
    """A spreadsheet imported as data (owner request: Sheets). Tabs hold the tables; charts are
    saved views of them that posts can embed."""

    __tablename__ = "sheets"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    org_id: Mapped[uuid.UUID] = fk("organizations.id")
    workspace_id: Mapped[uuid.UUID] = fk("workspaces.id")
    name: Mapped[str] = mapped_column(String(300))
    filename: Mapped[str] = mapped_column(Text)
    sha256: Mapped[str] = mapped_column(String(64))
    bytes: Mapped[int] = mapped_column(BigInteger)
    search_text: Mapped[str] = mapped_column(Text, server_default="")
    created_by: Mapped[uuid.UUID | None] = fk("users.id", "SET NULL", True)
    created_at: Mapped[dt.datetime] = ts(False, True)
    updated_at: Mapped[dt.datetime] = ts(False, True)


class SheetTab(Base):
    __tablename__ = "sheet_tabs"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    sheet_id: Mapped[uuid.UUID] = fk("sheets.id")
    position: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String(300))
    columns: Mapped[list] = mapped_column(JSONB)  # [{key, name, type}]
    rows: Mapped[list] = mapped_column(JSONB)  # [[value, …], …] in column order
    row_count: Mapped[int] = mapped_column(Integer)
    truncated: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))


class SheetChart(Base):
    __tablename__ = "sheet_charts"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    sheet_id: Mapped[uuid.UUID] = fk("sheets.id")
    tab_id: Mapped[uuid.UUID] = fk("sheet_tabs.id")
    name: Mapped[str] = mapped_column(String(300))
    spec: Mapped[dict] = mapped_column(JSONB)  # {type, x, y: [keys], groupBy?, agg}
    created_by: Mapped[uuid.UUID | None] = fk("users.id", "SET NULL", True)
    created_at: Mapped[dt.datetime] = ts(False, True)


class CollectionMember(Base):
    """Who may change a collection or notebook beyond viewing (everyone in the workspace can view).
    Its creator is always an owner and has no row; everyone else is a viewer unless listed here."""

    __tablename__ = "collection_members"
    collection_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("collections.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    role: Mapped[str] = mapped_column(String(10))
    __table_args__ = (CheckConstraint("role in ('viewer','editor','owner')", name="collection_members_role"),)


class CollectionPost(Base):
    __tablename__ = "collection_posts"
    collection_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("collections.id", ondelete="CASCADE"), primary_key=True)
    post_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("posts.id", ondelete="CASCADE"), primary_key=True, index=True)
    position: Mapped[int] = mapped_column(Integer)


class SavedView(Base):
    """A saved search (UI name). Runs its FilterSpec against Elasticsearch."""

    __tablename__ = "saved_views"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    org_id: Mapped[uuid.UUID] = fk("organizations.id")
    workspace_id: Mapped[uuid.UUID] = fk("workspaces.id")
    owner_id: Mapped[uuid.UUID] = fk("users.id")
    name: Mapped[str] = mapped_column(String(300))
    filter_spec: Mapped[dict] = mapped_column(JSONB)
    shared: Mapped[bool] = mapped_column(Boolean, server_default="false")
    created_at: Mapped[dt.datetime] = ts(False, True)
    updated_at: Mapped[dt.datetime] = ts(False, True)


class SearchAlert(Base):
    """Someone follows a saved search (theirs, or a shared one): new posts that match it go to their
    Activity ("instant"), or to Activity plus an email digest ("daily", "weekly"). Run by tal.alerts."""

    __tablename__ = "search_alerts"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    view_id: Mapped[uuid.UUID] = fk("saved_views.id")
    user_id: Mapped[uuid.UUID] = fk("users.id")
    mode: Mapped[str] = mapped_column(String(10))  # instant | daily | weekly
    checked_at: Mapped[dt.datetime] = ts(False, True)
    # Posts already reported from the overlap window (index lag), so none is reported twice.
    recent_ids: Mapped[list] = mapped_column(JSONB, server_default="[]")
    created_at: Mapped[dt.datetime] = ts(False, True)
    __table_args__ = (UniqueConstraint("view_id", "user_id", name="search_alerts_view_user"),)


class Pin(Base):
    """Favorites in the sidebar (UI name). Personal, ordered."""

    __tablename__ = "pins"
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), primary_key=True)
    kind: Mapped[str] = mapped_column(String(12), primary_key=True)
    item_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    position: Mapped[int] = mapped_column(Integer)
    __table_args__ = (CheckConstraint("kind in ('view','collection','notebook')", name="pins_kind"),)


# ---------------------------------------------------------------- assets & images


class Asset(Base):
    """An image, stored once per org by content hash (§B7)."""

    __tablename__ = "assets"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    org_id: Mapped[uuid.UUID] = fk("organizations.id")
    mime: Mapped[str] = mapped_column(String(100))
    bytes: Mapped[int] = mapped_column(BigInteger)
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64))
    original_filename: Mapped[str | None] = mapped_column(Text)
    blurhash: Mapped[str | None] = mapped_column(String(100))
    dominant_colors: Mapped[list[str]] = mapped_column(ARRAY(String(9)), server_default="{}")
    processing: Mapped[str] = mapped_column(String(10), server_default="pending")
    metadata_: Mapped[dict] = mapped_column("metadata", JSONB, server_default="{}")
    variants: Mapped[list] = mapped_column(JSONB, server_default="[]")  # [{name,width,height}]
    created_by: Mapped[uuid.UUID | None] = fk("users.id", "SET NULL", True, False)
    created_at: Mapped[dt.datetime] = ts(False, True)
    __table_args__ = (UniqueConstraint("org_id", "sha256"),)


class AssetBlob(Base):
    """Image bytes per variant, when STORAGE is Postgres (the default: no extra credentials)."""

    __tablename__ = "asset_blobs"
    asset_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("assets.id", ondelete="CASCADE"), primary_key=True)
    variant: Mapped[str] = mapped_column(String(12), primary_key=True)
    mime: Mapped[str] = mapped_column(String(100))
    data: Mapped[bytes] = mapped_column(LargeBinary)


class Blob(Base):
    """Files that aren't org images (profile photos), when STORAGE is Postgres. Keyed like S3."""

    __tablename__ = "blobs"
    key: Mapped[str] = mapped_column(String(300), primary_key=True)
    mime: Mapped[str] = mapped_column(String(100))
    data: Mapped[builtins.bytes] = mapped_column(LargeBinary)
    created_at: Mapped[dt.datetime] = ts(False, True)


class Upload(Base):
    """A pending upload between presign and complete."""

    __tablename__ = "uploads"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    org_id: Mapped[uuid.UUID] = fk("organizations.id")
    user_id: Mapped[uuid.UUID] = fk("users.id")
    filename: Mapped[str] = mapped_column(Text)
    mime: Mapped[str] = mapped_column(String(100))
    bytes: Mapped[int] = mapped_column(BigInteger)
    source_kind: Mapped[str] = mapped_column(String(16))
    # builtins.bytes: the `bytes` column above shadows the builtin inside this class.
    data: Mapped[builtins.bytes | None] = mapped_column(LargeBinary, nullable=True)
    created_at: Mapped[dt.datetime] = ts(False, True)


class ImageInstance(Base):
    __tablename__ = "image_instances"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    org_id: Mapped[uuid.UUID] = fk("organizations.id")
    asset_id: Mapped[uuid.UUID] = fk("assets.id", "RESTRICT")
    post_id: Mapped[uuid.UUID | None] = fk("posts.id", "CASCADE", True)
    comment_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), index=True)
    caption: Mapped[str | None] = mapped_column(Text)
    alt_text: Mapped[str | None] = mapped_column(Text)
    figure_label: Mapped[str | None] = mapped_column(String(100))
    tags: Mapped[list[str]] = mapped_column(ARRAY(Text), server_default="{}")
    custom_fields: Mapped[dict] = mapped_column(JSONB, server_default="{}")
    annotation: Mapped[dict | None] = mapped_column(JSONB)  # {shapes, version}
    created_at: Mapped[dt.datetime] = ts(False, True)


# ---------------------------------------------------------------- discussion


class CommentRow(Base):
    __tablename__ = "comments"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    org_id: Mapped[uuid.UUID] = fk("organizations.id")
    workspace_id: Mapped[uuid.UUID] = fk("workspaces.id", "CASCADE", False, False)
    post_id: Mapped[uuid.UUID] = fk("posts.id")
    parent_id: Mapped[uuid.UUID | None] = fk("comments.id", "SET NULL", True)
    author_id: Mapped[uuid.UUID] = fk("users.id", "RESTRICT", False, False)
    doc: Mapped[dict | None] = mapped_column(JSONB)
    image_instance_ids: Mapped[list[uuid.UUID]] = mapped_column(ARRAY(UUID(as_uuid=True)), server_default="{}")
    anchor: Mapped[dict | None] = mapped_column(JSONB)
    is_question: Mapped[bool] = mapped_column(Boolean, server_default="false")
    resolved: Mapped[bool] = mapped_column(Boolean, server_default="false")
    accepted_answer_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    hidden: Mapped[bool] = mapped_column(Boolean, server_default="false")
    reactions: Mapped[dict] = mapped_column(JSONB, server_default="{}")
    version: Mapped[int] = mapped_column(Integer, server_default="1")
    created_at: Mapped[dt.datetime] = ts(False, True)
    edited_at: Mapped[dt.datetime | None] = ts()
    deleted_at: Mapped[dt.datetime | None] = ts()


class NotificationRow(Base):
    __tablename__ = "notifications"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    user_id: Mapped[uuid.UUID] = fk("users.id")
    org_id: Mapped[uuid.UUID] = fk("organizations.id", "CASCADE", False, False)
    workspace_id: Mapped[uuid.UUID] = fk("workspaces.id", "CASCADE", False, False)
    kind: Mapped[str] = mapped_column(String(10))
    post_id: Mapped[uuid.UUID] = fk("posts.id", "CASCADE", False, False)
    comment_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))  # none for alerts
    actor_id: Mapped[uuid.UUID | None] = fk("users.id", "CASCADE", True, False)  # none for alerts
    # kind "alert": the saved search that matched and how many new posts (post_id is the newest).
    saved_view_id: Mapped[uuid.UUID | None] = fk("saved_views.id", "CASCADE", True, False)
    count: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[dt.datetime] = ts(False, True)
    read_at: Mapped[dt.datetime | None] = ts()
    __table_args__ = (Index("notifications_user_recent", "user_id", "created_at"),)


# ---------------------------------------------------------------- import


class ImportJobRow(Base):
    __tablename__ = "import_jobs"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    org_id: Mapped[uuid.UUID] = fk("organizations.id")
    workspace_id: Mapped[uuid.UUID] = fk("workspaces.id")
    user_id: Mapped[uuid.UUID] = fk("users.id")
    status: Mapped[str] = mapped_column(String(12))
    progress: Mapped[float] = mapped_column(Float, server_default="0")
    mode: Mapped[str] = mapped_column(String(12))
    source_filename: Mapped[str] = mapped_column(Text)
    source_bytes: Mapped[int] = mapped_column(BigInteger, server_default="0")
    source_sha256: Mapped[str | None] = mapped_column(String(64))
    slide_count: Mapped[int] = mapped_column(Integer, server_default="0")
    defaults: Mapped[dict] = mapped_column(JSONB)
    items: Mapped[list] = mapped_column(JSONB, server_default="[]")
    collection_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    error: Mapped[str | None] = mapped_column(Text)
    report: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[dt.datetime] = ts(False, True)
    __table_args__ = (
        CheckConstraint("status in ('uploading','parsing','review','committing','done','failed')", name="import_jobs_status"),
        CheckConstraint("mode in ('per_slide','whole_deck','by_section')", name="import_jobs_mode"),
    )


class ImportSource(Base):
    """The uploaded deck, held only until commit (§W5.4: originals aren't retained)."""

    __tablename__ = "import_sources"
    job_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("import_jobs.id", ondelete="CASCADE"), primary_key=True)
    data: Mapped[bytes] = mapped_column(LargeBinary)
    expires_at: Mapped[dt.datetime] = ts(False)


# ---------------------------------------------------------------- ops


class Outbox(Base):
    """Transactional outbox (§B5): written with the change, drained into Elasticsearch."""

    __tablename__ = "outbox"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    entity: Mapped[str] = mapped_column(String(20))
    entity_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    created_at: Mapped[dt.datetime] = ts(False, True)
    processed_at: Mapped[dt.datetime | None] = ts()
    attempts: Mapped[int] = mapped_column(Integer, server_default="0")
    last_error: Mapped[str | None] = mapped_column(Text)
    __table_args__ = (Index("outbox_pending", "id", postgresql_where=text("processed_at is null")),)


class Email(Base):
    """Outgoing email, written in the same transaction as the action that causes it (an outbox).
    The mailer delivers pending rows through the configured provider; /dev lists them."""

    __tablename__ = "emails"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    to: Mapped[str] = mapped_column(String(320))
    subject: Mapped[str] = mapped_column(Text)
    body: Mapped[str] = mapped_column(Text)
    link: Mapped[str | None] = mapped_column(Text)
    sent_at: Mapped[dt.datetime] = ts(False, True)  # when the app queued it
    status: Mapped[str] = mapped_column(String(10), server_default="pending")
    attempts: Mapped[int] = mapped_column(Integer, server_default="0")
    last_error: Mapped[str | None] = mapped_column(Text)
    delivered_at: Mapped[dt.datetime | None] = ts()
    __table_args__ = (
        CheckConstraint("status in ('pending','sent','failed','logged')", name="emails_status"),
        Index("emails_pending", "sent_at", postgresql_where=text("status = 'pending'")),
    )
