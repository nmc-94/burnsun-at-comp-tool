"""a comp's share link

One table, and the grouping is the whole of it: a share is not a copy of a comp for the team's
own use, it is a *name* under which one frozen comp can be read with no session at all.

Nothing else moves in this revision, because nothing else has to. The public read route stores
nothing, and the comp routes gain two fields they compute from this table rather than hold.

Revision ID: 0006
Revises: 0005
Create Date: 2026-07-25
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "comp_share",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("comp_id", sa.Uuid(), nullable=False),
        sa.Column("slug", sa.String(length=64), nullable=False),
        # The frozen comp. A document rather than rows, because a snapshot must not drift with
        # comp_slot's schema — a later migration reshaping the live table would otherwise
        # rewrite what an old link shows.
        sa.Column("document", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "captured_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["comp_id"],
            ["comp.id"],
            name=op.f("fk_comp_share_comp_id_comp"),
            # CASCADE rather than 0005's SET NULL: a share names exactly one comp and means
            # nothing without it. There is no provenance here worth outliving its subject the
            # way a fork's snapshotted parent name is.
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_comp_share")),
        # Global and permanent, revoked rows included. A withdrawn slug must never be minted
        # again for something else, or an old link would open a comp nobody meant to show.
        sa.UniqueConstraint("slug", name=op.f("uq_comp_share_slug")),
    )
    # A plain index as well as the partial one below, unlike comp_tag's composite: that partial
    # index covers only live rows, so it cannot serve the cascade when a deleted comp still has
    # revoked shares hanging off it.
    op.create_index(op.f("ix_comp_share_comp_id"), "comp_share", ["comp_id"], unique=False)
    # At most one live share per comp. Postgres treats NULLs as distinct, which is exactly what
    # makes "revoked_at IS NULL" the right predicate: any number of withdrawn rows, one live.
    op.create_index(
        "uq_comp_share_one_live",
        "comp_share",
        ["comp_id"],
        unique=True,
        postgresql_where=sa.text("revoked_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_comp_share_one_live", table_name="comp_share")
    op.drop_index(op.f("ix_comp_share_comp_id"), table_name="comp_share")
    op.drop_table("comp_share")
