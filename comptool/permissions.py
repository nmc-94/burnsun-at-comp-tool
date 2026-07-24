"""Resolving what a signed-in identity may do with a team.

Access can arrive by several routes at once — a character grant, a corporation grant, an
alliance grant, the team's base level — so resolution takes the most generous match. The
owner short-circuits all of it: ownership is not a grant and cannot be revoked by one.

Pure and session-free: callers load the team and its grants, this decides.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass

from .models import AccessLevel, SubjectKind, Team, TeamGrant


@dataclass(frozen=True)
class Viewer:
    """The in-game identity a request is acting as."""

    character_id: int
    corporation_id: int | None = None
    alliance_id: int | None = None


def _subject_id_for(kind: str, viewer: Viewer) -> int | None:
    if kind == SubjectKind.CHARACTER:
        return viewer.character_id
    if kind == SubjectKind.CORPORATION:
        return viewer.corporation_id
    if kind == SubjectKind.ALLIANCE:
        return viewer.alliance_id
    return None


def _matches(grant: TeamGrant, viewer: Viewer) -> bool:
    # A grant whose name has not been resolved to an id yet matches nobody; it is a
    # pending invitation, not access.
    if grant.subject_id is None:
        return False
    return grant.subject_id == _subject_id_for(grant.subject_kind, viewer)


def resolve_level(team: Team, grants: Iterable[TeamGrant], viewer: Viewer) -> AccessLevel:
    """The highest level ``viewer`` holds on ``team``.

    ``grants`` is passed in rather than read off ``team`` so the caller stays in control
    of what was loaded from the database.
    """
    if team.owner_character_id == viewer.character_id:
        return AccessLevel.OWNER

    level = AccessLevel(team.base_level)
    for grant in grants:
        if _matches(grant, viewer):
            level = max(level, AccessLevel(grant.level))
    return level
