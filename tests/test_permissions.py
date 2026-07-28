"""The access ladder.

Pure resolution over in-memory objects — no database needed.
"""

from __future__ import annotations

from comptool.models import AccessLevel, SubjectKind, Team, TeamGrant
from comptool.permissions import Viewer, resolve_level

OWNER = Viewer(character_id=1, corporation_id=10, alliance_id=100)
MEMBER = Viewer(character_id=2, corporation_id=10, alliance_id=100)
OUTSIDER = Viewer(character_id=3, corporation_id=30, alliance_id=300)


def make_team(base_level: int = AccessLevel.NONE) -> Team:
    return Team(
        name="Aurora Vanguard",
        owner_character_id=OWNER.character_id,
        base_level=base_level,
    )


def grant(kind: SubjectKind, subject_id: int | None, level: AccessLevel) -> TeamGrant:
    return TeamGrant(
        subject_kind=kind, subject_id=subject_id, subject_name="whoever", level=level
    )


#: A password-mode identity. Negative, because that is the half of the id column EVE never
#: fills — see ``LocalAccount``. No corporation and no alliance, which a local principal never
#: has and never will.
LOCAL = Viewer(character_id=-1)
LOCAL_OTHER = Viewer(character_id=-2)


def test_the_owner_needs_no_grant():
    assert resolve_level(make_team(), [], OWNER) is AccessLevel.OWNER


def test_a_negative_principal_resolves_exactly_like_a_character():
    """The claim the whole password-sign-in design rests on, at the layer that decides.

    Resolution matches integers and has no opinion about where they came from, so a local
    principal owning a team, holding a grant, and being refused one all behave identically to
    an EVE character doing the same. If this ever stops being true, everything above it is
    quietly wrong.
    """
    owned = Team(name="Sun Reavers", owner_character_id=LOCAL.character_id, base_level=0)
    assert resolve_level(owned, [], LOCAL) is AccessLevel.OWNER
    assert resolve_level(owned, [], LOCAL_OTHER) is AccessLevel.NONE

    granted = [grant(SubjectKind.CHARACTER, LOCAL_OTHER.character_id, AccessLevel.EDITOR)]
    assert resolve_level(owned, granted, LOCAL_OTHER) is AccessLevel.EDITOR
    # And a positive id must not be let in by a grant naming a negative one, or the two
    # populations would leak into each other through arithmetic nobody meant.
    assert resolve_level(owned, granted, OUTSIDER) is AccessLevel.NONE


def test_a_corporation_grant_never_matches_a_local_principal():
    # Not a gap to be filled later: a local principal belongs to no corporation, so this stays
    # inert, and `_subject_id_for` returning None is what keeps it from matching everyone.
    grants = [grant(SubjectKind.CORPORATION, 10, AccessLevel.EDITOR)]

    assert resolve_level(make_team(), grants, LOCAL) is AccessLevel.NONE


def test_a_grant_cannot_demote_the_owner():
    grants = [grant(SubjectKind.CHARACTER, OWNER.character_id, AccessLevel.VIEWER)]

    assert resolve_level(make_team(), grants, OWNER) is AccessLevel.OWNER


def test_a_team_is_private_without_a_matching_grant():
    grants = [grant(SubjectKind.CHARACTER, MEMBER.character_id, AccessLevel.EDITOR)]

    assert resolve_level(make_team(), grants, OUTSIDER) is AccessLevel.NONE


def test_the_most_generous_matching_grant_wins():
    grants = [
        grant(SubjectKind.ALLIANCE, MEMBER.alliance_id, AccessLevel.VIEWER),
        grant(SubjectKind.CORPORATION, MEMBER.corporation_id, AccessLevel.EDITOR),
    ]

    assert resolve_level(make_team(), grants, MEMBER) is AccessLevel.EDITOR


def test_grant_order_does_not_matter():
    grants = [
        grant(SubjectKind.CORPORATION, MEMBER.corporation_id, AccessLevel.EDITOR),
        grant(SubjectKind.ALLIANCE, MEMBER.alliance_id, AccessLevel.VIEWER),
    ]

    assert resolve_level(make_team(), grants, MEMBER) is AccessLevel.EDITOR


def test_the_base_level_applies_to_everyone():
    team = make_team(base_level=AccessLevel.VIEWER)

    assert resolve_level(team, [], OUTSIDER) is AccessLevel.VIEWER


def test_a_grant_raises_but_never_lowers_the_base_level():
    team = make_team(base_level=AccessLevel.EDITOR)
    grants = [grant(SubjectKind.CHARACTER, MEMBER.character_id, AccessLevel.VIEWER)]

    assert resolve_level(team, grants, MEMBER) is AccessLevel.EDITOR


def test_an_unresolved_grant_gives_nobody_access():
    # A name granted access but not yet resolved to an id must not match on the null.
    grants = [grant(SubjectKind.CHARACTER, None, AccessLevel.OWNER)]
    nameless = Viewer(character_id=4)

    assert resolve_level(make_team(), grants, nameless) is AccessLevel.NONE


def test_a_viewer_without_a_corporation_matches_no_corporation_grant():
    grants = [grant(SubjectKind.CORPORATION, 10, AccessLevel.EDITOR)]
    unaffiliated = Viewer(character_id=5)

    assert resolve_level(make_team(), grants, unaffiliated) is AccessLevel.NONE
