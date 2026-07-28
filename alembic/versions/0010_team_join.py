"""a team carries its own way in

0009 put one password in the environment. This moves the credential to where the person who
should control it can reach it: a team has a join link and a password, its owner sets both, and
changing either is a form in the app rather than a redeploy.

**Not additive, unlike 0009.** ``join_slug`` is NOT NULL and unique, so every team that already
exists needs one before the constraint can go on — hence the three steps below, in that order,
which is the same shape 0008 used and for the same reason: each is the precondition of the next.

The slugs are minted here rather than lazily on first use. A nullable column filled later would
mean a team whose settings screen has no link to show until somebody presses something, and a
uniqueness rule that only sometimes applies — the two states 0008 spent a migration removing
from ``team_grant``. Every team gets one now, whether or not anybody ever sends it.

Revision ID: 0010
Revises: 0009
Create Date: 2026-07-27
"""

import sqlalchemy as sa
from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Add it nullable, because existing rows have nothing to put in it yet.
    op.add_column("team", sa.Column("join_slug", sa.String(length=64), nullable=True))
    op.add_column("team", sa.Column("access_password_hash", sa.Text(), nullable=True))
    op.add_column(
        "team",
        sa.Column(
            "access_password_level",
            sa.SmallInteger(),
            server_default=sa.text("1"),
            nullable=False,
        ),
    )

    # 2. Backfill. Imported here rather than at module scope: a migration that reaches into the
    # application package at import time breaks the moment that package moves, and this one
    # only needs the generator.
    from comptool import share_slug

    bind = op.get_bind()
    teams = bind.execute(sa.text("SELECT id FROM team")).scalars().all()
    taken: set[str] = set()
    for team_id in teams:
        # Re-rolled against what this loop has already handed out. The space is over 2^32 and
        # the table is small, so a collision is a curiosity — but a unique index that fails
        # halfway through a migration is not, and the check costs nothing.
        slug = share_slug.generate()
        while slug in taken:
            slug = share_slug.generate()
        taken.add(slug)
        bind.execute(
            sa.text("UPDATE team SET join_slug = :slug WHERE id = :id"),
            {"slug": slug, "id": team_id},
        )
    print(f"0010: minted {len(teams)} join link(s)")

    # 3. Only now can the column promise what the model says it does.
    op.alter_column("team", "join_slug", existing_type=sa.String(length=64), nullable=False)
    op.create_unique_constraint(op.f("uq_team_join_slug"), "team", ["join_slug"])


def downgrade() -> None:
    """Drops the three columns, and with them every join link and team password.

    Said plainly: this is not shape-only. A team's members survive — a join writes an ordinary
    ``team_grant`` row and those are untouched — but the links go, and re-upgrading mints new
    slugs, so any link already sent to somebody points at nothing afterwards.
    """
    op.drop_constraint(op.f("uq_team_join_slug"), "team", type_="unique")
    op.drop_column("team", "access_password_level")
    op.drop_column("team", "access_password_hash")
    op.drop_column("team", "join_slug")
