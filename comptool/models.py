"""Database models (SQLAlchemy 2.0 typed ORM).

The model splits along the line the product does: **ruleset** data is ingested from the
tournament organizer and immutable once published, while **team content** is what users
create. A comp points at the ruleset *version* it was built against, so an old comp still
re-validates against the rules it was designed under even after point values move.

Legality itself is never stored. It is derived on the client from the ruleset payload, so
nothing here records whether a comp is legal — only what it contains.

The ``auth_*`` tables are a third concern again: who is asking. They hold no game data,
only what is needed to recognize a returning browser and to prove which character it is.

``app_meta`` predates the domain and stays: the health probe reads it to prove migrations
have been applied without coupling ops to a domain table.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import IntEnum, StrEnum

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

# Explicit constraint names keep migrations and the drift check deterministic; without
# them the database picks names and a later revision cannot reliably refer to one.
NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_N_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


class AccessLevel(IntEnum):
    """The permission ladder. Ordered, so ``>=`` is the authorization test."""

    NONE = 0
    VIEWER = 1
    EDITOR = 2
    OWNER = 3


class SubjectKind(StrEnum):
    """What kind of in-game entity an access grant names."""

    CHARACTER = "character"
    CORPORATION = "corporation"
    ALLIANCE = "alliance"


# Both enums are stored as their plain scalar (a small int / a short string) rather than a
# database enum type: the vocabulary lives in one place in Python, and adding to it never
# needs a type migration.


def _uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(primary_key=True, default=uuid.uuid4)


def _created_at() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now())


class AppMeta(Base):
    __tablename__ = "app_meta"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Ruleset(Base):
    """One tournament's rules, identified by a stable slug (e.g. ``atxxii``)."""

    __tablename__ = "ruleset"

    id: Mapped[uuid.UUID] = _uuid_pk()
    slug: Mapped[str] = mapped_column(String(64), unique=True)
    name: Mapped[str] = mapped_column(String(200))
    # The body that publishes the rules, which is not necessarily the game's publisher.
    organizer: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = _created_at()

    versions: Mapped[list[RulesetVersion]] = relationship(
        back_populates="ruleset",
        cascade="all, delete-orphan",
        order_by="RulesetVersion.fetched_at",
    )


class RulesetVersion(Base):
    """An immutable snapshot of a ruleset, as captured from its source on a given day.

    Point values change mid-tournament, so a version is never edited — a change is a new
    row. ``payload`` holds the fully resolved ruleset the client legality engine consumes;
    its shape is the engine's ``Ruleset`` type (camelCase keys, since the client is its
    only reader).
    """

    __tablename__ = "ruleset_version"
    __table_args__ = (UniqueConstraint("ruleset_id", "version_label"),)

    id: Mapped[uuid.UUID] = _uuid_pk()
    ruleset_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("ruleset.id", ondelete="CASCADE"), index=True
    )
    # The label the source itself uses, so the UI can name exactly what is loaded.
    version_label: Mapped[str] = mapped_column(String(64))
    source_url: Mapped[str] = mapped_column(Text)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    payload: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[datetime] = _created_at()

    ruleset: Mapped[Ruleset] = relationship(back_populates="versions")


class Team(Base):
    """A tournament team: one owner, plus whoever the owner grants access to."""

    __tablename__ = "team"

    id: Mapped[uuid.UUID] = _uuid_pk()
    name: Mapped[str] = mapped_column(String(200))
    # An EVE character id. Wide enough for the game's id space, which exceeds 32 bits.
    owner_character_id: Mapped[int] = mapped_column(BigInteger, index=True)
    # What someone with no matching grant gets. Teams are private by default.
    base_level: Mapped[int] = mapped_column(SmallInteger, server_default=text("0"))
    # Put away rather than deleted: a team's comps are other people's work and a season's
    # record. Null means live; the timestamp is when it was archived.
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    grants: Mapped[list[TeamGrant]] = relationship(
        back_populates="team", cascade="all, delete-orphan"
    )
    comps: Mapped[list[Comp]] = relationship(
        back_populates="team", cascade="all, delete-orphan"
    )


class TeamGrant(Base):
    """Access granted to an in-game character, corporation or alliance.

    Access is granted by *name*, because that is what a captain knows. The name is kept
    for display and re-resolution; matching happens on ``subject_id``, which stays null
    until the name has been resolved against the game's identity service.
    """

    __tablename__ = "team_grant"
    __table_args__ = (
        UniqueConstraint("team_id", "subject_kind", "subject_id"),
        # The lookup every login performs: which teams does this identity reach?
        Index("ix_team_grant_subject", "subject_kind", "subject_id"),
        # Postgres counts NULLs as distinct, so the constraint above lets the same
        # *unresolved* name be invited over and over. One pending invitation per name.
        # Plain columns rather than lower(subject_name): an expression index reflects
        # back from Postgres with casts the drift check cannot match, and would report
        # permanent drift. Case-insensitivity is enforced where it can explain itself.
        Index(
            "uq_team_grant_one_pending_name",
            "team_id",
            "subject_kind",
            "subject_name",
            unique=True,
            postgresql_where=text("subject_id IS NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    team_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("team.id", ondelete="CASCADE"), index=True
    )
    subject_kind: Mapped[str] = mapped_column(String(16))
    subject_id: Mapped[int | None] = mapped_column(BigInteger)
    subject_name: Mapped[str] = mapped_column(String(200))
    level: Mapped[int] = mapped_column(SmallInteger)
    created_at: Mapped[datetime] = _created_at()

    team: Mapped[Team] = relationship(back_populates="grants")


class Comp(Base):
    """A single match lineup, bound to the ruleset version it was built against."""

    __tablename__ = "comp"

    id: Mapped[uuid.UUID] = _uuid_pk()
    team_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("team.id", ondelete="CASCADE"), index=True
    )
    # Restricted rather than cascaded: a version a comp was built against is history and
    # must outlive attempts to tidy it away.
    ruleset_version_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("ruleset_version.id", ondelete="RESTRICT"), index=True
    )
    name: Mapped[str] = mapped_column(String(200))
    # Captured at creation and never reassigned, so authorship survives edits.
    created_by_character_id: Mapped[int | None] = mapped_column(BigInteger)
    created_by_name: Mapped[str | None] = mapped_column(String(200))
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    team: Mapped[Team] = relationship(back_populates="comps")
    ruleset_version: Mapped[RulesetVersion] = relationship()
    slots: Mapped[list[CompSlot]] = relationship(
        back_populates="comp",
        cascade="all, delete-orphan",
        order_by="CompSlot.position",
    )
    comments: Mapped[list[CompComment]] = relationship(
        back_populates="comp",
        cascade="all, delete-orphan",
        order_by="CompComment.created_at",
    )


class CompSlot(Base):
    """One hull choice in a comp. A slot is a hull, not a fitting."""

    __tablename__ = "comp_slot"
    __table_args__ = (
        UniqueConstraint("comp_id", "position"),
        # A comp has at most one flagship; the database is the honest place to say so.
        Index(
            "uq_comp_slot_one_flagship",
            "comp_id",
            unique=True,
            postgresql_where=text("is_flagship"),
        ),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    comp_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("comp.id", ondelete="CASCADE"), index=True
    )
    position: Mapped[int] = mapped_column(SmallInteger)
    # An EVE inventory type id. Which hulls are legal is the ruleset's business, not the
    # schema's, so nothing constrains this beyond its type.
    type_id: Mapped[int] = mapped_column(Integer)
    is_flagship: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))

    comp: Mapped[Comp] = relationship(back_populates="slots")


class CompComment(Base):
    """A note on a comp, from anyone on the team with access. One thread per comp."""

    __tablename__ = "comp_comment"
    __table_args__ = (Index("ix_comp_comment_comp_created", "comp_id", "created_at"),)

    id: Mapped[uuid.UUID] = _uuid_pk()
    comp_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("comp.id", ondelete="CASCADE"))
    author_character_id: Mapped[int | None] = mapped_column(BigInteger)
    author_name: Mapped[str | None] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = _created_at()

    comp: Mapped[Comp] = relationship(back_populates="comments")


class AuthSession(Base):
    """A signed-in browser.

    The cookie carries a random token; only its hash is stored here. Expiry slides: each
    use pushes ``expires_at`` out again, so an active person is never signed out while an
    abandoned session ages away on its own.
    """

    __tablename__ = "auth_session"

    id: Mapped[uuid.UUID] = _uuid_pk()
    # SHA-256 of the cookie value. The token itself is never written down, so a leaked
    # backup cannot be replayed as a login. No salt: the token is 256 random bits, which
    # is not guessable and leaves nothing for a precomputed table to hit.
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    character_id: Mapped[int] = mapped_column(BigInteger, index=True)
    # Display only — authorization always matches on the id.
    character_name: Mapped[str] = mapped_column(String(200))
    # The SSO's owner claim, which changes when a character moves to another account.
    # Sessions opened before that belong to a different person.
    character_owner_hash: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = _created_at()
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    # Stored rather than derived from last_seen_at: a live session's expiry must not move
    # retroactively when an operator edits the TTL, and "still valid" has to be indexable.
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)

    esi_token: Mapped[AuthEsiToken | None] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )


class AuthEsiToken(Base):
    """The SSO refresh token a session holds, encrypted with the configured secret.

    One row per session rather than per character: the SSO rotates a refresh token as it
    is used, so two browsers sharing one row would invalidate each other. Kept out of
    ``auth_session`` because that row is read on every request and this ciphertext on
    almost none — and because the cascade below is what makes signing out destroy it.
    """

    __tablename__ = "auth_esi_token"

    id: Mapped[uuid.UUID] = _uuid_pk()
    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("auth_session.id", ondelete="CASCADE"), unique=True
    )
    refresh_token_encrypted: Mapped[str] = mapped_column(Text)
    # The last time the token was exchanged successfully, which is the only durable thing
    # a refresh tells us. The access token itself is not stored: it outlives its usefulness
    # in about twenty minutes and nothing here calls a scoped endpoint.
    checked_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    session: Mapped[AuthSession] = relationship(back_populates="esi_token")


class AuthLoginAttempt(Base):
    """A login in flight.

    Holds the PKCE verifier — which only this server may present — from the redirect out
    to the SSO until the callback comes back. Single-use and short-lived: the row is
    deleted when the callback claims it, which is what makes a replayed callback fail.
    """

    __tablename__ = "auth_login_attempt"

    id: Mapped[uuid.UUID] = _uuid_pk()
    state: Mapped[str] = mapped_column(String(64), unique=True)
    # Not encrypted: it is worthless without the matching one-time authorization code,
    # and it must be presented to the SSO verbatim, so it could not be hashed either.
    code_verifier: Mapped[str] = mapped_column(String(128))
    # Where to send the browser afterwards. A relative path, validated on the way in —
    # an absolute URL from the query string would make signing in an open redirect.
    next_path: Mapped[str] = mapped_column(String(500), default="/")
    created_at: Mapped[datetime] = _created_at()
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
