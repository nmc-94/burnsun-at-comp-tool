"""Signing in by claiming a name, and changing the name you claimed.

The most valuable test here is not that the route answers 200. It is
``test_a_claimed_session_reaches_a_team_like_any_other``: the whole design rests on a claim that
nothing downstream of ``sessions.mint`` can tell where an identity came from, and a test that
only checked this route's own response would prove the route works while leaving that claim
untested. ``comptool/auth/dev.py`` makes the same argument about the same seam.

There is no password at this door — the credentials in this mode belong to teams, and they are
in ``test_join.py``. What is here instead is the rate limit, which exists for a different reason
than a throttle does: nothing can fail, so what is being slowed is bulk claiming rather than
guessing.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from comptool.auth import local as local_auth
from comptool.models import AuthSession, LocalAccount

CLAIM = "/api/v1/auth/name"

#: At least TEAM_CREATION_KEY_MIN_LENGTH, or the settings validator would refuse it — though
#: `configure` goes through model_copy and does not re-run validators.
CREATION_KEY = "a-creation-key-long-enough-here"
TEAM_PASSWORD = "sun-reavers-2026"


@pytest.fixture()
def local_auth_on(configure):
    """Local accounts, switched on, with no EVE application.

    ``esi_enabled=False`` is not decoration: the two modes cannot both be on in a deployment
    that boots, so a test running them together would exercise a configuration nothing ships.
    """
    local_auth.reset_rate_limit()
    yield configure(
        esi_enabled=False, local_auth_enabled=True, team_creation_key=CREATION_KEY
    )
    # Module state outlives a test, and every test here shares one client host.
    local_auth.reset_rate_limit()


def claim_as(client, name: str = "Sable Kaneko"):
    return client.post(CLAIM, json={"displayName": name})


def make_team(client, name: str = "Sun Reavers", password: str = TEAM_PASSWORD, level="viewer"):
    return client.post(
        "/api/v1/teams",
        json={
            "name": name,
            "creationKey": CREATION_KEY,
            "password": password,
            "passwordLevel": level,
        },
    )


def rows(model):
    from comptool.db import get_session

    opened = get_session()
    session = next(opened)
    try:
        return session.scalars(select(model)).all()
    finally:
        opened.close()


def test_claiming_a_name_mints_a_real_session(client, local_auth_on):
    response = claim_as(client)

    assert response.status_code == 200
    body = response.json()
    assert body["characterName"] == "Sable Kaneko"
    # The negative band. Everything downstream stores this id in a column EVE only ever fills
    # positively, which is why none of them needed a migration.
    assert body["characterId"] < 0
    assert len(rows(AuthSession)) == 1
    assert client.cookies.get("comptool_session")


def test_no_password_is_asked_for(client, local_auth_on):
    # The correction this whole mode exists for: the instance has no password. A caller sending
    # one is not refused, because there is no field for it — it is ignored, and the name is the
    # only thing that decides anything.
    response = client.post(CLAIM, json={"displayName": "Sable Kaneko", "password": "anything"})

    assert response.status_code == 200


def test_a_claimed_session_reaches_a_team_like_any_other(client, local_auth_on):
    """The test the whole design rests on.

    Creates a team, lists it back, and reads it by id — all through the ordinary team routes,
    which go through ``current_viewer``, ``access.authorize`` and the permission resolver
    without any of them being told this identity was not issued by EVE.
    """
    claim_as(client)

    created = make_team(client)
    assert created.status_code == 201
    team = created.json()
    assert team["ownerCharacterId"] < 0
    assert team["ownerCharacterName"] == "Sable Kaneko"
    assert team["yourLevel"] == "owner"

    assert [t["id"] for t in client.get("/api/v1/teams").json()] == [team["id"]]
    assert client.get(f"/api/v1/teams/{team['id']}").status_code == 200


def test_two_names_are_two_people_who_cannot_see_each_other(client, local_auth_on):
    claim_as(client, "Sable Kaneko")
    mine = make_team(client).json()

    # The same browser, a different name — and a different principal, so the first team is not
    # merely hidden from the listing but unreachable by its own id.
    claim_as(client, "Kadir")
    assert client.get("/api/v1/teams").json() == []
    assert client.get(f"/api/v1/teams/{mine['id']}").status_code == 404


def test_claiming_a_taken_name_signs_you_in_as_them(client, local_auth_on):
    """The consequence of open sign-in, pinned rather than left implicit.

    This is the behaviour the README and the sign-in screen both warn about. It is here so that
    anybody who changes it has to come to this file and mean it.
    """
    claim_as(client, "Sable Kaneko")
    team = make_team(client).json()
    client.cookies.clear()

    claim_as(client, "sable kaneko")

    assert [t["id"] for t in client.get("/api/v1/teams").json()] == [team["id"]]
    assert len(rows(LocalAccount)) == 1


def test_claiming_is_rate_limited(client, local_auth_on):
    for _ in range(local_auth.CLAIM_LIMIT):
        assert claim_as(client, "Sable Kaneko").status_code == 200

    blocked = claim_as(client, "Sable Kaneko")

    # Not a throttle on failures — nothing here fails. A cap on how fast identities can be
    # minted, so names cannot be harvested or squatted at speed.
    assert blocked.status_code == 429
    assert int(blocked.headers["retry-after"]) > 0


def test_signing_in_when_it_is_not_configured_is_a_503(client):
    response = claim_as(client)

    # A 503 that says what is wrong, not dev.py's 404. Nothing is hidden: /me and /api/health
    # both report which door is open to anyone who asks.
    assert response.status_code == 503
    assert "not configured" in response.json()["detail"]


def test_me_reports_the_local_identity(client, local_auth_on):
    claim_as(client)

    body = client.get("/api/v1/auth/me").json()

    assert body["signIn"] == "local"
    assert body["character"]["characterName"] == "Sable Kaneko"
    assert body["character"]["characterId"] < 0


def test_health_reports_which_door_is_open(client, local_auth_on):
    assert client.get("/api/health").json()["auth"] == "local"


# --- renaming -----------------------------------------------------------------------------


def test_renaming_keeps_everything_that_hangs_off_the_id(client, local_auth_on):
    claim_as(client, "Sabel Kaneko")
    was = client.get("/api/v1/auth/me").json()["character"]["characterId"]
    team = make_team(client).json()

    renamed = client.patch("/api/v1/auth/me", json={"displayName": "Sable Kaneko"})

    assert renamed.status_code == 200
    assert renamed.json()["characterId"] == was
    # /me reads the name off the session row, so the rename has to reach that too or the header
    # keeps showing the typo until the cookie expires.
    assert client.get("/api/v1/auth/me").json()["character"]["characterName"] == "Sable Kaneko"
    # And the owned team, which holds the name beside the id for display.
    assert client.get(f"/api/v1/teams/{team['id']}").json()["ownerCharacterName"] == (
        "Sable Kaneko"
    )


def test_renaming_onto_a_taken_name_is_a_409(client, local_auth_on):
    claim_as(client, "Kadir")
    claim_as(client, "Sable Kaneko")

    refused = client.patch("/api/v1/auth/me", json={"displayName": "kadir"})

    assert refused.status_code == 409
    assert client.get("/api/v1/auth/me").json()["character"]["characterName"] == "Sable Kaneko"


def test_renaming_requires_a_session(client, local_auth_on):
    assert client.patch("/api/v1/auth/me", json={"displayName": "Nobody"}).status_code == 401
