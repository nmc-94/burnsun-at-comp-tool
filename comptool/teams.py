"""Teams, and who may see them.

Three rules shape every route here.

**Teams are private.** A new team is visible to its owner and to nobody else, and the
listing is "teams that are mine" — owned, or granted to me — rather than a directory of
everything readable. ``Team.base_level`` still exists and the resolver still honours it,
but nothing here sets it, and Phase I settled why rather than deferring it again: sharing a
*comp* is a different feature. ``base_level`` is only reached through ``authorize``, which
401s an anonymous caller before it is consulted — so raising it would open a team to every
signed-in character, not to the public. That is "public within the tool", a product decision
nobody has asked for. A share link answers the question people actually had, and it does so
without this switch; see ``comptool/share.py``.

That last argument is weaker under password sign-in than it reads, and the difference is worth
knowing before anybody quotes it: there, "every signed-in character" means "everyone the
operator handed the password to", which is a small and already-trusted set rather than the
whole game. Nothing sets ``base_level`` in either mode, so no code depends on which reading is
right — but the sentence above was written about one of the two.

**A team you may not see does not exist.** Existence and permission are answered together
and reported identically, because answering them separately is precisely what turns a 404
into "wrong team id" and a 403 into "right team id, keep trying".

**Grants are written by name and matched by id, and a name that does not resolve is
refused.** This used to go the other way: an unresolved name was stored as a "pending
invitation", on the argument that adding someone must never fail because a third-party
service was slow. The argument was wrong in its premise. Such a row grants nobody
anything and can never begin to — it is not a lenient fallback, it is a false receipt,
and the operator who reads "pending" has been told their teammate is on the way when in
fact nothing is on the way and nothing ever will be. The availability worry it was built
for is answered without it: the name is still in the box, so trying again is pressing Add
again. So a grant is either a resolved grant or a 400 with a sentence saying why.

Under password sign-in that rule has a different consequence, and it is the one thing about
that mode a captain has to learn. The register of who exists is this instance rather than EVE,
so a name resolves only once its owner has signed in and claimed it — **you cannot add somebody
who has never opened the tool**. The order of operations inverts: send them the password, they
claim a name, they tell you the name, you add them. ``_refusal`` says exactly that in place of
the EVE wording, and ``web/src/teams/FirstTeam.tsx`` already tells the other half of the
handshake which name to pass on.
"""

from __future__ import annotations

import secrets
import uuid
from datetime import UTC, datetime
from enum import StrEnum
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, StringConstraints
from pydantic.alias_generators import to_camel
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session, selectinload

from . import join
from .access import authorize, live
from .auth import crypto
from .auth.dependencies import current_viewer
from .db import get_session
from .esi import CharacterResolver, Resolution, get_character_resolver
from .models import AccessLevel, SubjectKind, Team, TeamGrant
from .permissions import Viewer, resolve_level
from .settings import Settings, SignInMode, get_settings

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
    #: The owner's name, or null for a team created before the column existed. Null means
    #: "not known yet", never "no owner" — ``owner_character_id`` is not nullable. It fills
    #: itself the next time that character signs in.
    owner_character_name: str | None
    #: What the requesting character holds. The SPA gates its controls on this rather
    #: than guessing from ownership.
    your_level: str
    archived: bool
    created_at: datetime
    updated_at: datetime


class TeamCreate(_Request):
    name: Name
    #: Required under local accounts, ignored under EVE SSO. Signing in is open in that mode,
    #: so without this anybody who reached the site could fill it with teams. Not a guard on
    #: any team's *data* — that is the join password, which lives on the team and is hashed.
    creation_key: str = ""
    #: The team's join password, set at the moment the team is. Required under local accounts,
    #: because a team with no way in is a team its owner has to go and configure before it is
    #: useful, and the one thing they certainly know at this moment is who they mean to invite.
    #: Clearable afterwards from settings — see ``join.clear_join_password``.
    password: str = ""
    #: What that password grants: ``viewer`` or ``editor``.
    password_level: str = "viewer"


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
    #: Never null. ``add_grant`` refuses a name it could not resolve and 0008 made the
    #: column NOT NULL, so every grant that exists names a character the game knows.
    subject_id: int
    #: The game's spelling, not what was typed.
    subject_name: str
    level: str
    created_at: datetime


def _summary(team: Team, level: AccessLevel) -> TeamSummary:
    return TeamSummary(
        id=team.id,
        name=team.name,
        owner_character_id=team.owner_character_id,
        owner_character_name=team.owner_character_name,
        your_level=_LEVEL_NAMES[level],
        archived=team.archived_at is not None,
        created_at=team.created_at,
        updated_at=team.updated_at,
    )


def _grant(grant: TeamGrant) -> GrantDetail:
    return GrantDetail(
        id=grant.id,
        subject_kind=grant.subject_kind,
        subject_id=grant.subject_id,
        subject_name=grant.subject_name,
        level=_LEVEL_NAMES[AccessLevel(grant.level)],
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
    """The teams that are mine: owned, or granted to me.

    Not everything readable. A team left world-readable should be reachable by its link,
    not enumerable by everyone.
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
    settings: Settings = Depends(get_settings),
) -> TeamSummary:
    """Make a team, and — under local accounts — the way into it.

    Two extra things are asked for in that mode, and they guard different things. The creation
    key says this caller may make a team at all, because signing in is open there and the
    alternative is a stranger filling the instance. The password says who may *join* this one,
    and is the credential this whole mode is built around.

    Under EVE SSO neither is asked for: sign-in is already a gate, and access is granted by
    character name rather than by a shared secret.
    """
    local = settings.sign_in_mode is SignInMode.LOCAL
    if local:
        _require_creation_key(body.creation_key, settings)
        if len(body.password) < join.TEAM_PASSWORD_MIN_LENGTH:
            raise HTTPException(
                status_code=422,
                detail=f"Give the team a join password of at least "
                f"{join.TEAM_PASSWORD_MIN_LENGTH} characters, or a few words.",
            )
        if body.password_level not in ("viewer", "editor"):
            raise HTTPException(status_code=422, detail="Access must be viewer or editor.")

    team = Team(
        name=body.name,
        owner_character_id=viewer.character_id,
        # Captured here for the same reason ``Comp.created_by_name`` is: ownership is an id,
        # and an id is not something to show anyone. Kept current on later sign-ins by
        # ``auth.routes.refresh_character_names``.
        owner_character_name=viewer.character_name,
        # Spelled out rather than left to the column's server default: until the row is
        # flushed the attribute is None, and the resolver turns None into an error rather
        # than into a private team.
        base_level=AccessLevel.NONE,
        # Minted in both modes, because the column is NOT NULL and a team is entitled to a
        # name for its door whether or not this deployment uses one. Under SSO the password
        # beside it stays null, which is what makes the link inert.
        join_slug=join.mint_join_slug(session),
        access_password_hash=crypto.hash_password(body.password) if local else None,
        access_password_level=(
            AccessLevel.EDITOR if body.password_level == "editor" else AccessLevel.VIEWER
        ),
    )
    session.add(team)
    session.commit()
    # The creator is owner by the column; no self-grant row, so nothing can revoke it.
    return _summary(team, AccessLevel.OWNER)


def _require_creation_key(offered: str, settings: Settings) -> None:
    """403, and not the 404 this module uses for a team you may not see.

    Different question, different answer. That 404 hides *whether a team exists*, which is a
    secret worth keeping. This hides nothing — the field is on the form, the README explains
    it, and ``/api/health`` says the deployment is in a mode that has one. Answering 404 would
    only send somebody hunting a routing bug.
    """
    # Constant time, over bytes: compare_digest raises TypeError on a non-ASCII str, and a key
    # with an accent in it must refuse the caller rather than crash the server.
    if not secrets.compare_digest(
        offered.encode("utf-8"), settings.team_creation_key.encode("utf-8")
    ):
        raise HTTPException(
            status_code=403,
            detail="That is not the team creation key for this instance.",
        )


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
    settings: Settings = Depends(get_settings),
) -> GrantDetail:
    """Add a character by name, or refuse and say why.

    The lookup has four outcomes and only one of them creates a row. The other three are
    reported to the operator in a sentence, because each is something they can act on and
    none of them is something the application can carry forward: a name EVE does not know
    will not start working later, and a name that matched several characters has to be
    disambiguated by the person who knows which one they meant.

    The detail is a plain string rather than FastAPI's 422 array, deliberately. The SPA's
    ``messageFor`` shows a string detail as the message; anything else surfaces as the raw
    status line, which is the failure ``FirstTeam.tsx`` still carries a comment about.
    """
    if settings.sign_in_mode is SignInMode.LOCAL:
        # There is no register of people to look a name up in here. Under EVE SSO a name is
        # something the game vouches for and can be resolved before its owner has ever opened
        # this tool; under local accounts a name exists only once somebody has claimed it, so
        # adding by name could only ever reach people who are already here — and the join link
        # reaches them without the captain typing anything. 409 rather than 404: the route is
        # real and the caller may well be the owner; what is wrong is the request.
        raise HTTPException(
            status_code=409,
            detail="This instance adds people by join link. Send them the team's link and "
            "password from team settings.",
        )

    access = authorize(session, team_id, viewer, AccessLevel.OWNER)
    team = live(access)
    name = body.character_name

    found = resolve(name)
    if found.resolution is not Resolution.RESOLVED or found.character_id is None:
        raise _refusal(name, found.resolution)
    if found.character_id == team.owner_character_id:
        raise HTTPException(status_code=409, detail=f"{name!r} already owns this team")

    _refuse_duplicate(session, team, name, found.character_id)
    grant = TeamGrant(
        team_id=team.id,
        subject_kind=SubjectKind.CHARACTER,
        subject_id=found.character_id,
        # The game's spelling, not what was typed. Case and spacing come back from EVE
        # canonical, so "john liwang" is stored as "John LiWang".
        subject_name=found.name or name,
        level=_GRANTABLE[body.level],
    )
    session.add(grant)
    session.commit()
    return _grant(grant)


def _refusal(name: str, resolution: Resolution) -> HTTPException:
    """Why a name was not added, in words the person who typed it can use.

    503 for ``UNAVAILABLE`` and 400 for the rest, because the two ask for different things:
    one says try again, the other says the request itself was wrong. The SPA leaves the name
    in the box either way, so "try again" means pressing Add again — which is why losing the
    old pending row costs nothing.

    EVE-worded throughout, and now unconditionally so: the caller above refuses local accounts
    before any lookup happens, so this is only ever reached on a deployment where EVE really
    is the register of who exists.
    """
    if resolution is Resolution.UNAVAILABLE:
        return HTTPException(
            status_code=503,
            detail="Cannot reach EVE right now, so the name could not be checked. Try again "
            "in a moment.",
        )
    if resolution is Resolution.AMBIGUOUS:
        return HTTPException(
            status_code=400,
            detail=f"More than one character matched {name!r}. Type the full name exactly as "
            f"it appears in game.",
        )
    return HTTPException(status_code=400, detail=f"EVE has no character called {name!r}.")


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


def _refuse_duplicate(session: Session, team: Team, name: str, character_id: int) -> None:
    """One grant per character.

    Matched on the id, never the name, which is now the only honest test: two spellings of
    the same character resolve to one id, and a rename makes the stored name disagree with
    the typed one while the id keeps agreeing. The database enforces this too, but only
    after the fact and only in its own words — this exists so the answer names the person
    instead of a constraint.
    """
    clash = select(TeamGrant).where(
        TeamGrant.team_id == team.id,
        TeamGrant.subject_kind == SubjectKind.CHARACTER,
        TeamGrant.subject_id == character_id,
    )
    if session.scalar(clash) is not None:
        raise HTTPException(status_code=409, detail=f"{name!r} already has access to this team")
