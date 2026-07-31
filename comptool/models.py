"""Database models (SQLAlchemy 2.0 typed ORM).

The model splits along the line the product does: **ruleset** data is ingested from the
tournament organizer and immutable once published, while **team content** is what users
create. A comp points at the ruleset *version* it was built against, so an old comp still
re-validates against the rules it was designed under even after point values move.

Legality itself is never stored. It is derived on the client from the ruleset payload, so
nothing here records whether a comp is legal — only what it contains.

The ``auth_*`` tables are a third concern again: who is asking. They hold no game data,
only what is needed to recognize a returning browser and to prove which character it is.

``local_account`` is that third concern's other half, and is deliberately *not* ``auth_*``.
Those tables are credentials and machinery — a token hash, a PKCE verifier, a rejected
attempt — and every one of them is transient. This is durable identity: nothing in it is a
secret, it outlives every session opened against it, and it is what a team is owned by on a
deployment with no EVE application. It exists only in that mode; see ``comptool/settings.py``
for why the two modes cannot both be on.

``workspace_layout`` is a fourth: not what a team owns and not who is asking, but how one
person has arranged the first in front of the second. It holds no game data either, and
the comp ids inside it are never trusted — see ``comptool/workspace.py``.

``comp_share`` is a fifth, and the only one that leaves the building. Every other table here
is reachable exclusively through ``access.authorize``; a share is a frozen copy of one comp
under an unguessable name, readable with no session at all — see ``comptool/share.py``.

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
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    Sequence,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from . import share_slug

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
    # The owner's name, kept beside the id the way ``Comp.created_by_name`` and
    # ``CompComment.author_name`` are. Ownership is a column rather than a grant row, so
    # without this there is nothing to *show* an owner as — only an integer.
    #
    # Nullable, though in practice rarely null: 0007 backfills it from ``auth_session``, and
    # ``auth.routes.refresh_character_names`` keeps it current on every later sign-in. What
    # is left over is a team whose owner has no session row at all, and there is no honest
    # name to invent for one — so the column says nothing rather than guessing.
    owner_character_name: Mapped[str | None] = mapped_column(String(200))
    # What someone with no matching grant gets. Teams are private by default.
    base_level: Mapped[int] = mapped_column(SmallInteger, server_default=text("0"))
    # --- Joining, under local accounts. Inert under EVE SSO, where access is granted by name.
    #
    # The name a join link is addressed by: a petname slug from ``share_slug.generate()``, the
    # same generator and the same arithmetic as a shared comp's. Unlike that one it is **not**
    # the credential — the password below is — so its unguessability is not load-bearing and is
    # kept anyway, because a guessable one would turn this column into a directory of which
    # teams exist, which is exactly what ``access.py`` refuses to disclose.
    #
    # Re-rollable: it is the only way to kill a link that reached the wrong chat, since a
    # password change stops new joins but leaves an old link pointing at the same team.
    #
    # The default and ``join.mint_join_slug`` are both here on purpose, and they do different
    # jobs. This makes a ``Team`` impossible to construct without one — no route, no fixture and
    # no future migration can produce a row that violates the constraint. The minter adds a
    # uniqueness *check* on the paths that create and re-roll, so the common case never gambles
    # on a four-billion-to-one collision surfacing as an IntegrityError from team creation.
    # Python-side, not a server default: this database is drift-checked with
    # ``compare_server_default=True``, and a function default never reaches the schema at all.
    join_slug: Mapped[str] = mapped_column(String(64), unique=True, default=share_slug.generate)
    # What somebody must type to join. **Hashed**, unlike every secret this app reads from the
    # environment, and the reason is the difference between the two places a secret can live:
    # this one is in a row, so a leaked backup would otherwise hand over every team's password
    # at once. See ``auth/crypto.py:hash_password``.
    #
    # Null closes the team: no password, no way in by link, and the owner is on their own until
    # they set one. That is a state an owner chooses, not a half-configured row.
    access_password_hash: Mapped[str | None] = mapped_column(Text)
    # What the password grants — ``AccessLevel.VIEWER`` or ``EDITOR``, the owner's choice, and
    # changeable without changing the password. A column rather than two passwords because an
    # owner who has to remember which of two secrets they sent to whom is an owner who will get
    # it wrong.
    access_password_level: Mapped[int] = mapped_column(SmallInteger, server_default=text("1"))
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

    Access is *asked for* by name, because that is what a captain knows, but it is granted
    by id: ``teams.add_grant`` resolves the name first and refuses anything that does not
    come back as exactly one character. So ``subject_id`` is not nullable, and the name
    beside it is the game's own spelling, kept for display and refreshed at sign-in.

    It was nullable until 0008, which is what made a "pending invitation" possible — a row
    granting nobody anything, indistinguishable to its reader from access. NOT NULL is the
    part of removing that state which cannot be undone by a later branch forgetting.
    """

    __tablename__ = "team_grant"
    __table_args__ = (
        UniqueConstraint("team_id", "subject_kind", "subject_id"),
        # The lookup every login performs: which teams does this identity reach?
        Index("ix_team_grant_subject", "subject_kind", "subject_id"),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    team_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("team.id", ondelete="CASCADE"), index=True
    )
    subject_kind: Mapped[str] = mapped_column(String(16))
    subject_id: Mapped[int] = mapped_column(BigInteger)
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
    # The comp's overall shape, from the team's Archetype namespace. A column rather than a
    # row because a comp has at most one, and because a column and a table cannot be
    # confused for one another — which is how "Archetype and Tags never cross-suggest"
    # (REQUIREMENTS §3.3) becomes a property of the schema instead of a rule in a query.
    archetype: Mapped[str | None] = mapped_column(String(64))
    # Where this comp came from, if it was forked. SET NULL rather than RESTRICT: a comp
    # really is deleted here, and a parent must not become undeletable because somebody
    # forked it.
    forked_from_comp_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("comp.id", ondelete="SET NULL"), index=True
    )
    # The parent's name as it read when the fork was taken, so provenance survives the
    # parent's deletion — the same reason ``created_by_name`` and ``team_grant.subject_name``
    # are kept beside their ids. The link is live only while the id is.
    forked_from_name: Mapped[str | None] = mapped_column(String(200))
    # ``full`` or ``partial``: whether the fork took the whole comp or a chosen subset of
    # its rows. Null when this comp is not a fork at all. A plain scalar with the vocabulary
    # in Python, like ``SubjectKind``.
    fork_kind: Mapped[str | None] = mapped_column(String(16))
    # Bumped by a slot write and by nothing else, so a caller can say which version of the hull
    # list its edit was based on and be refused when that is no longer the current one. A rename
    # and a hull change commute, so neither may invalidate the other — which is why this is not
    # ``updated_at``, and why ``_apply_tags`` leaves it alone. See ``comps._apply_slots``.
    slots_version: Mapped[int] = mapped_column(Integer, server_default=text("0"))
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
    tags: Mapped[list[CompTag]] = relationship(
        back_populates="comp",
        cascade="all, delete-orphan",
        order_by="CompTag.tag",
    )
    comments: Mapped[list[CompComment]] = relationship(
        back_populates="comp",
        cascade="all, delete-orphan",
        order_by="CompComment.created_at",
    )

    # No relationship for ``forked_from_comp_id``. The parent's name is snapshotted above,
    # nothing walks upward from a fork, and leaving it a bare column keeps this class free
    # of a self-referential mapping nothing would read.


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


class CompTag(Base):
    """One label from the team's general *Tags* namespace, applied to one comp.

    A table rather than a column because a comp carries any number of these, and the
    counterpart to ``Comp.archetype`` being a column. The two namespaces never mix, and this
    is what makes that structural rather than a convention: there is no row here that could
    be mistaken for an archetype, and no column there that could hold a second tag.

    Values are normalized before they arrive — trimmed, internal whitespace collapsed, and
    spelled the way the team already spells them. That happens once, in ``comptool/comps.py``,
    because a second normalizer is a second answer to "is this the same tag?".
    """

    __tablename__ = "comp_tag"
    __table_args__ = (
        # One of each tag per comp. Leading with comp_id, so it also serves the lookup every
        # read makes and the cascade below — which is why there is no separate index on
        # comp_id, the same reasoning ``workspace_layout`` records.
        UniqueConstraint("comp_id", "tag"),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    comp_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("comp.id", ondelete="CASCADE"))
    tag: Mapped[str] = mapped_column(String(64))

    comp: Mapped[Comp] = relationship(back_populates="tags")


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
    # When the body was last rewritten; null means never. An edited comment that still
    # claimed its original timestamp would be a comment lying about itself, and a thread
    # where that is invisible is worse than one that forbids editing.
    #
    # Deliberately without a server default — one would claim every comment was edited the
    # moment it was posted — and without ``onupdate``, so that a later column's write cannot
    # come to read as a body edit. The edit route sets it, and nothing else does.
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    comp: Mapped[Comp] = relationship(back_populates="comments")


class CompShare(Base):
    """A name a comp can be read by, without a session.

    Its own table rather than a nullable column on ``comp``, because a share has its own life:
    it is minted, it is withdrawn, and **the withdrawn ones have to stay**. A revoked row is
    not history for its own sake — it is what makes ``slug``'s uniqueness a promise rather
    than a coincidence. Delete it and the generator could one day mint a withdrawn slug again,
    landing somebody's old link on a comp nobody meant to show them.

    ``document`` is a *snapshot*, not a pointer: what the link shows is what the comp was when
    the link was minted or last updated. It passes the same three tests ``workspace_layout``
    records — nothing queries across it, it is read whole and written whole, and it leaves room
    for fields nobody has built — and a fourth of its own: a frozen artefact must not drift
    with ``comp_slot``'s schema, so a copy in its own shape is more honest than rows that a
    later migration would quietly reshape.

    The slug is stored **in the clear**, unlike ``auth_session.token_hash``, and the reason
    does not generalize: a session token is never shown back to anybody, while this one is
    displayed every time its owner opens the panel.

    There is deliberately no ``Comp.shares`` relationship. ``access.reach_comp`` eager-loads
    for every module that reaches a comp, and a fourth ``selectinload`` there would put a query
    on every comment route to serve a field comments do not have.
    """

    __tablename__ = "comp_share"
    __table_args__ = (
        # At most one live share per comp — the third use of this pattern, after
        # ``uq_team_grant_one_pending_name`` and ``uq_comp_slot_one_flagship``. The control is
        # a switch, and a comp holding three live links has no state a switch could show.
        Index(
            "uq_comp_share_one_live",
            "comp_id",
            unique=True,
            postgresql_where=text("revoked_at IS NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    # Indexed separately, unlike ``comp_tag``: the unique index above covers only *live* rows,
    # so it cannot serve the cascade that has to find a deleted comp's revoked shares too.
    comp_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("comp.id", ondelete="CASCADE"), index=True
    )
    # Plain unique, not an index on ``lower(slug)``: the generator only emits lowercase, so
    # folding would be a second opinion — and an expression index reflects back from Postgres
    # with casts the drift check cannot match, which ``team_grant`` records the cost of.
    slug: Mapped[str] = mapped_column(String(64), unique=True)
    document: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[datetime] = _created_at()
    #: When the snapshot was last taken. Moves when a share is updated; ``created_at`` does not,
    #: so the pair says both how old the link is and how old what it shows is.
    captured_at: Mapped[datetime] = _created_at()
    #: Null means live. Withdrawn rather than deleted — see the class docstring.
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class WorkspaceLayout(Base):
    """How one character has arranged one team's comps: boards, tiles, and their order.

    Scoped to a team and a character together. A board is a view onto *a team's* comps —
    the rail it is opened from is headed with the team's comps — and every grant in this
    schema is team-scoped, so a layout that spanned teams would have to be authorized a
    team at a time. Scoping it here means one gate, the same one every other team-owned
    route goes through. There is no user table, so the character is a bare id, the way
    ``team.owner_character_id`` and ``comp.created_by_character_id`` are.

    The arrangement is a document rather than tables of boards and tiles. Nothing queries
    across it: it is read whole when a workspace opens and written whole when a board is
    switched, so normalizing would buy a join nobody makes and cost a dozen deleted and
    re-inserted rows every time a tile is closed. It also leaves room for the parts that
    are not built — a tile's position and size, once the board stops being a fixed grid —
    without a migration, the way ``ruleset_version.payload`` leaves room for the engine.

    What the server *does* read is the comp ids, and it never trusts them. A stored id is
    something somebody wrote down earlier; the comp may have been deleted since. Both
    routes intersect the document with the team's own comps, so a layout can never hand
    back an id its holder could not have listed for themselves. See ``comptool/workspace.py``.
    """

    __tablename__ = "workspace_layout"
    __table_args__ = (
        # One arrangement per character per team. Also the index both routes look up by,
        # and — leading with team_id — the one the cascade walks, which is why there is no
        # separate index on team_id: a second index on a row written this often would be
        # paid for on every save and read by nothing.
        UniqueConstraint("team_id", "character_id"),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    team_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("team.id", ondelete="CASCADE"))
    # An EVE character id, with no foreign key, because identity lives in the session and
    # there is nothing here to point at.
    character_id: Mapped[int] = mapped_column(BigInteger)
    # ``{"boards": [...], "activeBoardId": ...}``, camelCase, stored as it is served —
    # minus the comp ids, which the routes filter on the way in and on the way out.
    document: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    team: Mapped[Team] = relationship()


class SharedBoard(Base):
    """A board that belongs to the team rather than to one character.

    Every other board in this application is a JSONB object inside ``workspace_layout``,
    one row per character per team, whose docstring says in as many words that a layout has
    exactly one writer — you. This is the other thing: one arrangement that everybody with
    team access opens at the same URL, whose order the server decides.

    **Rows rather than a document**, unlike its personal twin, and the decisive argument is
    the foreign key on the tile below: a comp id cannot outlive its comp. That is the
    invariant ``comptool/workspace.py`` spends two functions enforcing by hand, and here it
    is a property of the schema instead of a rule somebody has to remember. Secondarily,
    independent ops touch independent rows — two people moving two different tiles are not
    two writers racing to rewrite one blob, which is the commonest gesture this feature has.
    """

    __tablename__ = "shared_board"

    id: Mapped[uuid.UUID] = _uuid_pk()
    team_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("team.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(120))
    # ``grid`` or ``float`` — a plain scalar with the vocabulary in Python, like ``fork_kind``.
    # A Python-side default and deliberately *no* server default: the drift gate runs with
    # ``compare_server_default=True``, and a string one reflects back from Postgres as
    # ``'grid'::character varying``, which never matches what the model says. ``snap`` below
    # keeps a server default because a boolean reflects cleanly — ``comp_slot.is_flagship``
    # is the standing proof of that.
    mode: Mapped[str] = mapped_column(String(16), default="grid")
    snap: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))
    # Bumped by every op that changes something, and the only thing the client compares.
    #
    # An integer rather than leaning on ``updated_at``, because both readers need an
    # ordering a timestamp cannot give: an arriving document replaces what is on screen
    # only when it is *newer*, and two ops inside one clock tick are indistinguishable by
    # time. Same argument as ``comp.slots_version``, and it is also what keeps a wire
    # timestamp out of board events entirely.
    revision: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    # Captured once, like ``comp.created_by_character_id``, and never reassigned.
    created_by_character_id: Mapped[int | None] = mapped_column(BigInteger)
    created_by_name: Mapped[str | None] = mapped_column(String(200))
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    team: Mapped[Team] = relationship()
    tiles: Mapped[list[SharedBoardTile]] = relationship(
        back_populates="board",
        cascade="all, delete-orphan",
        # Ties broken all the way down, so the order served is never the database's whim:
        # ``position`` is sparse and not unique, and two tiles created in one transaction
        # can share a timestamp.
        order_by=(
            "SharedBoardTile.position, SharedBoardTile.created_at, SharedBoardTile.comp_id"
        ),
    )


class SharedBoardTile(Base):
    """One comp on a shared board.

    ``comp_id`` cascades, and that is the whole reason this is a table: a tile cannot
    outlive its comp, so neither a route nor a client has to remember to filter one out.

    It is also this table's trap. The key is satisfied by *any* comp — including one in
    another team — and raises ``IntegrityError`` for a uuid that was never a comp at all.
    Those two cases must be indistinguishable to a caller and both silently dropped, or a
    write becomes the existence probe ``access.py`` exists to deny. So the key protects
    reads and **must never answer a write**: ``comptool/shared_boards.py`` resolves a comp
    against the team in Python first, and writes its read as a join so the intersection
    cannot be left out of one query.
    """

    __tablename__ = "shared_board_tile"
    __table_args__ = (
        # One tile per comp per board, so "two people add the same comp at the same moment"
        # is settled by the index rather than by a scan under a lock — the same
        # arbiter-rather-than-pre-check choice ``share._mint`` and ``save_workspace``'s
        # upsert both already make. It also leads with ``board_id``, which is the lookup
        # every read makes and the one the board's cascade walks, so there is no separate
        # index on that column.
        UniqueConstraint("board_id", "comp_id"),
        # Half a position is not a position.
        #
        # Written by hand here *and* in the migration, on purpose: ``alembic check`` does
        # not compare CHECK constraints, and the test suite raises its schema from
        # ``Base.metadata``. A constraint declared in only one of the two would hold in
        # every test and be absent in production, with nothing anywhere reporting the gap.
        # The short name is deliberate — the ``ck`` naming convention renders the prefix.
        CheckConstraint("(place_x IS NULL) = (place_y IS NULL)", name="place_is_whole"),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    board_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("shared_board.id", ondelete="CASCADE")
    )
    # Indexed on its own, unlike ``board_id``: this is the column the comp's cascade walks
    # when a comp is deleted, and it leads no other index.
    comp_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("comp.id", ondelete="CASCADE"), index=True
    )
    # Sparse, and deliberately not unique — uniqueness is exactly what would force a move to
    # renumber its neighbours. Never served: the response is an ordered list, so a gap is
    # invisible outside ``shared_boards.py``. See ``POSITION_GAP`` there.
    position: Mapped[int] = mapped_column(Integer)
    # Where the tile sits when a board is floating. Reserved, and unset in this slice — a
    # shared board draws as a grid and no op writes either — so that promoting one to
    # floating later loses nothing and needs no migration.
    place_x: Mapped[int | None] = mapped_column(Integer)
    place_y: Mapped[int | None] = mapped_column(Integer)
    added_by_character_id: Mapped[int | None] = mapped_column(BigInteger)
    added_by_name: Mapped[str | None] = mapped_column(String(200))
    created_at: Mapped[datetime] = _created_at()

    board: Mapped[SharedBoard] = relationship(back_populates="tiles")

    # No ``Comp.shared_board_tiles`` back-reference. ``reach_comp`` eager-loads a comp for
    # all six of its callers, and none of them wants a board's tiles dragged along with it.


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


#: Where a local principal's id comes from: -1, -2, -3, and so on downward.
#:
#: Declared on the metadata so ``create_all`` builds it — the test suite raises its schema from
#: these models rather than from migrations, and a sequence that existed only in 0009 would
#: make every claim fail there and nowhere else. Migration 0009 spells the same DDL out for the
#: deployments that do run migrations.
#:
#: Deliberately not attached to the column as a default. This database is drift-checked with
#: ``compare_server_default=True``, and ``nextval(...)::regclass`` reflects back from Postgres
#: in a shape the check cannot match — the cost ``CompShare.slug`` and ``comps._canonical``
#: both record about expression indices, in a second disguise. ``local_accounts.claim`` reads
#: the sequence itself instead.
PRINCIPAL_SEQUENCE = Sequence(
    "local_account_principal_seq",
    metadata=Base.metadata,
    data_type=BigInteger,
    start=-1,
    increment=-1,
    # The guarantee, in the schema rather than in a convention somebody has to keep: this
    # sequence can never emit a number EVE could also emit.
    maxvalue=-1,
    nominvalue=True,
)


class LocalAccount(Base):
    """A person who got in with the instance password, and the name they claimed.

    The whole of identity when ``COMPTOOL_PASSWORD_AUTH_ENABLED`` is on. There is no EVE
    behind it and nothing to look one up in: the password says the caller belongs here, and
    the name is what the team calls them.

    **``principal_id`` is negative**, and that is the design rather than a quirk. Every
    identity column in this schema is a signed ``BigInteger`` holding an EVE id, and EVE's id
    space is entirely positive — so a local principal fits in the unused half of columns that
    already exist, and ``team.owner_character_id``, ``team_grant.subject_id``,
    ``comp.created_by_character_id``, ``comp_comment.author_character_id`` and
    ``workspace_layout.character_id`` needed no migration to hold one. The sign is also the
    only discriminator anything needs: ``esi.py`` already refuses a non-positive id from ESI,
    and the SPA's portrait builder already returns nothing for one, so a local principal shows
    initials instead of a character portrait without a line of frontend work.

    The ids come from ``local_account_principal_seq``, which counts *down* from -1. Deliberately
    no server default on the column: this database is checked for drift with
    ``compare_server_default=True``, and ``nextval(...)::regclass`` is exactly the shape that
    reflects back from Postgres unmatchable — the cost ``CompShare`` and ``comps._canonical``
    both record about expression indices. ``local_accounts.claim`` calls the sequence instead.

    One row per *name*, not per person, and the two come apart in a way worth stating: with one
    shared password there is nothing a second person could fail to present, so whoever types a
    claimed name signs in as whoever claimed it. The password is the trust boundary; the name
    is a label inside it.
    """

    __tablename__ = "local_account"

    id: Mapped[uuid.UUID] = _uuid_pk()
    #: Negative, unique, and what every other table in this schema stores. See the class
    #: docstring — this is the load-bearing column, not the primary key.
    principal_id: Mapped[int] = mapped_column(BigInteger, unique=True)
    #: The spelling claimed first, kept canonical forever after. Re-entering as "sable" shows
    #: as "Sable", the same way ``esi.py`` returns EVE's spelling rather than what was typed —
    #: which is what keeps a grant's ``subject_name`` agreeing with what its subject sees.
    display_name: Mapped[str] = mapped_column(String(200))
    #: ``display_name`` with internal whitespace collapsed and case folded. The claim lock, and
    #: the only thing lookups match on.
    #:
    #: A stored column rather than a unique index on ``lower(display_name)``, for the reason
    #: ``CompShare.slug`` and ``teams._refuse_duplicate`` both give: an expression index reflects
    #: back from Postgres with casts the drift check cannot match. Its uniqueness is also what
    #: makes ``Resolution.AMBIGUOUS`` unreachable here — a failure mode ESI has to handle and
    #: this schema simply does not have.
    name_folded: Mapped[str] = mapped_column(String(200), unique=True)
    created_at: Mapped[datetime] = _created_at()
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class AuthPasswordAttempt(Base):
    """One rejected password, remembered long enough to slow the next one down.

    Only failures are written. A shared password on a public URL is the entire security of a
    deployment that uses one, and unlike every other credential in this app there is no
    per-account lockout anybody would notice and no second factor — so the length floor in
    ``settings.py`` is the defence and this is the backstop.

    A table rather than a dictionary in the process, for two reasons that are both about being
    honest under deployment rather than under test: a restart must not hand out a fresh
    allowance, and a second uvicorn worker must not double it.
    """

    __tablename__ = "auth_password_attempt"
    __table_args__ = (
        # The lookup every attempt makes: how many failures in this bucket since a cutoff.
        # Leading with scope, because the query is always for one bucket at a time; the
        # purge scans on failed_at alone and is rare enough not to want its own index.
        Index("ix_auth_password_attempt_scope_failed", "scope", "failed_at"),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    #: Which bucket. A hash of the caller's address, or the single fixed key every failure
    #: also lands in — see ``join.py`` for why the global one is the real limit and
    #: the per-address one is a courtesy.
    scope: Mapped[str] = mapped_column(String(64))
    failed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


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
