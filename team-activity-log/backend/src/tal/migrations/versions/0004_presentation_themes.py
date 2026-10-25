"""Presentation settings (slide theme) on posts and collections.

Revision ID: 0004
Revises: 0003
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("posts", sa.Column("presentation", JSONB(), nullable=True))
    op.add_column("collections", sa.Column("presentation", JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("collections", "presentation")
    op.drop_column("posts", "presentation")
