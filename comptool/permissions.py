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
    """The identity a request is acting as.

    Usually an EVE character, and named for one. On a deployment running password sign-in it
    is a local principal instead (``comptool/local_accounts.py``), and nothing in this module
    changes or needs to: resolution matches integers, and a local principal's id is simply a
    negative one. The fields keep their names rather than becoming ``principal_*`` because
    renaming them is a hundred edits across two wire contracts for no behavioural difference.

    Corporation and alliance grants are permanently inert under password sign-in, and there is
    no local equivalent to go looking for. A local principal belongs to no corporation, so
    ``_subject_id_for`` returns None for it, ``_matches`` refuses that below, and nothing
    creates such rows in either mode anyway.
    """

    character_id: int
    corporation_id: int | None = None
    alliance_id: int | None = None
    #: Display only, and absent wherever the caller had no reason to look it up.
    #: Resolution never reads it — names change, ids do not.
    character_name: str | None = None


def _subject_id_for(kind: str, viewer: Viewer) -> int | None:
    if kind == SubjectKind.CHARACTER:
        return viewer.character_id
    if kind == SubjectKind.CORPORATION:
        return viewer.corporation_id
    if kind == SubjectKind.ALLIANCE:
        return viewer.alliance_id
    return None


def _matches(grant: TeamGrant, viewer: Viewer) -> bool:
    # 0008 made subject_id NOT NULL, so this branch is unreachable through the schema.
    # Kept anyway, because of what is on the other side of it: ``_subject_id_for`` returns
    # None for a viewer with no corporation or alliance, and ``None == None`` is True. A
    # null grant would therefore match every character who belongs to nothing — not fail
    # closed, but hand access to strangers. That is a bad enough failure that the check
    # earns its place as a second lock rather than as live logic, and if the column is ever
    # made nullable again this is what stands between that change and an incident.
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
