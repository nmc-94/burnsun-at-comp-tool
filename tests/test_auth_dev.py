"""Signing in with no EVE at all.

What these pin is that the session is a *real* one — same mint, same cookie, same everything
downstream — and that anything short of a correct secret in a development environment is a
404 that says nothing about whether this build has the route at all.

They deliberately do not use the ``resolver`` fixture: nothing here goes near a character
name lookup, and a test that reached for it would be overriding a dependency it never calls.
"""

from __future__ import annotations

import logging

import pytest
from sqlalchemy import select

from comptool.auth import sessions
from comptool.auth.dev import SECRET_HEADER
from comptool.models import AuthSession

#: At least DEV_AUTH_SECRET_MIN_LENGTH, or the settings validator refuses it.
SECRET = "a-development-secret-of-sufficient-length"

DEV_AUTH = {"dev_auth_enabled": True, "dev_auth_secret": SECRET}

KADIR = {"characterId": 90_000_001, "characterName": "Kadir"}


@pytest.fixture()
def dev_auth(configure):
    """The development sign-in, switched on, with no EVE application configured.

    ``esi_enabled=False`` on purpose: that combination is exactly what CI runs, and it must
    be the one these tests exercise.
    """
    return configure(**DEV_AUTH, environment="local", esi_enabled=False)


def sign_in_as(client, body=None, secret: str = SECRET):
    return client.post(
        "/api/v1/auth/dev-login",
        json=body or KADIR,
        headers={SECRET_HEADER: secret},
    )


def rows():
    from comptool.db import get_session

    opened = get_session()
    session = next(opened)
    try:
        return session.scalars(select(AuthSession)).all()
    finally:
        opened.close()


def test_signing_in_without_eve_mints_a_real_session(client, dev_auth):
    response = sign_in_as(client)

    assert response.status_code == 200
    body = response.json()
    assert body["characterId"] == 90_000_001
    assert body["characterName"] == "Kadir"
    # A row in the same table a real sign-in writes to, reachable by the same dependency.
    minted = rows()
    assert [(row.character_id, row.character_name) for row in minted] == [(90_000_001, "Kadir")]
    # The expiry reported is the row's own, not a number the route made up.
    assert body["expiresAt"].startswith(minted[0].expires_at.isoformat()[:19])
    assert client.get("/api/v1/auth/me").json()["character"]["characterName"] == "Kadir"


def test_the_cookie_is_the_one_a_real_sign_in_sets(client, dev_auth):
    # The "identical downstream" claim, made checkable: same attributes as the callback's,
    # asserted the same way in test_auth_routes.py.
    header = sign_in_as(client).headers["set-cookie"]

    assert sessions.COOKIE_NAME in header
    assert "HttpOnly" in header
    assert "Secure" in header
    assert "SameSite=lax" in header
    assert "Max-Age=2592000" in header


def test_the_cookie_drops_secure_for_local_http_development(client, configure):
    # The whole reason an end-to-end suite can run over plain http.
    configure(**DEV_AUTH, environment="local", session_cookie_secure=False)

    assert "Secure" not in sign_in_as(client).headers["set-cookie"]


def test_it_is_off_by_default(client):
    # No `configure` at all: the shape of a deployment that never heard of this feature.
    response = sign_in_as(client)

    assert response.status_code == 404
    assert rows() == []


def test_a_wrong_secret_and_a_switched_off_route_answer_the_same_thing(client, configure):
    off = sign_in_as(client)
    configure(**DEV_AUTH, environment="local")
    wrong = sign_in_as(client, secret="not-the-secret-but-the-same-length-ish")
    missing = client.post("/api/v1/auth/dev-login", json=KADIR)

    # Byte-identical: nothing in a refusal says whether this build carries the route.
    assert off.status_code == wrong.status_code == missing.status_code == 404
    assert off.json() == wrong.json() == missing.json() == {"detail": "Not found"}
    assert rows() == []


def test_the_route_refuses_a_production_environment(client, configure):
    # Settings.model_copy does not re-run validators, which is how `configure` works — so
    # this is the only form of the boot-time guarantee a test can actually exercise.
    configure(**DEV_AUTH, environment="production")

    assert sign_in_as(client).status_code == 404
    assert rows() == []


def test_a_dev_session_carries_no_owner_claim(client, dev_auth):
    # There was no SSO to make one. It also makes `character_owner_hash IS NULL` the list of
    # every session this route ever minted.
    sign_in_as(client)

    assert rows()[0].character_owner_hash is None


def test_a_later_real_sign_in_revokes_the_development_one(client, dev_auth):
    from comptool.db import get_session

    sign_in_as(client)

    # What the callback does before minting. A null owner hash reads as a different owner,
    # so the dev session goes — which is the behaviour we want and did not have to add.
    opened = get_session()
    session = next(opened)
    try:
        ended = sessions.revoke_sessions_of_a_previous_owner(session, 90_000_001, "an-owner-hash")
        session.commit()
    finally:
        opened.close()

    assert ended == 1
    assert rows() == []


def test_me_reports_a_character_even_though_sso_is_off(client, dev_auth):
    # A combination that could not previously exist: signed in, with no EVE application.
    # The SPA renders the chip off `character` and hides the sign-in button off `ssoEnabled`.
    sign_in_as(client)

    body = client.get("/api/v1/auth/me").json()

    assert body["ssoEnabled"] is False
    assert body["character"]["characterId"] == 90_000_001
    assert body["character"]["characterName"] == "Kadir"


def test_a_team_can_be_created_and_read_with_no_eve_application_configured(client, dev_auth):
    # The CI-viability test: a run needs no EVE credentials and no network to reach the
    # authenticated half of the app.
    sign_in_as(client)

    created = client.post("/api/v1/teams", json={"name": "Team Kadir"})
    listed = client.get("/api/v1/teams")

    assert created.status_code == 201
    assert [team["name"] for team in listed.json()] == ["Team Kadir"]
    assert created.json()["yourLevel"] == "owner"


def test_a_second_character_reaches_nothing_of_the_first(client, dev_auth):
    # What an end-to-end run can still prove without the grant seam: this mints an identity,
    # not a skeleton key.
    sign_in_as(client)
    team_id = client.post("/api/v1/teams", json={"name": "Team Kadir"}).json()["id"]

    sign_in_as(client, {"characterId": 90_000_002, "characterName": "Ayla"})

    assert client.get("/api/v1/teams").json() == []
    # 404 rather than 403, the way access.py hides a team's existence.
    assert client.get(f"/api/v1/teams/{team_id}").status_code == 404


def test_a_long_character_name_is_a_422_not_a_500(client, dev_auth):
    # AuthSession.character_name is String(200); without the constraint this is a database
    # error at commit.
    response = sign_in_as(client, {"characterId": 90_000_001, "characterName": "K" * 201})

    assert response.status_code == 422
    assert rows() == []


def test_a_blank_character_name_is_refused(client, dev_auth):
    response = sign_in_as(client, {"characterId": 90_000_001, "characterName": "   "})

    assert response.status_code == 422


def test_the_secret_is_never_logged(client, dev_auth, caplog):
    with caplog.at_level(logging.DEBUG, logger="comptool"):
        sign_in_as(client)
        sign_in_as(client, secret="not-the-secret-but-the-same-length-ish")

    assert SECRET not in caplog.text
    # The events are there, though: a refusal has to be findable by whoever is wondering.
    assert "dev_login" in caplog.text
    assert "dev_login_rejected" in caplog.text
