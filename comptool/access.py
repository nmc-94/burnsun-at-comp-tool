"""Reaching a team or a comp from a request, and refusing to when the caller may not.

``permissions.py`` decides what a level *is*, given a team and its grants; this is the
layer above it that goes to the database, applies the decision, and turns a refusal into
an HTTP answer. The two are kept apart so the resolver stays pure and testable without a
session.

Everything that owns a team — teams, and comps one level down — goes through
:func:`authorize`. That is deliberate: existence and permission are answered together and
reported identically, because answering them separately is precisely what turns a 404 into
"wrong id" and a 403 into "right id, keep trying". A second implementation of this rule is
a second chance to leak which teams exist.

:func:`reach_comp` is the same rule one level down, and it lives here for the same reason
``authorize`` does: two modules now reach comps — the comp routes and the comment thread —
and a copy of the gate in each is a copy that can drift. Reaching a comp anywhere in this
application goes through the one function below.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from .models import AccessLevel, Comp, Team
from .permissions import Viewer, resolve_level


@dataclass(frozen=True, slots=True)
class Access:
    """A team the caller has been cleared to reach, and what they hold on it."""

    team: Team
    level: AccessLevel


def team_not_found(team_id: uuid.UUID) -> HTTPException:
    # One answer for "no such team" and for "not yours", identical down to the message.
    # Anything that distinguishes them turns this route into a way to discover which
    # team ids are real.
    return HTTPException(status_code=404, detail=f"No team {str(team_id)!r}")


def authorize(
    session: Session, team_id: uuid.UUID, viewer: Viewer, required: AccessLevel
) -> Access:
    """The only way a route reaches a team.

    Grants are eager-loaded because the resolver takes them explicitly and the grant
    routes need them anyway, so the whole decision costs two queries.
    """
    team = session.scalar(
        select(Team).where(Team.id == team_id).options(selectinload(Team.grants))
    )
    if team is None:
        raise team_not_found(team_id)
    level = resolve_level(team, team.grants, viewer)
    if level < required:
        raise team_not_found(team_id)
    return Access(team=team, level=level)


def live(access: Access) -> Team:
    """Refuse to write to an archived team.

    A conflict rather than the 404 the permission rule uses: archiving is not a loss of
    permission, the team is plainly visible, and the way out — restore it — is something
    the caller can actually do.
    """
    if access.team.archived_at is not None:
        raise HTTPException(status_code=409, detail=f"Team {access.team.name!r} is archived")
    return access.team


def comp_not_found(comp_id: uuid.UUID) -> HTTPException:
    # The same answer for "no such comp", "its team is not yours", and "that id belongs to
    # another team". Distinguishing any of them would turn a comp id into a probe for which
    # teams exist.
    return HTTPException(status_code=404, detail=f"No comp {str(comp_id)!r}")


def reach_comp(
    session: Session, comp_id: uuid.UUID, viewer: Viewer, required: AccessLevel
) -> tuple[Comp, Access]:
    """The only way a route reaches a comp.

    The comp is loaded first because its team is what decides, then the team gate runs. Its
    refusal is swallowed and re-raised comp-shaped: letting ``authorize``'s "No team <id>"
    escape from a comp route would confirm the team is real.

    Slots, tags and the pinned version are eager-loaded because the comp response carries all
    three, and a caller that wants none of them — the comment routes — pays three small
    queries rather than getting a second, subtly different way in.
    """
    comp = session.scalar(
        select(Comp)
        .where(Comp.id == comp_id)
        .options(
            selectinload(Comp.slots),
            selectinload(Comp.tags),
            selectinload(Comp.ruleset_version),
        )
    )
    if comp is None:
        raise comp_not_found(comp_id)
    try:
        access = authorize(session, comp.team_id, viewer, required)
    except HTTPException:
        raise comp_not_found(comp_id) from None
    return comp, access
