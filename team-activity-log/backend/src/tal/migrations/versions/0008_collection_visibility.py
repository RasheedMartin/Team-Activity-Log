"""Collections and notebooks: visible to the whole workspace, or only to the people shared with.

Revision ID: 0008
Revises: 0007
"""

import sqlalchemy as sa
from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("collections", sa.Column("visibility", sa.String(12), server_default="workspace", nullable=False))
    op.create_check_constraint("collections_visibility", "collections", "visibility in ('workspace','people')")


def downgrade() -> None:
    op.drop_constraint("collections_visibility", "collections")
    op.drop_column("collections", "visibility")
