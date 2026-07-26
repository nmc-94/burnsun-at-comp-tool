"""a grant always names a character the game knows

Until now ``team_grant.subject_id`` was nullable, and a null meant a "pending invitation":
a row created because the name typed into the access list did not resolve against ESI. The
row displayed, and granted nothing, and could never begin to grant anything — resolution
was only ever retried by hand. It read to its owner as "they are on the way".

They were not on the way. ``teams.add_grant`` now refuses a name it cannot resolve, so the
state has no way to be created; this makes it impossible to *hold*, which is the half that
survives somebody later adding a branch that forgets. Three steps, in this order, because
each is the precondition of the next.

The delete is not a data loss anyone can feel. A null-id grant conferred no access —
``permissions._matches`` returns False on one — so removing it takes nothing away from
anybody, and the name it carried is in the operator's head, not only here. The count is
reported first so a run against real data leaves a record of what went, and so a surprising
number is visible in the log rather than inferred afterwards from a row count.

The dropped index existed solely to allow one pending invitation per name. With no nulls
left it can never match a row again, and leaving it would be a rule about a state that no
longer exists.

Revision ID: 0008
Revises: 0007
Create Date: 2026-07-26
"""

import sqlalchemy as sa
from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    # Counted and logged before the delete, not after: afterwards there is nothing left to
    # count, and "how many did that remove?" is the first question anyone asks of a
    # destructive migration.
    doomed = bind.scalar(sa.text("SELECT count(*) FROM team_grant WHERE subject_id IS NULL"))
    print(f"0008: removing {doomed} unresolved grant(s), which granted no access")
    bind.execute(sa.text("DELETE FROM team_grant WHERE subject_id IS NULL"))

    op.drop_index("uq_team_grant_one_pending_name", table_name="team_grant")
    op.alter_column("team_grant", "subject_id", existing_type=sa.BigInteger(), nullable=False)


def downgrade() -> None:
    """Restores the shape, and cannot restore the rows.

    Said plainly rather than left for someone to discover: the deleted invitations are
    gone, and a downgrade gives back only the ability to create new ones. Since they
    granted no access, what is unrecoverable is a list of names somebody once typed.
    """
    op.alter_column("team_grant", "subject_id", existing_type=sa.BigInteger(), nullable=True)
    op.create_index(
        "uq_team_grant_one_pending_name",
        "team_grant",
        ["team_id", "subject_kind", "subject_name"],
        unique=True,
        postgresql_where=sa.text("subject_id IS NULL"),
    )
