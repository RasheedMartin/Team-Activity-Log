"""Saved-search alerts: follow a saved search; new matches arrive in Activity (and by email digest).

Revision ID: 0012
Revises: 0011
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "search_alerts",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("view_id", sa.UUID(), sa.ForeignKey("saved_views.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("user_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("mode", sa.String(10), nullable=False),
        sa.Column("checked_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("recent_ids", JSONB(), server_default="[]", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("view_id", "user_id", name="search_alerts_view_user"),
    )
    # Alert notifications name a saved search and a count instead of a comment and an actor.
    op.add_column("notifications", sa.Column("saved_view_id", sa.UUID(), sa.ForeignKey("saved_views.id", ondelete="CASCADE"), nullable=True))
    op.add_column("notifications", sa.Column("count", sa.Integer(), nullable=True))
    op.alter_column("notifications", "comment_id", nullable=True)
    op.alter_column("notifications", "actor_id", nullable=True)
    # Each alert round asks which workspaces had posts published lately; keep that an index lookup.
    op.create_index("posts_ws_published", "posts", ["workspace_id", "published_at"], postgresql_where=sa.text("status = 'published' and deleted_at is null"))


def downgrade() -> None:
    op.drop_index("posts_ws_published", table_name="posts")
    op.execute("DELETE FROM notifications WHERE kind = 'alert'")
    op.alter_column("notifications", "actor_id", nullable=False)
    op.alter_column("notifications", "comment_id", nullable=False)
    op.drop_column("notifications", "count")
    op.drop_column("notifications", "saved_view_id")
    op.drop_table("search_alerts")
