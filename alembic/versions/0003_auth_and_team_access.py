"""auth and team access: sessions, login attempts, esi tokens, team archive

Revision ID: 0003
Revises: 0002
Create Date: 2026-07-24
"""

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "auth_session",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("character_id", sa.BigInteger(), nullable=False),
        sa.Column("character_name", sa.String(length=200), nullable=False),
        sa.Column("character_owner_hash", sa.String(length=64), nullable=True),
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
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_auth_session")),
        sa.UniqueConstraint("token_hash", name=op.f("uq_auth_session_token_hash")),
    )
    # Signing out everywhere deletes by character; the expiry sweep deletes by date.
    op.create_index(
        op.f("ix_auth_session_character_id"), "auth_session", ["character_id"], unique=False
    )
    op.create_index(
        op.f("ix_auth_session_expires_at"), "auth_session", ["expires_at"], unique=False
    )

    op.create_table(
        "auth_esi_token",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.Column("refresh_token_encrypted", sa.Text(), nullable=False),
        sa.Column(
            "checked_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
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
        # Cascading in the database, not only in the ORM: ending a session must take its
        # refresh token with it even when the session is deleted in bulk.
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["auth_session.id"],
            name=op.f("fk_auth_esi_token_session_id_auth_session"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_auth_esi_token")),
        sa.UniqueConstraint("session_id", name=op.f("uq_auth_esi_token_session_id")),
    )

    op.create_table(
        "auth_login_attempt",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("state", sa.String(length=64), nullable=False),
        sa.Column("code_verifier", sa.String(length=128), nullable=False),
        sa.Column("next_path", sa.String(length=500), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_auth_login_attempt")),
        sa.UniqueConstraint("state", name=op.f("uq_auth_login_attempt_state")),
    )
    op.create_index(
        op.f("ix_auth_login_attempt_expires_at"),
        "auth_login_attempt",
        ["expires_at"],
        unique=False,
    )

    op.add_column("team", sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True))

    # Partial unique index: a team may hold at most one unresolved invitation per name.
    # The full unique constraint cannot say this, because Postgres counts NULL subject
    # ids as distinct from each other.
    op.create_index(
        "uq_team_grant_one_pending_name",
        "team_grant",
        ["team_id", "subject_kind", "subject_name"],
        unique=True,
        postgresql_where=sa.text("subject_id IS NULL"),
    )


def downgrade() -> None:
    op.drop_index(
        "uq_team_grant_one_pending_name",
        table_name="team_grant",
        postgresql_where=sa.text("subject_id IS NULL"),
    )
    op.drop_column("team", "archived_at")
    op.drop_index(op.f("ix_auth_login_attempt_expires_at"), table_name="auth_login_attempt")
    op.drop_table("auth_login_attempt")
    op.drop_table("auth_esi_token")
    op.drop_index(op.f("ix_auth_session_expires_at"), table_name="auth_session")
    op.drop_index(op.f("ix_auth_session_character_id"), table_name="auth_session")
    op.drop_table("auth_session")
