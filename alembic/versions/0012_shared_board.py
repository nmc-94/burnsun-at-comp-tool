"""a board the whole team works on, rather than one each

Every board in this application so far has been a JSONB object inside ``workspace_layout``, one
row per character per team, and ``save_workspace``'s docstring justifies last-write-wins with "a
layout has exactly one writer — you". These two tables are the other thing: one arrangement the
whole team opens at one URL, whose order the server decides.

**Rows rather than a document**, unlike the personal twin, and the argument that settles it is the
foreign key on the tile: ``comp_id`` cascades, so a comp id cannot outlive its comp. That is the
invariant ``comptool/workspace.py`` spends two functions enforcing by hand, and here the schema
holds it. Secondarily, independent ops touch independent rows — two people moving two different
tiles are not two writers racing to rewrite one blob, which is the commonest gesture the feature
has, and which a document would make fixable only under a row lock every op on a busy board had to
queue behind.

``revision`` is an integer rather than a reused ``updated_at`` because the client compares it to
decide whether an arriving document is newer than the one on screen, and two ops inside one clock
tick have to be distinguishable. Same reasoning as ``comp.slots_version`` in ``0011``.

``position`` is sparse and **not unique**: uniqueness is exactly what would force a move to
renumber its neighbours. It is never served — the response is an ordered list — so a gap is
invisible outside ``comptool/shared_boards.py``.

``place_x``/``place_y`` are reserved and unset. A shared board draws as a grid in this slice and no
op writes either, but leaving room for them means promoting one to floating later costs no
migration. The CHECK is written out here *and* in the model, because ``alembic check`` does not
compare CHECK constraints and the test suite raises its schema from ``Base.metadata`` — declared in
only one place, it would hold in every test and be absent in production with nothing reporting it.

Revision ID: 0012
Revises: 0011
Create Date: 2026-07-30
"""

import sqlalchemy as sa
from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "shared_board",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("team_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        # No server default, unlike ``snap`` below. The drift gate compares server defaults as
        # text and a string one reflects back from Postgres as ``'grid'::character varying``,
        # which never matches what the model says — permanent drift for a convenience. The
        # model carries a Python-side default instead.
        sa.Column("mode", sa.String(length=16), nullable=False),
        sa.Column("snap", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("revision", sa.Integer(), server_default=sa.text("0"), nullable=False),
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
        # Cascading in the database and not only in the ORM, like every other table hanging off
        # a team: a hand-run cleanup should not have to know this one is special.
        sa.ForeignKeyConstraint(
            ["team_id"],
            ["team.id"],
            name=op.f("fk_shared_board_team_id_team"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_shared_board")),
    )
    op.create_index(op.f("ix_shared_board_team_id"), "shared_board", ["team_id"])

    op.create_table(
        "shared_board_tile",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("board_id", sa.Uuid(), nullable=False),
        sa.Column("comp_id", sa.Uuid(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("place_x", sa.Integer(), nullable=True),
        sa.Column("place_y", sa.Integer(), nullable=True),
        sa.Column("added_by_character_id", sa.BigInteger(), nullable=True),
        sa.Column("added_by_name", sa.String(length=200), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        # Half a position is not a position. Mirrored in the model; see the module docstring.
        sa.CheckConstraint(
            "(place_x IS NULL) = (place_y IS NULL)",
            name=op.f("ck_shared_board_tile_place_is_whole"),
        ),
        sa.ForeignKeyConstraint(
            ["board_id"],
            ["shared_board.id"],
            name=op.f("fk_shared_board_tile_board_id_shared_board"),
            ondelete="CASCADE",
        ),
        # The key that makes this a table rather than a document: a tile cannot outlive its
        # comp, so nothing downstream has to remember to filter one out.
        sa.ForeignKeyConstraint(
            ["comp_id"],
            ["comp.id"],
            name=op.f("fk_shared_board_tile_comp_id_comp"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_shared_board_tile")),
        # One tile per comp per board, so two people adding the same comp at the same moment is
        # settled by the index rather than by a scan under a lock. Leads with ``board_id``, which
        # is the lookup every read makes and the one the board's cascade walks — hence no
        # separate index on that column.
        sa.UniqueConstraint(
            "board_id", "comp_id", name=op.f("uq_shared_board_tile_board_id_comp_id")
        ),
    )
    # Its own index, unlike ``board_id``: this is what the comp's cascade walks, and it leads no
    # other index.
    op.create_index(op.f("ix_shared_board_tile_comp_id"), "shared_board_tile", ["comp_id"])


def downgrade() -> None:
    """Drops both tables, and with them every shared arrangement.

    Destructive in a way ``0011``'s was not: a personal board survives because it lives in
    ``workspace_layout``, which this revision never touched, but a shared board exists nowhere
    else. No comp is harmed — a tile is a pointer — so what is lost is the arrangement, not the
    work.
    """
    op.drop_index(op.f("ix_shared_board_tile_comp_id"), table_name="shared_board_tile")
    op.drop_table("shared_board_tile")
    op.drop_index(op.f("ix_shared_board_team_id"), table_name="shared_board")
    op.drop_table("shared_board")
