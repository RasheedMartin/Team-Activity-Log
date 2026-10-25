"""Roles on collections and notebooks: viewer / editor / owner per person.

Revision ID: 0007
Revises: 0006
"""

import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "collection_members",
        sa.Column("collection_id", sa.UUID(), sa.ForeignKey("collections.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("user_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("role", sa.String(10), nullable=False),
        sa.CheckConstraint("role in ('viewer','editor','owner')", name="collection_members_role"),
    )


def downgrade() -> None:
    op.drop_table("collection_members")
