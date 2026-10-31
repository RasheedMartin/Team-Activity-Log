"""Sheets v2: editable sheets. Rows move out of one JSON value per tab into their own table (an edit
touches only the rows it changes); sheets get edit access and who last changed them.

Revision ID: 0014
Revises: 0013
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "sheet_rows",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("tab_id", sa.UUID(), sa.ForeignKey("sheet_tabs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("pos", sa.Float(), nullable=False),
        sa.Column("cells", JSONB(), nullable=False),
    )
    op.create_index("sheet_rows_tab_pos", "sheet_rows", ["tab_id", "pos"])
    # Each tab's rows, in order, become rows 1, 2, 3, … of the new table.
    op.execute("INSERT INTO sheet_rows (tab_id, pos, cells) SELECT t.id, r.ord, r.val FROM sheet_tabs t, jsonb_array_elements(t.rows) WITH ORDINALITY AS r(val, ord)")
    op.drop_column("sheet_tabs", "rows")
    # Column keys are never reused (a deleted column's key could still be in a chart).
    op.add_column("sheet_tabs", sa.Column("next_col", sa.Integer(), server_default="0", nullable=False))
    op.execute("UPDATE sheet_tabs SET next_col = jsonb_array_length(columns)")
    op.add_column("sheets", sa.Column("edit_access", sa.String(10), server_default="owner", nullable=False))
    op.add_column("sheets", sa.Column("updated_by", sa.UUID(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True))


def downgrade() -> None:
    op.drop_column("sheet_tabs", "next_col")
    op.drop_column("sheets", "updated_by")
    op.drop_column("sheets", "edit_access")
    op.add_column("sheet_tabs", sa.Column("rows", JSONB(), server_default="[]", nullable=False))
    op.execute("UPDATE sheet_tabs t SET rows = COALESCE((SELECT jsonb_agg(r.cells ORDER BY r.pos) FROM sheet_rows r WHERE r.tab_id = t.id), '[]')")
    op.drop_table("sheet_rows")
