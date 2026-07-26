"""the team owner's name, beside their id

Ownership is a column on ``team`` rather than a grant row (``teams.create_team`` writes no
self-grant, so nothing can revoke it), which means an owner has never had a *name* anywhere —
only ``owner_character_id``. A UI that lists who can reach a team could therefore show every
grantee and not the one person who certainly has access.

The column is backfilled from ``auth_session``, which is a better source than it first looks.
It is not a cache of something ESI knows: ``character_name`` there was written from a verified
token at sign-in, and it is the *same* column ``auth.routes.refresh_character_names`` already
copies from on every later sign-in. So the backfill and the ongoing reconciliation agree by
construction rather than by coincidence. Doing it here matters because the alternative — wait
for the owner to sign in again — leaves every existing team showing a placeholder to the very
person who made it, for as long as their current session keeps them from having to.

Still nullable, because the backfill can miss: a team whose owner has no session row at all
(purged, or signed out everywhere) has no name to find, and inventing one is worse than
saying so. The application renders "The team owner" until that character next signs in.

Revision ID: 0007
Revises: 0006
Create Date: 2026-07-26
"""

import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 200 to match ``Team.name`` and ``TeamGrant.subject_name`` — and ``AuthSession
    # .character_name``, which is where the value arrives from.
    op.add_column("team", sa.Column("owner_character_name", sa.String(length=200), nullable=True))
    # Newest session wins: a character who has signed in since a rename has two rows, and the
    # later one is the name they answer to now. Correlated rather than joined so a character
    # with several live sessions updates each team once, not once per browser.
    op.execute(
        """
        UPDATE team
        SET owner_character_name = (
            SELECT s.character_name
            FROM auth_session s
            WHERE s.character_id = team.owner_character_id
            ORDER BY s.created_at DESC
            LIMIT 1
        )
        WHERE owner_character_name IS NULL
        """
    )


def downgrade() -> None:
    op.drop_column("team", "owner_character_name")
