"""identity without EVE: a claimed name, and a throttle in front of the password

Two tables and one sequence, and **nothing existing is altered** — which is the point worth
recording rather than the tables themselves. A deployment with no EVE application still needs
something for a team to be owned by, and the obvious shape for that was a new id column
everywhere and a discriminator beside it: six altered tables, and every authorization query
in the app learning to ask which kind of subject it was holding.

None of that is here, because a local principal is a **negative** id. Every identity column in
this schema is already a signed ``BigInteger`` carrying an EVE id, and EVE's id space is
entirely positive, so the unused half of ``team.owner_character_id``,
``team_grant.subject_id``, ``comp.created_by_character_id``, ``comp_comment.author_character_id``,
``workspace_layout.character_id`` and ``auth_session.character_id`` is exactly the right size
and shape already. The sign is the discriminator, and nothing has to consult it: ``esi.py``
refuses a non-positive id from ESI, and the SPA's portrait builder returns nothing for one.

Hence ``local_account_principal_seq``, which counts *down*. A sequence rather than negating a
serial, so the negativity belongs to where the number comes from rather than to every insert
site remembering. No column takes it as a server default: this database is drift-checked with
``compare_server_default=True``, and ``nextval(...)::regclass`` reflects back in a shape the
check cannot match — the same cost ``comp_share.slug`` records about expression indices, which
is also why ``name_folded`` is a stored column and not an index on ``lower(display_name)``.

Revision ID: 0009
Revises: 0008
Create Date: 2026-07-27
"""

import sqlalchemy as sa
from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None

#: Counts down from -1. ``MAXVALUE -1`` is what keeps it out of EVE's half of the column
#: forever, rather than by convention; ``NO MINVALUE`` takes bigint's floor, which at one id
#: per person is not a number anybody reaches.
_CREATE_SEQUENCE = """
CREATE SEQUENCE local_account_principal_seq
  AS bigint INCREMENT BY -1 MAXVALUE -1 START WITH -1 NO MINVALUE
"""


def upgrade() -> None:
    op.execute(sa.text(_CREATE_SEQUENCE))

    op.create_table(
        "local_account",
        sa.Column("id", sa.Uuid(), nullable=False),
        # Negative, from the sequence above, and filled by local_accounts.claim rather than by
        # a default — see the module docstring for why the drift check makes that the honest
        # choice rather than a missed convenience.
        sa.Column("principal_id", sa.BigInteger(), nullable=False),
        sa.Column("display_name", sa.String(length=200), nullable=False),
        sa.Column("name_folded", sa.String(length=200), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "last_seen_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_local_account")),
        sa.UniqueConstraint("principal_id", name=op.f("uq_local_account_principal_id")),
        # The claim lock. One row per name, which is what makes signing in with a name somebody
        # already holds sign you in *as* them rather than beside them — stated plainly in the
        # model, in the sign-in screen, and in the README, because it is the shape of the
        # trade a shared password makes and not a detail to be discovered.
        sa.UniqueConstraint("name_folded", name=op.f("uq_local_account_name_folded")),
    )

    op.create_table(
        "auth_password_attempt",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("scope", sa.String(length=64), nullable=False),
        sa.Column("failed_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_auth_password_attempt")),
    )
    op.create_index(
        "ix_auth_password_attempt_scope_failed",
        "auth_password_attempt",
        ["scope", "failed_at"],
        unique=False,
    )
    # Serves the purge, which filters on failed_at alone and cannot use the composite above.
    op.create_index(
        op.f("ix_auth_password_attempt_failed_at"),
        "auth_password_attempt",
        ["failed_at"],
        unique=False,
    )


def downgrade() -> None:
    """Drops both tables, and with them every local identity.

    Said plainly, because unlike most of this repo's downgrades it is not shape-only: a
    deployment running password sign-in keeps its people here and nowhere else, so this loses
    the mapping from a name to the principal that owns their teams. The teams survive — they
    hold the id, not a foreign key — but nothing can claim them again, because the next claim
    of the same name starts the sequence over and mints a different number.
    """
    op.drop_index(op.f("ix_auth_password_attempt_failed_at"), table_name="auth_password_attempt")
    op.drop_index("ix_auth_password_attempt_scope_failed", table_name="auth_password_attempt")
    op.drop_table("auth_password_attempt")
    op.drop_table("local_account")
    op.execute(sa.text("DROP SEQUENCE local_account_principal_seq"))
