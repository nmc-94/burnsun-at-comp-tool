"""every team has a board the whole team is on

0012 built the shared board, and ``teams.create_team`` now gives every *new* team one. This gives
it to the teams that already exist, so the promise is not "every team made after Tuesday".

**Data only.** Nothing here creates, alters or drops anything, so ``alembic check`` — which
compares schema and not rows — has nothing to say about it. Written by hand for the same reason:
``--autogenerate`` would produce an empty upgrade.

**One statement, with its guard in the SQL.** ``NOT EXISTS`` rather than a Python loop over the
teams, which makes the revision re-runnable without a second board appearing and makes "a team that
already has a shared board keeps exactly the boards it has" a property of the query rather than of
a comparison somebody has to keep correct. A team that promoted a board in Phase J is such a team,
and is deliberately left alone: it already has the thing this is for.

**Archived teams are skipped.** Archiving freezes a season's record, and ``create_shared_board``
answers 409 to every write against one — so seeding there would insert a row no route in the
application could have produced, into precisely the object that is supposed to have stopped
changing. The cost is stated rather than hidden: a team restored after this runs has no default
board, and makes one the ordinary way.

**Every column is written out**, including the three the model gives defaults. A raw INSERT bypasses
a Python-side default entirely, and by 0012's own design ``shared_board.mode`` has no server default
to fall back on — leaving it out is a NOT NULL violation rather than a silent ``'grid'``. Beyond
that, a data migration whose meaning would shift if a default were changed later is not a record of
what happened, which is the only thing a migration is. The name is a literal here and a constant in
``comptool/shared_boards.py`` for that same reason: this file says what the database was made to
look like on this date, and importing the constant would let a later rename rewrite that history.

Revision ID: 0013
Revises: 0012
Create Date: 2026-07-30
"""

import sqlalchemy as sa
from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    # ``gen_random_uuid()`` is core from Postgres 13 and every environment here pins 16, so no
    # extension is needed. The owner is credited rather than nobody: the columns are nullable
    # and mean "who made this", and for these boards the honest answer is whoever made the team.
    seeded = bind.execute(
        sa.text(
            """
            INSERT INTO shared_board (
                id, team_id, name, mode, snap, revision,
                created_by_character_id, created_by_name, created_at, updated_at
            )
            SELECT
                gen_random_uuid(), t.id, 'Team board', 'grid', true, 0,
                t.owner_character_id, t.owner_character_name, now(), now()
            FROM team t
            WHERE t.archived_at IS NULL
              AND NOT EXISTS (SELECT 1 FROM shared_board b WHERE b.team_id = t.id)
            """
        )
    )
    print(f"0013: seeded {seeded.rowcount} default board(s)")


def downgrade() -> None:
    """Deliberately nothing, which is the honest answer rather than a missing one.

    No column records which board this revision made. Deleting by name would take a board somebody
    renamed *to* "Team board", and — as 0012's downgrade says — a shared board exists nowhere else,
    so an arrangement a team had built on it would go with it. What this leaves behind instead is at
    most one empty board per team, which costs nothing and destroys nothing.
    """
