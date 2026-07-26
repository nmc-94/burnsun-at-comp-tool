"""Resolving a character name with no EVE at all.

The sibling of ``test_auth_dev.py``, and it pins the same two things: that the back door
does what it claims, and that it is not open anywhere it should not be. What is different
here is that the substitution has to be *invisible* — a grant made through this path must be
an ordinary grant, or an end-to-end run proves something the application does not do.

No ``resolver`` fixture anywhere in this file. That fixture replaces the very dependency
under test, so using it would assert on the fake instead of on the branch.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from comptool.dev_resolve import resolve_from_sessions
from comptool.esi import Resolution
from comptool.models import AuthSession, TeamGrant
from comptool.settings import Settings

OWNER = 90_000_001
GUEST = 90_000_003
STRANGER = 90_000_002


@pytest.fixture()
def dev_resolve(configure):
    """Name resolution answered from this database, with no EVE application configured.

    ``esi_enabled=False`` for the reason ``test_auth_dev.py`` gives: it is what CI runs, and
    it is the combination in which a lookup would otherwise refuse everything.
    """
    return configure(dev_resolve_enabled=True, environment="local", esi_enabled=False)


def make_team(client, name: str = "Aurora Vanguard") -> dict:
    return client.post("/api/v1/teams", json={"name": name}).json()


def add_grant(client, team: dict, name: str, level: str = "viewer"):
    return client.post(
        f"/api/v1/teams/{team['id']}/grants", json={"characterName": name, "level": level}
    )


def test_a_character_who_has_signed_in_can_be_granted_by_name(client, sign_in, dev_resolve):
    """The test the suite could not write before.

    Not "the resolver returns an id" — the whole loop: one character signs in, another
    grants them by name, and the first one can then open the team. Every step goes through
    the routes a browser uses.
    """
    sign_in(GUEST, "Kadir")
    sign_in(OWNER, "Renn")
    team = make_team(client)

    added = add_grant(client, team, "Kadir", "editor")

    assert added.status_code == 201
    assert added.json()["subjectId"] == GUEST
    sign_in(GUEST, "Kadir")
    assert client.get(f"/api/v1/teams/{team['id']}").json()["yourLevel"] == "editor"


def test_a_name_nobody_has_signed_in_with_is_refused(client, sign_in, dev_resolve):
    # The refusal path is real rather than mocked: an offline run exercises the same 400
    # the SPA has to render, which is the point of resolving from data instead of a hash.
    sign_in(OWNER, "Renn")
    team = make_team(client)

    response = add_grant(client, team, "Kadrri")

    assert response.status_code == 400
    assert client.get(f"/api/v1/teams/{team['id']}/grants").json() == []


def test_the_stored_spelling_wins_over_what_was_typed(client, sign_in, dev_resolve):
    # ESI returns its own capitalization, so this has to as well — otherwise a test passes
    # here and the canonicalization it was standing in for is untested.
    sign_in(GUEST, "Kadir")
    sign_in(OWNER, "Renn")

    grant = add_grant(client, make_team(client), "kadir").json()

    assert grant["subjectName"] == "Kadir"


def test_it_is_off_unless_it_is_switched_on(client, sign_in):
    # No ``dev_resolve`` fixture: this is the default configuration, where lookups go to
    # ESI, which is disabled in the test environment and so refuses everything.
    sign_in(GUEST, "Kadir")
    sign_in(OWNER, "Renn")

    assert add_grant(client, make_team(client), "Kadir").status_code == 503


def test_it_is_refused_outside_a_development_environment(client, sign_in, configure):
    """The per-request half of the guard.

    ``Settings.model_copy`` does not re-run validators, so a configuration a deployment
    could never boot with is exactly what the test suite is able to construct — which makes
    this the only form of the promise a test can actually check.
    """
    configure(dev_resolve_enabled=True, environment="production", esi_enabled=False)
    sign_in(GUEST, "Kadir")
    sign_in(OWNER, "Renn")

    # 503, not 201: the branch was not taken, so this fell through to a disabled ESI.
    assert add_grant(client, make_team(client), "Kadir").status_code == 503


def test_settings_refuse_to_boot_outside_a_development_environment():
    with pytest.raises(ValueError, match="COMPTOOL_DEV_RESOLVE_ENABLED"):
        Settings(dev_resolve_enabled=True, environment="production")


def test_health_reports_whether_the_door_is_open(client, dev_resolve):
    # An operator should be able to ask a running instance where its character lookups come
    # from without shell access on the box.
    assert client.get("/api/health").json()["dev_resolve"] is True


def test_health_reports_it_closed_by_default(client):
    assert client.get("/api/health").json()["dev_resolve"] is False


def test_one_character_with_several_sessions_is_not_ambiguous(session, sign_in, client):
    # Four browsers is one person. Counting rows rather than ids would call them ambiguous
    # and refuse a name that is perfectly clear.
    sign_in(GUEST, "Kadir")
    sign_in(GUEST, "Kadir")

    found = resolve_from_sessions("Kadir", session)

    assert found.resolution is Resolution.RESOLVED
    assert found.character_id == GUEST


def test_two_characters_sharing_a_name_are_ambiguous(session, sign_in, client):
    # Impossible in EVE, reachable through dev-login, which takes the id and the name from
    # whoever calls it. Guessing between them would grant access to the wrong person.
    sign_in(GUEST, "Kadir")
    sign_in(STRANGER, "Kadir")

    assert resolve_from_sessions("Kadir", session).resolution is Resolution.AMBIGUOUS


def test_the_most_recent_spelling_is_the_one_reported(session, sign_in, client):
    sign_in(GUEST, "Kadir")

    assert resolve_from_sessions("  kadir  ", session).name == "Kadir"


def test_an_empty_name_resolves_to_nothing(session, client):
    assert resolve_from_sessions("   ", session).resolution is Resolution.NOT_FOUND


def test_it_reads_sessions_and_not_grants(client, sign_in, session, dev_resolve):
    """Where the ids come from, asserted rather than assumed.

    A resolver that read ``team_grant`` would resolve any name already granted somewhere,
    which is circular: the thing being tested would supply its own answer.
    """
    sign_in(GUEST, "Kadir")
    sign_in(OWNER, "Renn")
    add_grant(client, make_team(client), "Kadir")
    session.execute(TeamGrant.__table__.delete())
    session.execute(AuthSession.__table__.delete().where(AuthSession.character_id == GUEST))
    session.commit()

    assert resolve_from_sessions("Kadir", session).resolution is Resolution.NOT_FOUND
    assert session.scalars(select(AuthSession.character_id)).all() == [OWNER]
