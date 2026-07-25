"""Teams, and who may see them.

Three rules shape every route here.

**Teams are private.** A new team is visible to its owner and to nobody else, and the
listing is "teams that are mine" — owned, or granted to me — rather than a directory of
everything readable. ``Team.base_level`` still exists and the resolver still honours it,
but nothing here sets it: a switch that makes a team world-readable wants a considered
design and a way to see the state afterwards, and that arrives with share links.

**A team you may not see does not exist.** Existence and permission are answered together
and reported identically, because answering them separately is precisely what turns a 404
into "wrong team id" and a 403 into "right team id, keep trying".

**Grants are written by name and matched by id.** A name that does not resolve is stored
anyway, as a pending invitation that displays and grants nothing — never rejected, and
never silently dropped.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from enum import StrEnum
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, StringConstraints
from pydantic.alias_generators import to_camel
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session, selectinload

from .access import authorize, live
from .auth.dependencies import current_viewer
from .db import get_session
from .esi import CharacterResolver, Resolution, get_character_resolver
from .models import AccessLevel, SubjectKind, Team, TeamGrant
from .permissions import Viewer, resolve_level

router = APIRouter(prefix="/api/v1/teams", tags=["teams"])


class _Response(BaseModel):
    # camelCase on the wire: the SPA is the only consumer.
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class _Request(_Response):
    """Same contract inbound. Named separately so the direction is readable."""


class GrantLevel(StrEnum):
    """The roles the API speaks, so the SPA never sends a bare ladder integer.

    Owner is deliberately absent. Ownership is a column the resolver short-circuits on
    and no grant can revoke it, so an "owner grant" would be a second, weaker owner whose
    powers nobody has specified. Adding co-ownership later is a change to this enum and
    nothing else — the ladder already has the rung.
    """

    VIEWER = "viewer"
    EDITOR = "editor"


_GRANTABLE = {GrantLevel.VIEWER: AccessLevel.VIEWER, GrantLevel.EDITOR: AccessLevel.EDITOR}
_LEVEL_NAMES = {
    AccessLevel.NONE: "none",
    AccessLevel.VIEWER: "viewer",
    AccessLevel.EDITOR: "editor",
    AccessLevel.OWNER: "owner",
}


#: Trimmed before it is measured, so a name of nothing but spaces is refused rather than
#: quietly stored as an empty string.
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]


class TeamSummary(_Response):
    id: uuid.UUID
    name: str
    owner_character_id: int
    #: What the requesting character holds. The SPA gates its controls on this rather
    #: than guessing from ownership.
    your_level: str
    archived: bool
    created_at: datetime
    updated_at: datetime


class TeamCreate(_Request):
    name: Name


class TeamRename(_Request):
    name: Name


class GrantCreate(_Request):
    character_name: Name
    level: GrantLevel


class GrantChange(_Request):
    level: GrantLevel


class GrantDetail(_Response):
    id: uuid.UUID
    subject_kind: str
    subject_id: int | None
    subject_name: str
    level: str
    #: The name has not been resolved to an id, so this grants nothing yet.
    pending: bool
    #: Why the last lookup left it pending — present only on the response that *was* that
    #: lookup. Never stored: a listed grant reports null rather than a stale reason.
    resolution: str | None = None
    created_at: datetime


def _summary(team: Team, level: AccessLevel) -> TeamSummary:
    return TeamSummary(
        id=team.id,
        name=team.name,
        owner_character_id=team.owner_character_id,
        your_level=_LEVEL_NAMES[level],
        archived=team.archived_at is not None,
        created_at=team.created_at,
        updated_at=team.updated_at,
    )


def _grant(grant: TeamGrant, resolution: Resolution | None = None) -> GrantDetail:
    return GrantDetail(
        id=grant.id,
        subject_kind=grant.subject_kind,
        subject_id=grant.subject_id,
        subject_name=grant.subject_name,
        level=_LEVEL_NAMES[AccessLevel(grant.level)],
        pending=grant.subject_id is None,
        resolution=resolution.value if resolution is not None else None,
        created_at=grant.created_at,
    )


def _find_grant(session: Session, team: Team, grant_id: uuid.UUID) -> TeamGrant:
    # Scoped to the team, so a grant id from another team is not reachable by guessing a
    # team you can see.
    grant = session.scalar(
        select(TeamGrant).where(TeamGrant.id == grant_id, TeamGrant.team_id == team.id)
    )
    if grant is None:
        raise HTTPException(status_code=404, detail=f"No grant {str(grant_id)!r}")
    return grant


@router.get("", response_model=list[TeamSummary])
def list_teams(
    archived: bool = False,
    session: Session = Depends(get_session),
    viewer: Viewer = Depends(current_viewer),
) -> list[TeamSummary]:
    """The teams that are mine: owned, or granted to me and resolved.

    Not everything readable. A team left world-readable should be reachable by its link,
    not enumerable by everyone — and a pending invitation confers nothing, so it must not
    make a team appear here either. The join predicate gives that second part for free,
    since a null subject id never equals a character id.
    """
    granted = and_(
        TeamGrant.team_id == Team.id,
        TeamGrant.subject_kind == SubjectKind.CHARACTER,
        TeamGrant.subject_id == viewer.character_id,
    )
    stmt = (
        select(Team)
        .outerjoin(TeamGrant, granted)
        .where(
            or_(Team.owner_character_id == viewer.character_id, TeamGrant.id.is_not(None)),
            Team.archived_at.is_not(None) if archived else Team.archived_at.is_(None),
        )
        .options(selectinload(Team.grants))
        .order_by(Team.name)
    )
    teams = session.scalars(stmt).unique().all()
    return [_summary(team, resolve_level(team, team.grants, viewer)) for team in teams]


@router.post("", response_model=TeamSummary, status_code=201)
def create_team(
    body: TeamCreate,
    session: Session = Depends(get_session),
    viewer: Viewer = Depends(current_viewer),
) -> TeamSummary:
    team = Team(
        name=body.name,
        owner_character_id=viewer.character_id,
        # Spelled out rather than left to the column's server default: until the row is
        # flushed the attribute is None, and the resolver turns None into an error rather
        # than into a private team.
        base_level=AccessLevel.NONE,
    )
    session.add(team)
    session.commit()
    # The creator is owner by the column; no self-grant row, so nothing can revoke it.
    return _summary(team, AccessLevel.OWNER)


@router.get("/{team_id}", response_model=TeamSummary)
def team_detail(
    team_id: uuid.UUID,
    session: Session = Depends(get_session),
    viewer: Viewer = Depends(current_viewer),
) -> TeamSummary:
    access = authorize(session, team_id, viewer, AccessLevel.VIEWER)
    return _summary(access.team, access.level)


@router.patch("/{team_id}", response_model=TeamSummary)
def rename_team(
    team_id: uuid.UUID,
    body: TeamRename,
    session: Session = Depends(get_session),
    viewer: Viewer = Depends(current_viewer),
) -> TeamSummary:
    access = authorize(session, team_id, viewer, AccessLevel.OWNER)
    team = live(access)
    team.name = body.name
    session.commit()
    return _summary(team, access.level)


@router.post("/{team_id}/archive", response_model=TeamSummary)
def archive_team(
    team_id: uuid.UUID,
    session: Session = Depends(get_session),
    viewer: Viewer = Depends(current_viewer),
) -> TeamSummary:
    """Put a team away.

    There is no delete. A team's comps are its members' work and a season's record, and
    the ruleset versions they were built against are pinned against exactly this kind of
    tidying. Archiving is reversible; deleting would not be.
    """
    access = authorize(session, team_id, viewer, AccessLevel.OWNER)
    if access.team.archived_at is None:
        access.team.archived_at = datetime.now(tz=UTC)
        session.commit()
    return _summary(access.team, access.level)


@router.post("/{team_id}/restore", response_model=TeamSummary)
def restore_team(
    team_id: uuid.UUID,
    session: Session = Depends(get_session),
    viewer: Viewer = Depends(current_viewer),
) -> TeamSummary:
    access = authorize(session, team_id, viewer, AccessLevel.OWNER)
    if access.team.archived_at is not None:
        access.team.archived_at = None
        session.commit()
    return _summary(access.team, access.level)


@router.get("/{team_id}/grants", response_model=list[GrantDetail])
def list_grants(
    team_id: uuid.UUID,
    session: Session = Depends(get_session),
    viewer: Viewer = Depends(current_viewer),
) -> list[GrantDetail]:
    """Who is on the team. Readable by the team, editable only by its owner."""
    access = authorize(session, team_id, viewer, AccessLevel.VIEWER)
    return [_grant(grant) for grant in sorted(access.team.grants, key=lambda g: g.created_at)]


@router.post("/{team_id}/grants", response_model=GrantDetail, status_code=201)
def add_grant(
    team_id: uuid.UUID,
    body: GrantCreate,
    session: Session = Depends(get_session),
    viewer: Viewer = Depends(current_viewer),
    resolve: CharacterResolver = Depends(get_character_resolver),
) -> GrantDetail:
    """Invite a character by name.

    The lookup can fail in four ways and only one of them is a hit, but none of them stop
    the grant being created: the row exists either way, showing the name that was entered
    and granting nothing until an id is attached. Access must never hinge on whether a
    third-party service answered.
    """
    access = authorize(session, team_id, viewer, AccessLevel.OWNER)
    team = live(access)
    name = body.character_name

    found = resolve(name)
    if found.resolution is Resolution.RESOLVED and found.character_id == team.owner_character_id:
        raise HTTPException(status_code=409, detail=f"{name!r} already owns this team")

    _refuse_duplicate(session, team, name, found.character_id)
    grant = TeamGrant(
        team_id=team.id,
        subject_kind=SubjectKind.CHARACTER,
        subject_id=found.character_id,
        # The game's spelling when there is one; otherwise what was typed, so the owner
        # can recognize their own typo.
        subject_name=found.name or name,
        level=_GRANTABLE[body.level],
    )
    session.add(grant)
    session.commit()
    return _grant(grant, found.resolution)


@router.patch("/{team_id}/grants/{grant_id}", response_model=GrantDetail)
def change_grant(
    team_id: uuid.UUID,
    grant_id: uuid.UUID,
    body: GrantChange,
    session: Session = Depends(get_session),
    viewer: Viewer = Depends(current_viewer),
) -> GrantDetail:
    access = authorize(session, team_id, viewer, AccessLevel.OWNER)
    grant = _find_grant(session, live(access), grant_id)
    grant.level = _GRANTABLE[body.level]
    session.commit()
    return _grant(grant)


@router.delete("/{team_id}/grants/{grant_id}", status_code=204)
def remove_grant(
    team_id: uuid.UUID,
    grant_id: uuid.UUID,
    session: Session = Depends(get_session),
    viewer: Viewer = Depends(current_viewer),
) -> Response:
    access = authorize(session, team_id, viewer, AccessLevel.OWNER)
    session.delete(_find_grant(session, live(access), grant_id))
    session.commit()
    return Response(status_code=204)


@router.post("/{team_id}/grants/{grant_id}/resolve", response_model=GrantDetail)
def resolve_grant(
    team_id: uuid.UUID,
    grant_id: uuid.UUID,
    session: Session = Depends(get_session),
    viewer: Viewer = Depends(current_viewer),
    resolve: CharacterResolver = Depends(get_character_resolver),
) -> GrantDetail:
    """Try a pending invitation's name again.

    Idempotent: a grant that already carries an id is left exactly as it is rather than
    re-looked-up, so a stray retry cannot repoint an existing grant at a different
    character. Stale *names* on resolved grants are refreshed at sign-in instead, where
    the character has just proved both their id and their name.
    """
    access = authorize(session, team_id, viewer, AccessLevel.OWNER)
    grant = _find_grant(session, live(access), grant_id)
    if grant.subject_id is not None:
        return _grant(grant, Resolution.RESOLVED)

    found = resolve(grant.subject_name)
    if found.resolution is not Resolution.RESOLVED:
        return _grant(grant, found.resolution)
    if found.character_id == access.team.owner_character_id:
        raise HTTPException(
            status_code=409, detail=f"{grant.subject_name!r} already owns this team"
        )

    _refuse_duplicate(session, access.team, grant.subject_name, found.character_id, skip=grant.id)
    grant.subject_id = found.character_id
    grant.subject_name = found.name or grant.subject_name
    session.commit()
    return _grant(grant, Resolution.RESOLVED)


def _refuse_duplicate(
    session: Session,
    team: Team,
    name: str,
    character_id: int | None,
    skip: uuid.UUID | None = None,
) -> None:
    """One grant per character, and one pending invitation per name.

    The database enforces both, but only after the fact and only in its own words. This
    exists so the answer names the person instead of a constraint.
    """
    clash = (
        TeamGrant.subject_id == character_id
        if character_id is not None
        # Matched case-insensitively, which the partial unique index cannot do: an
        # expression index reflects back from Postgres with casts that make the drift
        # check permanently unhappy.
        else and_(
            TeamGrant.subject_id.is_(None), func.lower(TeamGrant.subject_name) == name.lower()
        )
    )
    stmt = select(TeamGrant).where(
        TeamGrant.team_id == team.id, TeamGrant.subject_kind == SubjectKind.CHARACTER, clash
    )
    if skip is not None:
        stmt = stmt.where(TeamGrant.id != skip)
    if session.scalar(stmt) is not None:
        raise HTTPException(status_code=409, detail=f"{name!r} already has access to this team")
