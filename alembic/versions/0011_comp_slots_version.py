"""a counter on a comp's hulls, so a second writer can be told it lost

``PUT /api/v1/comps/{id}/slots`` replaces a comp's whole hull list, and until now it did so
unconditionally: whichever request arrived second won outright. That was survivable while a comp
had one editor at a time and it stopped being survivable in ``f11d852``, which made a teammate's
edit arrive on your screen and so made two people editing one comp an ordinary thing to do. The
loss is silent in both directions — the writer who lost never hears, and the writer who won sees
a tile that quietly adopts the server's answer and throws its undo history away with it.

This is the precondition half. The column is bumped by a slot write and by nothing else, so a
rename and a hull change still commute: they touch different things and neither should be able to
refuse the other. ``PUT .../slots`` compares it against ``If-Match`` and answers **412** when they
disagree.

**Deliberately not ``updated_at``**, which is already on the row and would have needed no
migration. Two reasons, and the second is the one that would have bitten later. A timestamp has
clock resolution, so two writes inside one tick are indistinguishable from one. And ``updated_at``
also moves on a rename and on a retag — see ``comps._apply_tags`` — so using it here would refuse
a hull change because somebody else had renamed the comp, which is a conflict that does not exist.

Zero rather than one for an existing comp, and it does not matter which: what a client sends back
is whatever the server last served it, so the only property the number needs is that it moves.

Revision ID: 0011
Revises: 0010
Create Date: 2026-07-30
"""

import sqlalchemy as sa
from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ``server_default`` kept rather than added and dropped, matching ``team.base_level``: an
    # integer literal reflects back from Postgres as an integer literal, so it costs the drift
    # check nothing — unlike a string default, which comes back as ``'grid'::character varying``
    # and reports permanent drift. The model carries the same default for the same reason.
    #
    # It also means a row inserted by anything that does not know about this column — a fixture,
    # a future migration's backfill — gets a valid version rather than a NULL the route would
    # then have to defend against.
    op.add_column(
        "comp",
        sa.Column("slots_version", sa.Integer(), server_default=sa.text("0"), nullable=False),
    )


def downgrade() -> None:
    """Drops the column, and with it every comp's version.

    Shape-only: no comp's hulls are touched. A client still holding a version from before the
    downgrade would send an ``If-Match`` nothing reads, and the route goes back to answering
    unconditionally — which is where it was.
    """
    op.drop_column("comp", "slots_version")
