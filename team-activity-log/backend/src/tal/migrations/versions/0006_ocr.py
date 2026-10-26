"""OCR: encrypted cloud OCR keys per org, and a quick way to find images waiting to be read.

Revision ID: 0006
Revises: 0005
"""

import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("organizations", sa.Column("ocr_secret", sa.Text(), nullable=True))
    op.execute("CREATE INDEX assets_ocr_waiting ON assets ((metadata->>'ocrState')) WHERE metadata->>'ocrState' IN ('pending', 'running')")
    # Images uploaded before OCR existed get read too.
    op.execute("UPDATE assets SET metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{ocrState}', '\"pending\"') WHERE coalesce(metadata->>'ocrState', 'none') = 'none'")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS assets_ocr_waiting")
    op.drop_column("organizations", "ocr_secret")
