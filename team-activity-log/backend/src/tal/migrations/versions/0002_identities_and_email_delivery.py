"""Google sign-in identities; email delivery tracking.

Revision ID: 0002
Revises: 0001
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "identities",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider", sa.String(20), nullable=False),
        sa.Column("subject", sa.String(255), nullable=False),
        sa.Column("email", sa.String(320), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("provider", "subject"),
    )
    op.create_index("ix_identities_user_id", "identities", ["user_id"])

    op.add_column("emails", sa.Column("status", sa.String(10), server_default="pending", nullable=False))
    op.add_column("emails", sa.Column("attempts", sa.Integer(), server_default="0", nullable=False))
    op.add_column("emails", sa.Column("last_error", sa.Text(), nullable=True))
    op.add_column("emails", sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True))
    # Mail queued before delivery existed was never meant to go out now.
    op.execute("update emails set status = 'logged'")
    op.create_check_constraint("emails_status", "emails", "status in ('pending','sent','failed','logged')")
    op.create_index("emails_pending", "emails", ["sent_at"], postgresql_where=sa.text("status = 'pending'"))


def downgrade() -> None:
    op.drop_index("emails_pending", table_name="emails")
    op.drop_constraint("emails_status", "emails")
    for col in ("delivered_at", "last_error", "attempts", "status"):
        op.drop_column("emails", col)
    op.drop_index("ix_identities_user_id", table_name="identities")
    op.drop_table("identities")
