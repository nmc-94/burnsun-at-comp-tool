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
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from pydantic.alias_generators import to_camel
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from .access import Access, authorize, live
from .auth.dependencies import current_viewer
from .db import get_session
from .models import AccessLevel, Comp, CompSlot, Ruleset, RulesetVersion
from .permissions import Viewer

team_router = APIRouter(prefix="/api/v1/teams", tags=["comps"])
router = APIRouter(prefix="/api/v1/comps", tags=["comps"])


#: A ceiling on how much one request may carry, in the same spirit as a name's maximum
#: length. Deliberately far above any tournament's field size: how many ships a comp may
#: field is a rule, the ruleset owns it, and a comp over that limit is something this
#: server stores and the client flags.
MAX_SLOTS = 100


class _Response(BaseModel):
    # camelCase on the wire: the SPA is the only consumer.
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class _Request(_Response):
    """Same contract inbound. Named separately so the direction is readable."""


Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Slug = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]

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


class CompSummary(_Response):
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
    created_at: datetime
    updated_at: datetime
    #: What the requesting character holds on the owning team. The SPA gates its controls
    #: on this rather than guessing.
    your_level: str


class CompDetail(CompSummary):
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


def _summary_fields(comp: Comp, level: AccessLevel) -> dict:
    return {
        "id": comp.id,
        "team_id": comp.team_id,
        "name": comp.name,
        "ruleset_slug": comp.ruleset_version.ruleset.slug,
        "ruleset_version_label": comp.ruleset_version.version_label,
        "ship_count": len(comp.slots),
        "created_by_name": comp.created_by_name,
        "created_at": comp.created_at,
        "updated_at": comp.updated_at,
        "your_level": _LEVEL_NAMES[level],
    }


def _summary(comp: Comp, level: AccessLevel) -> CompSummary:
    return CompSummary(**_summary_fields(comp, level))


def _detail(comp: Comp, level: AccessLevel) -> CompDetail:
    return CompDetail(
        **_summary_fields(comp, level),
        slots=[
            SlotDetail(position=slot.position, type_id=slot.type_id, is_flagship=slot.is_flagship)
            for slot in comp.slots
        ],
    )


def _no_comp(comp_id: uuid.UUID) -> HTTPException:
    # The same answer for "no such comp", "its team is not yours", and "that id belongs to
    # another team". Distinguishing any of them would turn a comp id into a probe for
    # which teams exist.
    return HTTPException(status_code=404, detail=f"No comp {str(comp_id)!r}")


def _reach(
    session: Session, comp_id: uuid.UUID, viewer: Viewer, required: AccessLevel
) -> tuple[Comp, Access]:
    """The only way a route reaches a comp.

    The comp is loaded first because its team is what decides, then the team gate runs.
    Its refusal is swallowed and re-raised comp-shaped: letting ``authorize``'s "No team
    <id>" escape from a comp route would confirm the team is real.
    """
    comp = session.scalar(
        select(Comp)
        .where(Comp.id == comp_id)
        .options(selectinload(Comp.slots), selectinload(Comp.ruleset_version))
    )
    if comp is None:
        raise _no_comp(comp_id)
    try:
        access = authorize(session, comp.team_id, viewer, required)
    except HTTPException:
        raise _no_comp(comp_id) from None
    return comp, access


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


def _apply_slots(session: Session, comp: Comp, slots: list[SlotWrite]) -> None:
    """Replace a comp's slots with ``slots``, numbering them from zero.

    Positions are assigned here rather than accepted from the caller. A comp is a dense
    ordered list — the builder draws filled rows first and empty scaffold after — so the
    order in the request is the whole of the information, and deriving the numbering means
    a gap or a duplicate cannot be expressed in the first place.
    """
    flagships = [index for index, slot in enumerate(slots) if slot.is_flagship]
    if len(flagships) > 1:
        # The database says so too, via a partial unique index, but only after the fact
        # and only in its own words. This exists so the answer names the problem.
        raise HTTPException(
            status_code=409,
            detail=f"A comp has at most one flagship; {len(flagships)} were designated",
        )

    comp.slots.clear()
    # Flushed before the new rows are appended: the deletes and the inserts would
    # otherwise reach the database together and collide on (comp_id, position).
    session.flush()
    for position, slot in enumerate(slots):
        comp.slots.append(
            CompSlot(position=position, type_id=slot.type_id, is_flagship=slot.is_flagship)
        )


@team_router.get("/{team_id}/comps", response_model=list[CompSummary])
def list_comps(
    team_id: uuid.UUID,
    session: Session = Depends(get_session),
    viewer: Viewer = Depends(current_viewer),
) -> list[CompSummary]:
    access = authorize(session, team_id, viewer, AccessLevel.VIEWER)
    comps = session.scalars(
        select(Comp)
        .where(Comp.team_id == access.team.id)
        .options(selectinload(Comp.slots), selectinload(Comp.ruleset_version))
        .order_by(Comp.name)
    ).all()
    return [_summary(comp, access.level) for comp in comps]


@team_router.post("/{team_id}/comps", response_model=CompDetail, status_code=201)
def create_comp(
    team_id: uuid.UUID,
    body: CompCreate,
    session: Session = Depends(get_session),
    viewer: Viewer = Depends(current_viewer),
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
    return _detail(comp, access.level)


@router.get("/{comp_id}", response_model=CompDetail)
def comp_detail(
    comp_id: uuid.UUID,
    session: Session = Depends(get_session),
    viewer: Viewer = Depends(current_viewer),
) -> CompDetail:
    comp, access = _reach(session, comp_id, viewer, AccessLevel.VIEWER)
    return _detail(comp, access.level)


@router.patch("/{comp_id}", response_model=CompDetail)
def rename_comp(
    comp_id: uuid.UUID,
    body: CompRename,
    session: Session = Depends(get_session),
    viewer: Viewer = Depends(current_viewer),
) -> CompDetail:
    comp, access = _reach(session, comp_id, viewer, AccessLevel.EDITOR)
    live(access)
    comp.name = body.name
    session.commit()
    return _detail(comp, access.level)


@router.put("/{comp_id}/slots", response_model=CompDetail)
def replace_slots(
    comp_id: uuid.UUID,
    body: SlotsReplace,
    session: Session = Depends(get_session),
    viewer: Viewer = Depends(current_viewer),
) -> CompDetail:
    """Store the comp as it now stands.

    Nothing here asks whether the result is legal. An eleven-ship comp fifty points over
    budget saves exactly like a legal one; the builder is already showing its owner what
    is wrong with it.
    """
    comp, access = _reach(session, comp_id, viewer, AccessLevel.EDITOR)
    live(access)
    _apply_slots(session, comp, body.slots)
    session.commit()
    return _detail(comp, access.level)


@router.delete("/{comp_id}", status_code=204)
def delete_comp(
    comp_id: uuid.UUID,
    session: Session = Depends(get_session),
    viewer: Viewer = Depends(current_viewer),
) -> Response:
    """Delete a comp.

    Unlike a team, a comp really is deleted. A team is a season's record and other
    people's work; a comp is one draft among many, and a builder who cannot throw one away
    accumulates clutter they have to read past every time.
    """
    comp, access = _reach(session, comp_id, viewer, AccessLevel.EDITOR)
    live(access)
    session.delete(comp)
    session.commit()
    return Response(status_code=204)
