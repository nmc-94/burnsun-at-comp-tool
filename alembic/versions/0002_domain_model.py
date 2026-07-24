"""domain model: rulesets, teams, grants, comps, slots, comments

Revision ID: 0002
Revises: 0001
Create Date: 2026-07-24
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
        "ruleset",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("slug", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("organizer", sa.String(length=200), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ruleset")),
        sa.UniqueConstraint("slug", name=op.f("uq_ruleset_slug")),
    )

    op.create_table(
        "ruleset_version",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("ruleset_id", sa.Uuid(), nullable=False),
        sa.Column("version_label", sa.String(length=64), nullable=False),
        sa.Column("source_url", sa.Text(), nullable=False),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["ruleset_id"],
            ["ruleset.id"],
            name=op.f("fk_ruleset_version_ruleset_id_ruleset"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ruleset_version")),
        sa.UniqueConstraint(
            "ruleset_id",
            "version_label",
            name=op.f("uq_ruleset_version_ruleset_id_version_label"),
        ),
    )
    op.create_index(
        op.f("ix_ruleset_version_ruleset_id"), "ruleset_version", ["ruleset_id"], unique=False
    )

    op.create_table(
        "team",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("owner_character_id", sa.BigInteger(), nullable=False),
        sa.Column("base_level", sa.SmallInteger(), server_default=sa.text("0"), nullable=False),
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
        sa.PrimaryKeyConstraint("id", name=op.f("pk_team")),
    )
    op.create_index(
        op.f("ix_team_owner_character_id"), "team", ["owner_character_id"], unique=False
    )

    op.create_table(
        "team_grant",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("team_id", sa.Uuid(), nullable=False),
        sa.Column("subject_kind", sa.String(length=16), nullable=False),
        sa.Column("subject_id", sa.BigInteger(), nullable=True),
        sa.Column("subject_name", sa.String(length=200), nullable=False),
        sa.Column("level", sa.SmallInteger(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["team_id"], ["team.id"], name=op.f("fk_team_grant_team_id_team"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_team_grant")),
        sa.UniqueConstraint(
            "team_id",
            "subject_kind",
            "subject_id",
            name=op.f("uq_team_grant_team_id_subject_kind_subject_id"),
        ),
    )
    op.create_index(
        "ix_team_grant_subject", "team_grant", ["subject_kind", "subject_id"], unique=False
    )
    op.create_index(op.f("ix_team_grant_team_id"), "team_grant", ["team_id"], unique=False)

    op.create_table(
        "comp",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("team_id", sa.Uuid(), nullable=False),
        sa.Column("ruleset_version_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("created_by_character_id", sa.BigInteger(), nullable=True),
        sa.Column("created_by_name", sa.String(length=200), nullable=True),
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
        sa.ForeignKeyConstraint(
            ["ruleset_version_id"],
            ["ruleset_version.id"],
            name=op.f("fk_comp_ruleset_version_id_ruleset_version"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["team_id"], ["team.id"], name=op.f("fk_comp_team_id_team"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_comp")),
    )
    op.create_index(
        op.f("ix_comp_ruleset_version_id"), "comp", ["ruleset_version_id"], unique=False
    )
    op.create_index(op.f("ix_comp_team_id"), "comp", ["team_id"], unique=False)

    op.create_table(
        "comp_slot",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("comp_id", sa.Uuid(), nullable=False),
        sa.Column("position", sa.SmallInteger(), nullable=False),
        sa.Column("type_id", sa.Integer(), nullable=False),
        sa.Column("is_flagship", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.ForeignKeyConstraint(
            ["comp_id"], ["comp.id"], name=op.f("fk_comp_slot_comp_id_comp"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_comp_slot")),
        sa.UniqueConstraint("comp_id", "position", name=op.f("uq_comp_slot_comp_id_position")),
    )
    op.create_index(op.f("ix_comp_slot_comp_id"), "comp_slot", ["comp_id"], unique=False)
    # Partial unique index: at most one slot per comp may carry the flagship designation.
    op.create_index(
        "uq_comp_slot_one_flagship",
        "comp_slot",
        ["comp_id"],
        unique=True,
        postgresql_where=sa.text("is_flagship"),
    )

    op.create_table(
        "comp_comment",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("comp_id", sa.Uuid(), nullable=False),
        sa.Column("author_character_id", sa.BigInteger(), nullable=True),
        sa.Column("author_name", sa.String(length=200), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["comp_id"],
            ["comp.id"],
            name=op.f("fk_comp_comment_comp_id_comp"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_comp_comment")),
    )
    op.create_index(
        "ix_comp_comment_comp_created", "comp_comment", ["comp_id", "created_at"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_comp_comment_comp_created", table_name="comp_comment")
    op.drop_table("comp_comment")
    op.drop_index(
        "uq_comp_slot_one_flagship",
        table_name="comp_slot",
        postgresql_where=sa.text("is_flagship"),
    )
    op.drop_index(op.f("ix_comp_slot_comp_id"), table_name="comp_slot")
    op.drop_table("comp_slot")
    op.drop_index(op.f("ix_comp_team_id"), table_name="comp")
    op.drop_index(op.f("ix_comp_ruleset_version_id"), table_name="comp")
    op.drop_table("comp")
    op.drop_index(op.f("ix_team_grant_team_id"), table_name="team_grant")
    op.drop_index("ix_team_grant_subject", table_name="team_grant")
    op.drop_table("team_grant")
    op.drop_index(op.f("ix_team_owner_character_id"), table_name="team")
    op.drop_table("team")
    op.drop_index(op.f("ix_ruleset_version_ruleset_id"), table_name="ruleset_version")
    op.drop_table("ruleset_version")
    op.drop_table("ruleset")
