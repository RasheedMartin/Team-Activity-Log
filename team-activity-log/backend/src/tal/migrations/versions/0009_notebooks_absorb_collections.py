"""Hand-picked collections become notebooks (owner decision: Notebooks + Decks), and a notebook can
follow a tag (new published posts with it are added automatically).

Revision ID: 0009
Revises: 0008
"""

import sqlalchemy as sa
from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("collections", sa.Column("follows_tag", sa.Boolean(), server_default=sa.false(), nullable=False))
    # Notebook names are unique per workspace: number any that would clash, then convert.
    op.execute(
        """
        WITH ranked AS (
          SELECT id, ROW_NUMBER() OVER (PARTITION BY workspace_id, lower(name) ORDER BY (kind = 'notebook') DESC, created_at) AS rn
          FROM collections WHERE kind IN ('notebook', 'manual', 'saved_selection')
        )
        UPDATE collections c SET name = c.name || ' (' || r.rn || ')'
        FROM ranked r WHERE r.id = c.id AND r.rn > 1 AND c.kind <> 'notebook'
        """
    )
    op.execute("UPDATE collections SET kind = 'notebook' WHERE kind IN ('manual', 'saved_selection')")
    op.execute("UPDATE collections SET follows_tag = true WHERE kind = 'notebook' AND source_tag_id IS NOT NULL")  # made from a tag


def downgrade() -> None:
    op.drop_column("collections", "follows_tag")
