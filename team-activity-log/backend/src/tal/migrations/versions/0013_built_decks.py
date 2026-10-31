"""Decks built in the app (owner request: a deck without PowerPoint): collection kind "deck".

Revision ID: 0013
Revises: 0012
"""

from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("collections_kind", "collections", type_="check")
    op.create_check_constraint("collections_kind", "collections", "kind in ('manual','deck_import','deck','saved_selection','notebook')")


def downgrade() -> None:
    op.execute("UPDATE collections SET kind = 'notebook' WHERE kind = 'deck'")
    op.drop_constraint("collections_kind", "collections", type_="check")
    op.create_check_constraint("collections_kind", "collections", "kind in ('manual','deck_import','saved_selection','notebook')")
