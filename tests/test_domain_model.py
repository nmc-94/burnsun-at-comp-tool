"""Round-trips over the domain model.

These exercise the invariants the schema is responsible for — ordering, cascades, and the
uniqueness rules — rather than the ORM itself. Legality is deliberately not tested here:
it is the client engine's job and is never stored.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from comptool.models import (
    AccessLevel,
    Comp,
    CompComment,
    CompSlot,
    Ruleset,
    RulesetVersion,
    SubjectKind,
    Team,
    TeamGrant,
)

# A cut-down stand-in for an ingested ruleset. The keys are camelCase because this payload
# is served verbatim to the client legality engine, which is its only reader.
PAYLOAD = {
    "version": "v2026-07-23",
    "pointCap": 200,
    "fieldSize": 10,
    "ships": {
        "11978": {
            "typeId": 11978,
            "name": "Scimitar",
            "points": 32,
            "shipClass": "Logistics Cruiser",
            "hullSize": "Cruiser",
            "inflationValue": 2,
            "logisticsGroup": "cruiser",
            "banned": False,
            "flagshipEligible": False,
        }
    },
    "classPoints": {"Logistics Cruiser": 32},
}


def make_ruleset_version(session) -> RulesetVersion:
    ruleset = Ruleset(slug="atxxii", name="Alliance Tournament XXII", organizer="Fenris Creations")
    version = RulesetVersion(
        ruleset=ruleset,
        version_label="v2026-07-23",
        source_url="https://example.invalid/points.csv",
        fetched_at=datetime(2026, 7, 23, tzinfo=UTC),
        payload=PAYLOAD,
    )
    session.add(version)
    session.flush()
    return version


def make_team(session) -> Team:
    team = Team(name="Aurora Vanguard", owner_character_id=90_000_001)
    session.add(team)
    session.flush()
    return team


def test_round_trips_a_team_comp_and_slots(session):
    version = make_ruleset_version(session)
    team = make_team(session)

    comp = Comp(
        team=team,
        ruleset_version=version,
        name="Angel Shield Kite",
        created_by_character_id=90_000_002,
        created_by_name="Vex",
    )
    # Added out of order on purpose: position, not insertion order, defines the lineup.
    comp.slots = [
        CompSlot(position=2, type_id=11978),
        CompSlot(position=0, type_id=17740, is_flagship=True),
        CompSlot(position=1, type_id=644),
    ]
    session.add(comp)
    session.commit()
    session.expire_all()

    stored = session.execute(select(Comp).where(Comp.id == comp.id)).scalar_one()

    assert stored.name == "Angel Shield Kite"
    assert stored.created_by_name == "Vex"
    assert stored.team.name == "Aurora Vanguard"
    assert stored.ruleset_version.version_label == "v2026-07-23"
    assert stored.ruleset_version.payload["ships"]["11978"]["inflationValue"] == 2
    assert stored.ruleset_version.ruleset.slug == "atxxii"

    assert [slot.position for slot in stored.slots] == [0, 1, 2]
    assert [slot.type_id for slot in stored.slots] == [17740, 644, 11978]
    assert [slot.is_flagship for slot in stored.slots] == [True, False, False]
    assert stored.created_at is not None


def test_deleting_a_comp_takes_its_slots_and_comments_with_it(session):
    version = make_ruleset_version(session)
    team = make_team(session)
    comp = Comp(team=team, ruleset_version=version, name="Scratch")
    comp.slots = [CompSlot(position=0, type_id=587)]
    comp.comments = [CompComment(author_name="Sorren", body="Try a Svipul here.")]
    session.add(comp)
    session.commit()

    session.delete(comp)
    session.commit()

    assert session.execute(select(CompSlot)).all() == []
    assert session.execute(select(CompComment)).all() == []


def test_slot_positions_are_unique_within_a_comp(session):
    version = make_ruleset_version(session)
    team = make_team(session)
    comp = Comp(team=team, ruleset_version=version, name="Scratch")
    comp.slots = [CompSlot(position=0, type_id=587), CompSlot(position=0, type_id=585)]
    session.add(comp)

    with pytest.raises(IntegrityError):
        session.commit()
    session.rollback()


def test_a_comp_admits_only_one_flagship(session):
    version = make_ruleset_version(session)
    team = make_team(session)
    comp = Comp(team=team, ruleset_version=version, name="Two flagships")
    comp.slots = [
        CompSlot(position=0, type_id=17740, is_flagship=True),
        CompSlot(position=1, type_id=644, is_flagship=True),
    ]
    session.add(comp)

    with pytest.raises(IntegrityError):
        session.commit()
    session.rollback()


def test_the_same_flagship_position_is_free_in_another_comp(session):
    version = make_ruleset_version(session)
    team = make_team(session)
    for name in ("First", "Second"):
        comp = Comp(team=team, ruleset_version=version, name=name)
        comp.slots = [CompSlot(position=0, type_id=17740, is_flagship=True)]
        session.add(comp)
    session.commit()

    flagships = session.execute(select(CompSlot).where(CompSlot.is_flagship)).scalars().all()
    assert len(flagships) == 2


def test_a_ruleset_version_a_comp_was_built_against_cannot_be_deleted(session):
    version = make_ruleset_version(session)
    team = make_team(session)
    session.add(Comp(team=team, ruleset_version=version, name="Angel Shield Kite"))
    session.commit()

    session.delete(version)
    with pytest.raises(IntegrityError):
        session.commit()
    session.rollback()


def test_a_ruleset_labels_each_version_once(session):
    ruleset = Ruleset(slug="atxxii", name="Alliance Tournament XXII", organizer="Fenris Creations")
    for _ in range(2):
        session.add(
            RulesetVersion(
                ruleset=ruleset,
                version_label="v2026-07-23",
                source_url="https://example.invalid/points.csv",
                fetched_at=datetime(2026, 7, 23, tzinfo=UTC),
                payload=PAYLOAD,
            )
        )

    with pytest.raises(IntegrityError):
        session.commit()
    session.rollback()


def test_grants_round_trip_and_default_to_a_private_team(session):
    team = make_team(session)
    session.add(
        TeamGrant(
            team=team,
            subject_kind=SubjectKind.CHARACTER,
            subject_id=90_000_003,
            subject_name="Kadir",
            level=AccessLevel.EDITOR,
        )
    )
    # A grant by name that has not been resolved to an id yet.
    session.add(
        TeamGrant(
            team=team,
            subject_kind=SubjectKind.ALLIANCE,
            subject_id=None,
            subject_name="Aurora Coalition",
            level=AccessLevel.VIEWER,
        )
    )
    session.commit()
    session.expire_all()

    stored = session.execute(select(Team).where(Team.id == team.id)).scalar_one()

    assert stored.base_level == AccessLevel.NONE
    assert stored.archived_at is None
    by_name = {grant.subject_name: grant for grant in stored.grants}
    assert by_name["Kadir"].subject_kind == SubjectKind.CHARACTER
    assert by_name["Kadir"].level == AccessLevel.EDITOR
    assert by_name["Aurora Coalition"].subject_id is None


def pending_grant(team: Team, name: str = "Kadir") -> TeamGrant:
    return TeamGrant(
        team=team,
        subject_kind=SubjectKind.CHARACTER,
        subject_id=None,
        subject_name=name,
        level=AccessLevel.VIEWER,
    )


def test_a_team_holds_one_pending_invitation_per_name(session):
    # The full unique constraint cannot catch this: Postgres counts null subject ids as
    # distinct, so without the partial index the same name invites without limit.
    team = make_team(session)
    session.add(pending_grant(team))
    session.add(pending_grant(team))

    with pytest.raises(IntegrityError):
        session.commit()
    session.rollback()


def test_the_same_pending_name_is_free_on_another_team(session):
    first = make_team(session)
    second = Team(name="Nightfall Syndicate", owner_character_id=90_000_009)
    session.add(second)
    session.flush()
    session.add(pending_grant(first))
    session.add(pending_grant(second))
    session.commit()

    assert len(session.execute(select(TeamGrant)).scalars().all()) == 2


def test_resolving_an_invitation_frees_the_name_to_be_invited_again(session):
    # The index covers unresolved rows only, so a resolved grant and a later pending one
    # for the same name coexist — which is what re-inviting after a rename looks like.
    team = make_team(session)
    session.add(
        TeamGrant(
            team=team,
            subject_kind=SubjectKind.CHARACTER,
            subject_id=90_000_003,
            subject_name="Kadir",
            level=AccessLevel.VIEWER,
        )
    )
    session.add(pending_grant(team))
    session.commit()

    assert len(session.execute(select(TeamGrant)).scalars().all()) == 2
