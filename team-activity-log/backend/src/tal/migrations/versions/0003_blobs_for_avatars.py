"""Generic blob storage (profile photos) for STORAGE=postgres; S3 uses the same keys.

Revision ID: 0003
Revises: 0002
"""

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "blobs",
        sa.Column("key", sa.String(300), primary_key=True),
        sa.Column("mime", sa.String(100), nullable=False),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    # Profile photos used to be stored inline as data: URLs; they now live in storage and are
    # served by the API. Inline ones can't be migrated safely in SQL, so they are cleared.
    op.execute("update users set avatar_url = null where avatar_url like 'data:%'")


def downgrade() -> None:
    op.drop_table("blobs")
