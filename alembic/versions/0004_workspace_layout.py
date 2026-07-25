"""workspace layout: one saved board arrangement per character per team

Revision ID: 0004
Revises: 0003
Create Date: 2026-07-25
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "workspace_layout",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("team_id", sa.Uuid(), nullable=False),
        sa.Column("character_id", sa.BigInteger(), nullable=False),
        sa.Column("document", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        # Cascading in the database and not only in the ORM: every table hanging off a team
        # cascades, and a hand-run cleanup should not have to know this one is special.
        sa.ForeignKeyConstraint(
            ["team_id"],
            ["team.id"],
            name=op.f("fk_workspace_layout_team_id_team"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_workspace_layout")),
        # One arrangement per character per team, and the index both routes look up by. It
        # leads with team_id, so it serves the cascade above too and no separate index on
        # team_id is needed.
        sa.UniqueConstraint(
            "team_id", "character_id", name=op.f("uq_workspace_layout_team_id_character_id")
        ),
    )


def downgrade() -> None:
    op.drop_table("workspace_layout")
