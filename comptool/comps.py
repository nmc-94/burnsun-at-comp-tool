"""Comps: the lineups a team builds, and the only thing the server stores about them.

Two rules shape every route here.

**Legality is not the server's business.** A comp is stored exactly as it was sent, over
budget or not, and no route asks whether it is legal. The rules live in one place — the
client engine — because a second opinion here would be a second implementation to keep in
step, and the two would eventually disagree in front of a user. The routes below validate
*shape*: a name that is not blank, a positive type id, a list that is not unbounded. They
never validate *rules*.

**A comp you may not see does not exist.** Reaching one goes through the team gate in
``access.py`` and reports its refusal as the same 404 a missing comp gets, so a comp id is
not a way to learn which teams there are.

The collection hangs off a team, because creating a comp means saying which team it joins.
The item is addressed on its own, because a comp is a thing people open, and its team is
already written on it.

Forking is the one exception, and it proves the rule: ``POST /comps/{id}/fork`` creates a
comp from *another comp* rather than from a team, so it is addressed by the thing it copies.
That is also what lets it read the parent's ruleset version off the row instead of taking one
from the request — see :func:`fork_comp`.

What a comp *says about itself* — its archetype and its tags — is content like everything
else here, and no more the engine's business than a name is.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable, Sequence
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from pydantic.alias_generators import to_camel
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from .access import authorize, live, reach_comp
from .auth.dependencies import current_viewer
from .db import get_session
from .live import KIND_CHANGED, KIND_CREATED, KIND_DELETED, origin_client, publish
from .models import (
    AccessLevel,
    Comp,
    CompComment,
    CompShare,
    CompSlot,
    CompTag,
    Ruleset,
    RulesetVersion,
)
from .permissions import Viewer

team_router = APIRouter(prefix="/api/v1/teams", tags=["comps"])
router = APIRouter(prefix="/api/v1/comps", tags=["comps"])


#: A ceiling on how much one request may carry, in the same spirit as a name's maximum
#: length. Deliberately far above any tournament's field size: how many ships a comp may
#: field is a rule, the ruleset owns it, and a comp over that limit is something this
#: server stores and the client flags.
MAX_SLOTS = 100

#: The same kind of ceiling for labels. Well past any useful number of tags on one comp; it
#: exists so a client with a loop bug cannot store an unbounded list, not to tell anybody
#: how to organize their library.
MAX_TAGS = 20

#: What a fork took from its parent. ``partial`` is §4.1c's "partial derivation" — a fork
#: seeded from a chosen subset of the parent's rows rather than all of them.
FORK_FULL = "full"
FORK_PARTIAL = "partial"


class _Response(BaseModel):
    # camelCase on the wire: the SPA is the only consumer.
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class _Request(_Response):
    """Same contract inbound. Named separately so the direction is readable."""


Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Slug = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]
#: One archetype or tag as it arrives. Trimmed and bounded here; the rest of §3.3's
#: normalization — collapsing internal whitespace, and adopting the spelling the team
#: already uses — happens in ``_canonical``, which needs the team to do its job.
TagValue = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]

_LEVEL_NAMES = {
    AccessLevel.NONE: "none",
    AccessLevel.VIEWER: "viewer",
    AccessLevel.EDITOR: "editor",
    AccessLevel.OWNER: "owner",
}


class SlotDetail(_Response):
    position: int
    type_id: int
    is_flagship: bool


class SlotWrite(_Request):
    #: An EVE inventory type id. Whether this particular hull is allowed is a rule, and
    #: rules are the client's; all the server insists on is that it could be an id.
    type_id: Annotated[int, Field(gt=0)]
    is_flagship: bool = False
    #: The row this hull sits on, or null to let the server number it by list order.
    #:
    #: Rows may be left empty between hulls, so a comp is no longer a dense list — a builder
    #: who has turned the tile's sort off arranges hulls into groups, and the gaps between the
    #: groups are part of what they arranged. Only the client can know that, because only the
    #: client draws the scaffold the gaps are in.
    #:
    #: Optional, and null is the honest default rather than a legacy allowance: "here are the
    #: hulls, in order" is a complete statement about a comp nobody has arranged, and every
    #: caller that has nothing to say about rows should go on saying nothing.
    position: Annotated[int, Field(ge=0, lt=MAX_SLOTS)] | None = None


class CompDetail(_Response):
    """One comp, contents and all. There is no lighter shape, deliberately — see below."""

    id: uuid.UUID
    team_id: uuid.UUID
    name: str
    #: The version this comp was built against, and re-validates against forever. The id
    #: stays server-side; the slug and label are what a client needs to fetch the payload.
    ruleset_slug: str
    ruleset_version_label: str
    ship_count: int
    #: Whoever created it, captured once. Null on comps made before anyone signed in.
    created_by_name: str | None
    #: The same character as an id, because a name cannot be compared against. A client gates
    #: its delete controls on "did I make this", and matching on ``created_by_name`` would
    #: turn a character rename into somebody else's comp.
    created_by_character_id: int | None
    created_at: datetime
    updated_at: datetime
    #: What the requesting character holds on the owning team. The SPA gates its controls
    #: on this rather than guessing.
    your_level: str
    #: The comp's shape, from the team's Archetype namespace. At most one.
    archetype: str | None
    #: Its labels, from the separate Tags namespace. Sorted, so no client has to.
    tags: list[str]
    #: Where the comp came from, if it was forked. The id is null once the parent has been
    #: deleted; the name is the record and outlives it, so a fork still says where it came
    #: from even when there is no longer anywhere to follow.
    forked_from_comp_id: uuid.UUID | None
    forked_from_name: str | None
    #: ``full`` or ``partial`` — see :data:`FORK_FULL`. Null when this comp is not a fork.
    fork_kind: str | None
    #: How long the thread is, and how many comps were forked from this one. Counted rather
    #: than loaded: a fifty-comp listing has no business dragging every comment body with it.
    comment_count: int
    fork_count: int
    #: The live share link's slug, or null when this comp is not shared. Flat rather than a
    #: nested object, following ``forked_from_*``: one concept, one field each.
    share_slug: str | None
    #: Whether the comp has moved since the share was captured. A share is a snapshot, so
    #: without this the link would silently show last week's comp forever — the mirror of the
    #: surprise a live view would spring. False when there is no share.
    share_stale: bool
    #: Always present, the listing included. The library rail draws a legality dot and a
    #: point total per comp, legality is the client's to compute, and a comp without its
    #: slots is a comp the client cannot judge. The listing already loads them to count
    #: ships; withholding them only bought a second request per comp on the rail's first
    #: paint.
    slots: list[SlotDetail]


class CompCreate(_Request):
    name: Name
    #: Which ruleset to build against. Required rather than defaulted: the one slug this
    #: deployment happens to seed is content, and content does not belong in the server's
    #: code. The *version* is not accepted — see ``_latest_version``.
    ruleset_slug: Slug


class CompRename(_Request):
    name: Name


class SlotsReplace(_Request):
    """The comp's whole slot list, in order.

    Replacing wholesale rather than patching one slot at a time: the builder holds the
    entire comp anyway, every edit is "here is what it looks like now", and add, remove
    and reorder all fall out of it for free.
    """

    slots: Annotated[list[SlotWrite], Field(max_length=MAX_SLOTS)]


class TagsReplace(_Request):
    """Everything the team says about this comp, in one shape.

    Replaced wholesale for the same reason the slots are: the editor holds all of it anyway,
    and "here is what it says now" cannot express a removal it forgot to mention. Both
    namespaces travel together because they are edited together, and they stay named apart
    because §3.3 says they never mix.
    """

    #: Null clears it. A comp with no archetype is the ordinary state of a new comp, not an
    #: error, so there is nothing here to refuse.
    archetype: TagValue | None = None
    tags: Annotated[list[TagValue], Field(default_factory=list, max_length=MAX_TAGS)]


class CompFork(_Request):
    """A new comp seeded from an existing one.

    ``positions`` is what makes this one route rather than two. §4.1c calls a full fork "just
    the all-rows case" of the partial one, so omitting the field means the whole comp and
    naming rows means a partial derivation — one gesture, one lineage record, one place where
    the parent's version is read.

    No version field, deliberately, exactly as ``CompCreate`` has none: the fork's binding is
    the parent's, read off the parent row on the server. A client that could name a version
    could pin a fork to the wrong one, and a fork's whole value is being comparable to what
    it came from.
    """

    name: Name
    #: Row numbers from the parent, as ``SlotDetail.position`` reports them. Omitted means
    #: every row.
    positions: Annotated[list[int], Field(max_length=MAX_SLOTS)] | None = None


def _tally(session: Session, comp_ids: Sequence[uuid.UUID]) -> dict[uuid.UUID, tuple[int, int]]:
    """Comments per comp, and forks per comp, for the comps named.

    Two grouped counts rather than two relationships: ``len(comp.comments)`` would pull every
    comment body on the team into a listing that draws a number, and there is no relationship
    to count forks through at all.

    Both routes go through this — the detail route with one id — because ``CompDetail`` is
    served by the listing *and* by the detail, and a field computed twice is a field that will
    eventually disagree with itself.
    """
    if not comp_ids:
        return {}
    comments = dict(
        session.execute(
            select(CompComment.comp_id, func.count())
            .where(CompComment.comp_id.in_(comp_ids))
            .group_by(CompComment.comp_id)
        ).all()
    )
    forks = dict(
        session.execute(
            select(Comp.forked_from_comp_id, func.count())
            .where(Comp.forked_from_comp_id.in_(comp_ids))
            .group_by(Comp.forked_from_comp_id)
        ).all()
    )
    return {
        comp_id: (comments.get(comp_id, 0), forks.get(comp_id, 0)) for comp_id in comp_ids
    }


def _shares(
    session: Session, comp_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, tuple[str, datetime]]:
    """The live share link of each comp named, and when it was captured.

    One query for the page, beside :func:`_tally` and for the same reason. Deliberately not a
    relationship on ``Comp``: ``reach_comp`` eager-loads for every module that reaches a comp,
    and a fourth ``selectinload`` there would put a query on every comment route to serve a
    field comments do not have.
    """
    if not comp_ids:
        return {}
    rows = session.execute(
        select(CompShare.comp_id, CompShare.slug, CompShare.captured_at).where(
            CompShare.comp_id.in_(comp_ids), CompShare.revoked_at.is_(None)
        )
    ).all()
    return {comp_id: (slug, captured_at) for comp_id, slug, captured_at in rows}


def _detail(
    comp: Comp,
    level: AccessLevel,
    tally: tuple[int, int] = (0, 0),
    share: tuple[str, datetime] | None = None,
) -> CompDetail:
    comment_count, fork_count = tally
    return CompDetail(
        id=comp.id,
        team_id=comp.team_id,
        name=comp.name,
        ruleset_slug=comp.ruleset_version.ruleset.slug,
        ruleset_version_label=comp.ruleset_version.version_label,
        # Redundant with len(slots) now, and kept deliberately: it is the number a list
        # prints, and a client should not have to derive the headline from the payload.
        ship_count=len(comp.slots),
        created_by_name=comp.created_by_name,
        created_by_character_id=comp.created_by_character_id,
        created_at=comp.created_at,
        updated_at=comp.updated_at,
        your_level=_LEVEL_NAMES[level],
        archetype=comp.archetype,
        # The relationship is ordered by tag, so this is sorted without saying so twice.
        tags=[row.tag for row in comp.tags],
        forked_from_comp_id=comp.forked_from_comp_id,
        forked_from_name=comp.forked_from_name,
        fork_kind=comp.fork_kind,
        comment_count=comment_count,
        fork_count=fork_count,
        share_slug=share[0] if share else None,
        # A share is a snapshot, so "the comp has moved on" is exactly this comparison. It is
        # only meaningful because ``_apply_slots`` now touches ``updated_at`` — before that a
        # hull change left it still, and this would have read false forever.
        share_stale=bool(share and comp.updated_at > share[1]),
        slots=[
            SlotDetail(position=slot.position, type_id=slot.type_id, is_flagship=slot.is_flagship)
            for slot in comp.slots
        ],
    )


def _one(session: Session, comp: Comp, level: AccessLevel) -> CompDetail:
    """``_detail`` for a single comp, with its counts fetched. The item routes' answer."""
    return _detail(
        comp,
        level,
        _tally(session, [comp.id]).get(comp.id, (0, 0)),
        _shares(session, [comp.id]).get(comp.id),
    )


def _latest_version(session: Session, slug: str) -> RulesetVersion:
    """The newest published version of a ruleset.

    Resolved here rather than taken from the request: a client that could name the version
    could pin a comp to an old one by accident, and a comp's binding is the one thing that
    has to be right for it to still mean something next month.
    """
    record = session.scalar(
        select(Ruleset).where(Ruleset.slug == slug).options(selectinload(Ruleset.versions))
    )
    if record is None or not record.versions:
        raise HTTPException(status_code=404, detail=f"No ruleset {slug!r}")
    return record.versions[-1]


def _positions(slots: list[SlotWrite]) -> list[int]:
    """The row each hull sits on: the caller's numbering, or list order when it gave none.

    All or nothing. A request that numbers some of its hulls and not others is not a comp with
    gaps in it — it is a client that has half-migrated, and guessing the rest from list order
    would place hulls somewhere nobody asked for. The one number that cannot be guessed is the
    one that matters here, so it is refused rather than invented.

    Duplicates are refused for the same reason the database refuses them: two hulls on one row
    is not a comp anybody can draw, and ``uq comp_id/position`` would answer it as a 500 several
    layers away from the request that caused it.
    """
    numbered = [slot.position for slot in slots if slot.position is not None]
    if not numbered:
        # A comp nobody has arranged, which is every comp until somebody turns the tile's sort
        # off and leaves a gap. Order in the request is the whole of the information.
        return list(range(len(slots)))
    if len(numbered) != len(slots):
        raise HTTPException(
            status_code=422,
            detail=(
                f"Either every slot carries a position or none does; "
                f"{len(numbered)} of {len(slots)} did"
            ),
        )
    if len(set(numbered)) != len(numbered):
        raise HTTPException(status_code=422, detail="Two slots cannot share a position")
    return numbered


def _apply_slots(session: Session, comp: Comp, slots: list[SlotWrite]) -> None:
    """Replace a comp's slots with ``slots``, on the rows they name or numbered from zero.

    Positions used to be assigned here and never accepted, on the grounds that a comp is a
    dense ordered list. It is not one any more: a builder can leave a row empty between two
    hulls, and where the gaps are is something only the client knows. So the numbering is
    taken when it is offered and derived when it is not — see ``_positions``, which is where
    the "a gap or a duplicate cannot be expressed" guarantee moved to. Gaps are now expressible
    and duplicates still are not.

    The stored list stays *ordered* by position either way, which is what
    ``Comp.slots``' ``order_by`` promises every reader.
    """
    flagships = [index for index, slot in enumerate(slots) if slot.is_flagship]
    if len(flagships) > 1:
        # The database says so too, via a partial unique index, but only after the fact
        # and only in its own words. This exists so the answer names the problem.
        raise HTTPException(
            status_code=409,
            detail=f"A comp has at most one flagship; {len(flagships)} were designated",
        )

    positions = _positions(slots)

    comp.slots.clear()
    # Flushed before the new rows are appended: the deletes and the inserts would
    # otherwise reach the database together and collide on (comp_id, position).
    session.flush()
    for position, slot in sorted(zip(positions, slots, strict=True), key=lambda pair: pair[0]):
        comp.slots.append(
            CompSlot(position=position, type_id=slot.type_id, is_flagship=slot.is_flagship)
        )

    # Touched explicitly, because ``Comp.updated_at``'s ``onupdate`` fires only when the *comp*
    # row is itself in an UPDATE — and everything above writes ``comp_slot`` rows instead. So
    # until now, changing a comp's hulls did not change when the comp was last modified, which
    # is the one thing that field exists to say. ``func.now()`` rather than a Python clock, so
    # every timestamp in the schema still comes from the database.
    comp.updated_at = func.now()


def _canonical(value: str, in_use: Iterable[str]) -> str:
    """One spelling per value per team, per §3.3's "Kiter" and "kiter " must not diverge.

    Internal whitespace is collapsed — the ``TagValue`` constraint has already trimmed the
    ends — and then the value adopts the spelling the team already uses, if it has one.

    Storing the *team's* casing rather than a folded one is what makes this liveable: a chip
    reading "kiter" because somebody once typed it in a hurry would be a worse answer than
    the problem. So the first person to use a value chooses how it is written, and everyone
    after them matches without having to know.

    Matched in Python rather than by a unique index on ``lower(tag)``, and for the reason
    ``teams.py``'s ``_refuse_duplicate`` records: an expression index reflects back from
    Postgres with casts the drift check cannot match, and would report permanent drift.
    """
    collapsed = " ".join(value.split())
    folded = collapsed.casefold()
    for existing in in_use:
        if existing.casefold() == folded:
            return existing
    return collapsed


def _values_in_use(session: Session, team_id: uuid.UUID) -> tuple[list[str], list[str]]:
    """Every archetype and every tag already spelled somewhere on this team.

    Two queries, both scoped to the team, because a suggestion set that reached across teams
    would leak one team's content into another's — the same class of mistake ``authorize`` and
    ``workspace.py``'s id-dropping exist to prevent. The two are returned apart and never
    merged: §3.3 says the namespaces do not cross-suggest, and the only honest way to promise
    that is to never put them in one list.
    """
    archetypes = session.scalars(
        select(Comp.archetype)
        .where(Comp.team_id == team_id, Comp.archetype.is_not(None))
        .distinct()
    ).all()
    tags = session.scalars(
        select(CompTag.tag)
        .join(Comp, Comp.id == CompTag.comp_id)
        .where(Comp.team_id == team_id)
        .distinct()
    ).all()
    return list(archetypes), list(tags)


def _apply_tags(session: Session, comp: Comp, body: TagsReplace) -> None:
    """Set the comp's archetype and tags, normalized against the team's own vocabulary."""
    archetypes_in_use, tags_in_use = _values_in_use(session, comp.team_id)

    comp.archetype = (
        None if body.archetype is None else _canonical(body.archetype, archetypes_in_use)
    )

    # Canonicalized against what this request has already accepted as well as against the
    # team, so "Kiter" and "kiter" arriving together collapse into one tag rather than
    # colliding on the unique index.
    kept: list[str] = []
    for raw in body.tags:
        tag = _canonical(raw, [*tags_in_use, *kept])
        if tag not in kept:
            kept.append(tag)

    comp.tags.clear()
    # Flushed for the reason ``_apply_slots`` flushes: without it the deletes and the inserts
    # reach the database together and collide on (comp_id, tag) when a tag is being re-sent.
    session.flush()
    for tag in sorted(kept):
        comp.tags.append(CompTag(tag=tag))

    # Touched explicitly, for the reason ``_apply_slots`` gives at length: ``onupdate`` fires
    # only when the *comp* row is itself in an UPDATE, and a tag change writes ``comp_tag``
    # rows. The archetype assignment above is a real column, but SQLAlchemy emits nothing for
    # it when the value has not changed — so re-tagging a comp without touching its archetype
    # left ``updated_at`` standing still. That also made ``share_stale`` quietly wrong for
    # exactly that edit, in the direction that says a link is current when it is not.
    comp.updated_at = func.now()


def _announce(comp: Comp, kind: str, viewer: Viewer, origin: str | None) -> None:
    """Tell the team's open boards, after the write has actually landed.

    Called after ``commit`` in every case, never before: an event is a promise that a re-read
    will show the change, and a peer that read between a flush and a rollback would be told
    about something that never happened.

    Reading ``comp.updated_at`` here is a query rather than a field access, and deliberately
    so. ``_apply_slots`` and ``_apply_tags`` assign ``func.now()``, which SQLAlchemy resolves
    by expiring the attribute and re-selecting it — the same reason ``_detail`` gets a real
    timestamp out of it. The value is what the client compares against to decide whether it
    already has this version.
    """
    publish(
        comp.team_id,
        kind,
        comp_id=comp.id,
        actor=viewer.character_name,
        origin=origin,
        updated_at=comp.updated_at,
    )


@team_router.get("/{team_id}/comps", response_model=list[CompDetail])
def list_comps(
    team_id: uuid.UUID,
    session: Session = Depends(get_session),
    viewer: Viewer = Depends(current_viewer),
) -> list[CompDetail]:
    """Every comp on the team, contents and all.

    Slots included because the library rail's legality dot is computed in the browser and
    there is nothing to compute it from otherwise. They were already being loaded here to
    count ships.
    """
    access = authorize(session, team_id, viewer, AccessLevel.VIEWER)
    comps = session.scalars(
        select(Comp)
        .where(Comp.team_id == access.team.id)
        .options(
            selectinload(Comp.slots),
            selectinload(Comp.tags),
            # Down to the ruleset itself: the response reads its slug, and stopping at the
            # version leaves that to a lazy load once per comp.
            selectinload(Comp.ruleset_version).selectinload(RulesetVersion.ruleset),
        )
        .order_by(Comp.name)
    ).all()
    # One pair of counting queries for the whole page, not one pair per comp.
    comp_ids = [comp.id for comp in comps]
    tally = _tally(session, comp_ids)
    shares = _shares(session, comp_ids)
    return [
        _detail(comp, access.level, tally.get(comp.id, (0, 0)), shares.get(comp.id))
        for comp in comps
    ]


@team_router.post("/{team_id}/comps", response_model=CompDetail, status_code=201)
def create_comp(
    team_id: uuid.UUID,
    body: CompCreate,
    session: Session = Depends(get_session),
    viewer: Viewer = Depends(current_viewer),
    origin: str | None = Depends(origin_client),
) -> CompDetail:
    """Start a comp, empty, bound to the ruleset it will be judged by."""
    access = authorize(session, team_id, viewer, AccessLevel.EDITOR)
    team = live(access)
    comp = Comp(
        team_id=team.id,
        ruleset_version_id=_latest_version(session, body.ruleset_slug).id,
        name=body.name,
        # Written once and never reassigned, so authorship survives every later edit and
        # every fork.
        created_by_character_id=viewer.character_id,
        created_by_name=viewer.character_name,
    )
    session.add(comp)
    session.commit()
    _announce(comp, KIND_CREATED, viewer, origin)
    return _one(session, comp, access.level)


@router.get("/{comp_id}", response_model=CompDetail)
def comp_detail(
    comp_id: uuid.UUID,
    session: Session = Depends(get_session),
    viewer: Viewer = Depends(current_viewer),
) -> CompDetail:
    comp, access = reach_comp(session, comp_id, viewer, AccessLevel.VIEWER)
    return _one(session, comp, access.level)


@router.patch("/{comp_id}", response_model=CompDetail)
def rename_comp(
    comp_id: uuid.UUID,
    body: CompRename,
    session: Session = Depends(get_session),
    viewer: Viewer = Depends(current_viewer),
    origin: str | None = Depends(origin_client),
) -> CompDetail:
    comp, access = reach_comp(session, comp_id, viewer, AccessLevel.EDITOR)
    live(access)
    comp.name = body.name
    session.commit()
    _announce(comp, KIND_CHANGED, viewer, origin)
    return _one(session, comp, access.level)


@router.put("/{comp_id}/slots", response_model=CompDetail)
def replace_slots(
    comp_id: uuid.UUID,
    body: SlotsReplace,
    session: Session = Depends(get_session),
    viewer: Viewer = Depends(current_viewer),
    origin: str | None = Depends(origin_client),
) -> CompDetail:
    """Store the comp as it now stands.

    Nothing here asks whether the result is legal. An eleven-ship comp fifty points over
    budget saves exactly like a legal one; the builder is already showing its owner what
    is wrong with it.
    """
    comp, access = reach_comp(session, comp_id, viewer, AccessLevel.EDITOR)
    live(access)
    _apply_slots(session, comp, body.slots)
    session.commit()
    _announce(comp, KIND_CHANGED, viewer, origin)
    return _one(session, comp, access.level)


@router.put("/{comp_id}/tags", response_model=CompDetail)
def replace_tags(
    comp_id: uuid.UUID,
    body: TagsReplace,
    session: Session = Depends(get_session),
    viewer: Viewer = Depends(current_viewer),
    origin: str | None = Depends(origin_client),
) -> CompDetail:
    """Say what this comp is: one archetype, any number of tags.

    Content, not rules. An archetype is a captain's word for a shape and a tag is a label
    somebody found useful; neither reaches the legality engine, and no route here asks whether
    a "Kite" comp actually kites.
    """
    comp, access = reach_comp(session, comp_id, viewer, AccessLevel.EDITOR)
    live(access)
    _apply_tags(session, comp, body)
    session.commit()
    _announce(comp, KIND_CHANGED, viewer, origin)
    return _one(session, comp, access.level)


@router.post("/{comp_id}/fork", response_model=CompDetail, status_code=201)
def fork_comp(
    comp_id: uuid.UUID,
    body: CompFork,
    session: Session = Depends(get_session),
    viewer: Viewer = Depends(current_viewer),
    origin: str | None = Depends(origin_client),
) -> CompDetail:
    """Copy a comp into a new, independent one that remembers where it came from.

    **The fork keeps the parent's ruleset version**, and that is the decision this route
    exists to hold. A fork is taken to be compared against its parent — the same comp with one
    hull changed, the same comp without the flagship — and a fork priced by August against a
    parent priced by June is not a comparison, it is a confound. The version is read off the
    parent row here, so the rule that a client may never name a version survives intact;
    moving a comp onto newer rules stays §4.2's re-validation, which is an explicit act.

    Editor, because a fork is a new comp on the team and adding one has always needed editor.
    Nothing asks whether either comp is legal: a fork of an illegal comp is an illegal comp,
    and it lands.
    """
    parent, access = reach_comp(session, comp_id, viewer, AccessLevel.EDITOR)
    team = live(access)

    if body.positions is None:
        taken = list(parent.slots)
        kind = FORK_FULL
    else:
        # Dropped rather than refused, the way ``workspace.py`` drops comp ids that no longer
        # resolve: a position that is not in the comp is a client working from a view that has
        # moved on, and refusing the whole fork over it would lose the rows that are still
        # good. Read in the parent's order, not the request's — the rows are a subset of an
        # ordered list, and the caller's ordering of row numbers is not information.
        wanted = set(body.positions)
        taken = [slot for slot in parent.slots if slot.position in wanted]
        kind = FORK_PARTIAL

    fork = Comp(
        team_id=team.id,
        # The parent's, deliberately. See the docstring.
        ruleset_version_id=parent.ruleset_version_id,
        name=body.name,
        # The forking character, not the parent's creator — §4.1a's one remaining clause.
        created_by_character_id=viewer.character_id,
        created_by_name=viewer.character_name,
        archetype=parent.archetype,
        forked_from_comp_id=parent.id,
        # Snapshotted, so deleting the parent costs the fork its link but not its history.
        forked_from_name=parent.name,
        fork_kind=kind,
    )
    for tag in parent.tags:
        fork.tags.append(CompTag(tag=tag.tag))
    session.add(fork)
    # Flushed before the slots go on, because ``_apply_slots`` flushes a clear of a list that
    # does not exist yet unless the comp has a row to hang them off.
    session.flush()

    # The flagship carries. A comp holds at most one, so a whole comp brings at most one and
    # any subset of it brings at most one — the designation is always still valid here, unlike
    # a copy *into* an existing comp, which is what §9.3's "flagship drops" was written about.
    #
    # The **arrangement** carries only for a whole fork, and the asymmetry is the point. A comp
    # can have rows left empty between its hulls; a full fork that came back packed to the top
    # would not look like its parent, which is the one thing a fork exists to be compared
    # against. A partial fork is not a copy of that comp — it is these hulls in a comp of their
    # own — and the empty rows in it would be the shape of the rows somebody *did not* take,
    # which is a fact about the parent and nothing about the new comp. So it starts at row zero.
    keep_rows = kind == FORK_FULL
    _apply_slots(
        session,
        fork,
        [
            SlotWrite(
                type_id=slot.type_id,
                is_flagship=slot.is_flagship,
                position=slot.position if keep_rows else None,
            )
            for slot in taken
        ],
    )
    session.commit()
    # Reloaded through the gate so the response is built from the same shape every other comp
    # response is: ``fork.ruleset_version`` is otherwise a lazy load of a relationship the new
    # object never had populated.
    made, _ = reach_comp(session, fork.id, viewer, AccessLevel.VIEWER)
    # The fork only. The parent is untouched by this route — its ``fork_count`` is derived at
    # read time rather than stored — and announcing a change to it would send every open board
    # off to re-read a comp that says exactly what it said before.
    _announce(made, KIND_CREATED, viewer, origin)
    return _one(session, made, access.level)


@router.delete("/{comp_id}", status_code=204)
def delete_comp(
    comp_id: uuid.UUID,
    session: Session = Depends(get_session),
    viewer: Viewer = Depends(current_viewer),
    origin: str | None = Depends(origin_client),
) -> Response:
    """Delete a comp: your own, or anyone's if you own the team.

    Unlike a team, a comp really is deleted. A team is a season's record and other
    people's work; a comp is one draft among many, and a builder who cannot throw one away
    accumulates clutter they have to read past every time.

    **Whose comp, though.** Editing someone else's draft is collaboration and deleting it is
    not, so the same editor grant that lets the whole team build cannot also let anyone
    discard anyone's work. This is ``delete_comment``'s rule and it is deliberately spelled
    the same way, including the owner clause — without which a comp made by someone who has
    since left the team would be permanently unremovable, there being no way to hand a comp
    to a new author.

    Reached at editor level first, so a viewer still gets the 404 every other refusal here
    gives and learns nothing from the difference between "may not" and "is not there". The
    403 below is the opposite case on purpose: a comp you can plainly see, and are being told
    is not yours.

    A comp forked from this one survives it. The child's ``forked_from_comp_id`` is set null
    by the database and its ``forked_from_name`` stays, so the fork still says where it came
    from — which is why the constraint is SET NULL and not RESTRICT: a parent nobody can
    delete would make lineage a trap rather than a record.
    """
    comp, access = reach_comp(session, comp_id, viewer, AccessLevel.EDITOR)
    live(access)
    if comp.created_by_character_id != viewer.character_id and access.level < AccessLevel.OWNER:
        raise HTTPException(
            status_code=403, detail="Only a comp's creator or the team's owner can delete it"
        )
    # Read off the row before it goes: after the delete there is no comp left to ask, and
    # ``_announce`` would be reading an object detached from anything.
    team_id, gone = comp.team_id, comp.id
    session.delete(comp)
    session.commit()
    publish(
        team_id,
        KIND_DELETED,
        comp_id=gone,
        actor=viewer.character_name,
        origin=origin,
    )
    return Response(status_code=204)
