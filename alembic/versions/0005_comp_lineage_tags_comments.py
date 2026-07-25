"""comp lineage, the archetype/tags namespaces, and an edited comment's timestamp

Three unrelated-looking additions that are all one thing: what a team says *about* a comp,
as opposed to what the comp contains.

Revision ID: 0005
Revises: 0004
Create Date: 2026-07-25
"""

import sqlalchemy as sa
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # The Archetype namespace: one value per comp, so a column.
    op.add_column("comp", sa.Column("archetype", sa.String(length=64), nullable=True))

    # Lineage. The id is the live link and the name is the record: a fork whose parent has
    # been deleted still says where it came from, which is the whole point of §4.1c.
    op.add_column("comp", sa.Column("forked_from_comp_id", sa.Uuid(), nullable=True))
    op.add_column("comp", sa.Column("forked_from_name", sa.String(length=200), nullable=True))
    op.add_column("comp", sa.Column("fork_kind", sa.String(length=16), nullable=True))
    op.create_foreign_key(
        op.f("fk_comp_forked_from_comp_id_comp"),
        "comp",
        "comp",
        ["forked_from_comp_id"],
        ["id"],
        # Not RESTRICT: a comp really is deleted in this app, and a parent must not become
        # undeletable because somebody forked it. The snapshotted name above is what keeps
        # the deletion from erasing the fork's provenance too.
        ondelete="SET NULL",
    )
    op.create_index(
        op.f("ix_comp_forked_from_comp_id"), "comp", ["forked_from_comp_id"], unique=False
    )

    # The Tags namespace: any number per comp, so rows.
    op.create_table(
        "comp_tag",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("comp_id", sa.Uuid(), nullable=False),
        sa.Column("tag", sa.String(length=64), nullable=False),
        # Cascading in the database and not only in the ORM, like every other table hanging
        # off a comp: a hand-run cleanup should not have to know this one is special.
        sa.ForeignKeyConstraint(
            ["comp_id"], ["comp.id"], name=op.f("fk_comp_tag_comp_id_comp"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_comp_tag")),
        # One of each tag per comp, and — leading with comp_id — the index every read uses
        # and the one the cascade walks, so no separate index on comp_id is needed.
        sa.UniqueConstraint("comp_id", "tag", name=op.f("uq_comp_tag_comp_id_tag")),
    )

    # Nullable with no server default and no onupdate: null means "never edited", and only
    # the edit route writes it. A default would claim every comment was edited at birth.
    op.add_column(
        "comp_comment", sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("comp_comment", "updated_at")
    op.drop_table("comp_tag")
    op.drop_index(op.f("ix_comp_forked_from_comp_id"), table_name="comp")
    op.drop_constraint(op.f("fk_comp_forked_from_comp_id_comp"), "comp", type_="foreignkey")
    op.drop_column("comp", "fork_kind")
    op.drop_column("comp", "forked_from_name")
    op.drop_column("comp", "forked_from_comp_id")
    op.drop_column("comp", "archetype")
