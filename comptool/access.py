"""Reaching a team from a request, and refusing to when the caller may not.

``permissions.py`` decides what a level *is*, given a team and its grants; this is the
layer above it that goes to the database, applies the decision, and turns a refusal into
an HTTP answer. The two are kept apart so the resolver stays pure and testable without a
session.

Everything that owns a team — teams, and comps one level down — goes through
:func:`authorize`. That is deliberate: existence and permission are answered together and
reported identically, because answering them separately is precisely what turns a 404 into
"wrong id" and a 403 into "right id, keep trying". A second implementation of this rule is
a second chance to leak which teams exist.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from .models import AccessLevel, Team
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
