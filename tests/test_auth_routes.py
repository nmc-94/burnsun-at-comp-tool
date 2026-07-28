"""Signing in and out, end to end through the app.

EVE stands in as a fake client, so the whole flow runs with no network: what is being
tested is this application's half of it — that a state is single-use, that the cookie has
the attributes a long-lived session needs, and that signing out actually ends things.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlparse

import pytest
from sqlalchemy import select

from comptool.auth import crypto, sessions
from comptool.auth.sso import Identity, SsoAuthRevoked, SsoError, TokenGrant
from comptool.models import AuthEsiToken, AuthLoginAttempt, AuthSession

SSO = {
    "esi_enabled": True,
    "esi_client_id": "a-client-id",
    "esi_callback_url": "http://localhost:8000/api/v1/auth/callback",
    "esi_token_secret": "a-token-secret",
}

IDENTITY = Identity(character_id=90_000_001, name="Kadir", owner_hash="an-owner-hash")
GRANT = TokenGrant(access_token="an-access-token", refresh_token="a-refresh-token", expires_in=1199)


class FakeSso:
    """Stands in for EVE. Duck-typed — the client is only ever reached via a dependency."""

    def __init__(self, grant=GRANT, identity=IDENTITY, failure: Exception | None = None):
        self.grant = grant
        self.identity_value = identity
        self.failure = failure
        self.exchanged: list[tuple[str, str]] = []

    def authorize_url(self, challenge) -> str:
        return (
            "https://login.eveonline.com/v2/oauth/authorize"
            f"?client_id=a-client-id&state={challenge.state}"
            f"&code_challenge={challenge.code_challenge}&code_challenge_method=S256"
        )

    def exchange_code(self, code: str, code_verifier: str) -> TokenGrant:
        self.exchanged.append((code, code_verifier))
        if self.failure is not None:
            raise self.failure
        return self.grant

    def identity(self, access_token: str) -> Identity:
        return self.identity_value

    def close(self) -> None:  # pragma: no cover - nothing to release
        pass


@pytest.fixture()
def eve(client, configure):
    """A configured EVE application, answered by a fake."""
    from comptool.auth.dependencies import sso_client
    from comptool.main import app

    configure(**SSO)
    fake = FakeSso()
    app.dependency_overrides[sso_client] = lambda: fake
    try:
        yield fake
    finally:
        app.dependency_overrides.pop(sso_client, None)


def db():
    from comptool.db import get_session

    return get_session()


def rows(model):
    opened = db()
    session = next(opened)
    try:
        return session.scalars(select(model)).all()
    finally:
        opened.close()


def begin_login(client) -> str:
    """Start a sign-in and return the state the SSO would echo back."""
    response = client.get("/api/v1/auth/login", follow_redirects=False)
    return parse_qs(urlparse(response.headers["location"]).query)["state"][0]


def complete_login(client):
    """The whole round trip, as a browser would walk it."""
    state = begin_login(client)
    return client.get(f"/api/v1/auth/callback?code=c&state={state}", follow_redirects=False)


def test_login_redirects_to_the_sso_with_a_pkce_challenge(client, eve):
    response = client.get("/api/v1/auth/login", follow_redirects=False)

    assert response.status_code == 302
    query = parse_qs(urlparse(response.headers["location"]).query)
    assert query["code_challenge_method"] == ["S256"]
    # The verifier stays here; only its hash is sent.
    attempt = rows(AuthLoginAttempt)[0]
    assert query["state"] == [attempt.state]
    assert attempt.code_verifier not in response.headers["location"]


def test_login_is_unavailable_when_no_eve_application_is_configured(client, configure):
    configure(esi_enabled=False)

    response = client.get("/api/v1/auth/login", follow_redirects=False)

    # 503, not 404: nothing is hidden here, and an operator deserves to be able to tell
    # "not configured" from "not a route".
    assert response.status_code == 503
    assert "not configured" in response.json()["detail"]


def test_login_refuses_to_send_the_browser_off_site_afterwards(client, eve):
    # Otherwise signing in is an open redirect, on the one route whose whole job is to
    # look trustworthy while collecting credentials.
    for hostile in ("https://evil.invalid/", "//evil.invalid/", "javascript:alert(1)"):
        client.get(f"/api/v1/auth/login?next={hostile}", follow_redirects=False)

    assert {attempt.next_path for attempt in rows(AuthLoginAttempt)} == {"/"}


def test_login_keeps_a_relative_destination(client, eve):
    client.get("/api/v1/auth/login?next=/teams", follow_redirects=False)

    assert rows(AuthLoginAttempt)[0].next_path == "/teams"


def test_the_callback_signs_the_character_in_and_sets_a_cookie(client, eve):
    state = begin_login(client)

    response = client.get(
        f"/api/v1/auth/callback?code=an-auth-code&state={state}", follow_redirects=False
    )

    assert response.status_code == 302
    assert sessions.COOKIE_NAME in response.cookies
    assert client.get("/api/v1/auth/me").json()["character"]["characterName"] == "Kadir"


def test_the_callback_presents_the_verifier_it_was_issued(client, eve):
    state = begin_login(client)
    verifier = rows(AuthLoginAttempt)[0].code_verifier

    client.get(f"/api/v1/auth/callback?code=an-auth-code&state={state}", follow_redirects=False)

    assert eve.exchanged == [("an-auth-code", verifier)]


def test_the_session_cookie_is_http_only_secure_and_persistent(client, eve):
    state = begin_login(client)

    response = client.get(
        f"/api/v1/auth/callback?code=c&state={state}", follow_redirects=False
    )

    header = response.headers["set-cookie"]
    assert "HttpOnly" in header
    assert "Secure" in header
    assert "SameSite=lax" in header
    # Persistent, so closing the browser does not sign anyone out.
    assert "Max-Age=2592000" in header


def test_the_cookie_drops_secure_for_local_http_development(client, configure, eve):
    configure(**SSO, session_cookie_secure=False)
    state = begin_login(client)

    response = client.get(f"/api/v1/auth/callback?code=c&state={state}", follow_redirects=False)

    assert "Secure" not in response.headers["set-cookie"]


def test_the_callback_stores_the_refresh_token_encrypted(client, eve):
    state = begin_login(client)

    client.get(f"/api/v1/auth/callback?code=c&state={state}", follow_redirects=False)

    stored = rows(AuthEsiToken)[0]
    assert "a-refresh-token" not in stored.refresh_token_encrypted
    assert crypto.decrypt(stored.refresh_token_encrypted, "a-token-secret") == "a-refresh-token"


def test_the_browser_never_receives_an_eve_token(client, eve):
    state = begin_login(client)

    response = client.get(f"/api/v1/auth/callback?code=c&state={state}", follow_redirects=False)

    body = response.text + str(response.headers)
    assert "an-access-token" not in body
    assert "a-refresh-token" not in body


def test_a_callback_state_cannot_be_replayed(client, eve):
    state = begin_login(client)
    client.get(f"/api/v1/auth/callback?code=c&state={state}", follow_redirects=False)
    client.cookies.clear()

    again = client.get(f"/api/v1/auth/callback?code=c&state={state}", follow_redirects=False)

    assert "authError=state" in again.headers["location"]
    assert len(rows(AuthSession)) == 1


def test_an_unknown_callback_state_sends_the_user_back_with_an_error(client, eve):
    response = client.get(
        "/api/v1/auth/callback?code=c&state=never-issued", follow_redirects=False
    )

    # A redirect, not a JSON 400: this is a browser navigation, and an error body is a
    # dead end for whoever is looking at it.
    assert response.status_code == 302
    assert "authError=state" in response.headers["location"]
    assert rows(AuthSession) == []


def test_declining_at_the_consent_screen_is_not_an_error_page(client, eve):
    response = client.get("/api/v1/auth/callback?error=access_denied", follow_redirects=False)

    assert response.status_code == 302
    assert "authError=denied" in response.headers["location"]
    assert rows(AuthSession) == []


def test_a_failed_exchange_signs_nobody_in(client, configure):
    from comptool.auth.dependencies import sso_client
    from comptool.main import app

    configure(**SSO)
    app.dependency_overrides[sso_client] = lambda: FakeSso(failure=SsoError("refused"))
    try:
        state = begin_login(client)
        response = client.get(f"/api/v1/auth/callback?code=c&state={state}", follow_redirects=False)
    finally:
        app.dependency_overrides.pop(sso_client, None)

    assert "authError=exchange" in response.headers["location"]
    assert rows(AuthSession) == []


def test_a_stale_login_attempt_is_refused(client, eve):
    state = begin_login(client)
    _expire_attempt(state)

    response = client.get(f"/api/v1/auth/callback?code=c&state={state}", follow_redirects=False)

    assert "authError=state" in response.headers["location"]
    assert rows(AuthSession) == []


def _expire_attempt(state: str) -> None:
    opened = db()
    session = next(opened)
    try:
        attempt = session.scalar(select(AuthLoginAttempt).where(AuthLoginAttempt.state == state))
        attempt.expires_at = datetime.now(tz=UTC) - timedelta(minutes=1)
        session.commit()
    finally:
        opened.close()


def test_a_transferred_character_loses_the_previous_owners_session(client, configure):
    from comptool.auth.dependencies import sso_client
    from comptool.main import app

    configure(**SSO)
    app.dependency_overrides[sso_client] = lambda: FakeSso()
    try:
        complete_login(client)
        moved = Identity(character_id=90_000_001, name="Kadir", owner_hash="a-new-owner-hash")
        app.dependency_overrides[sso_client] = lambda: FakeSso(identity=moved)
        client.cookies.clear()
        complete_login(client)
    finally:
        app.dependency_overrides.pop(sso_client, None)

    assert len(rows(AuthSession)) == 1


def test_me_reports_nobody_when_no_cookie_is_sent(client, eve):
    body = client.get("/api/v1/auth/me").json()

    # 200 with a null character, not a 401: this is the one route whose job is to answer
    # the question, and an anonymous page load is not a failure.
    assert body == {"signIn": "sso", "character": None}


def test_me_reports_when_signing_in_is_not_even_possible(client, configure):
    configure(esi_enabled=False)

    # "none", not a false flag: with neither door configured the SPA says so outright rather
    # than offering a button that could only ever 503.
    assert client.get("/api/v1/auth/me").json()["signIn"] == "none"


def test_me_reports_the_local_door_when_that_is_the_one_configured(client, configure):
    configure(esi_enabled=False, local_auth_enabled=True, team_creation_key="a" * 24)

    assert client.get("/api/v1/auth/me").json()["signIn"] == "local"


def test_me_names_the_signed_in_character(client, sign_in):
    sign_in(90_000_001, "Kadir")

    body = client.get("/api/v1/auth/me").json()

    assert body["character"]["characterId"] == 90_000_001
    assert body["character"]["characterName"] == "Kadir"


def test_me_is_never_cached(client, sign_in):
    # A cached identity is somebody else's identity on a shared machine.
    assert client.get("/api/v1/auth/me").headers["cache-control"] == "no-store"


def test_a_stale_cookie_is_cleared(client):
    client.cookies.set(sessions.COOKIE_NAME, "a-token-this-server-never-issued")

    response = client.get("/api/v1/auth/me")

    assert response.json()["character"] is None
    assert 'comptool_session=""' in response.headers.get("set-cookie", "")


def test_using_a_session_slides_its_expiry_and_re_rolls_the_cookie(client, sign_in, configure):
    # renew_after_seconds=0 renews on every request, so one call is enough to observe it.
    configure(session_renew_after_seconds=0)
    sign_in(90_000_001)
    before = client.get("/api/v1/auth/me").json()["character"]["expiresAt"]

    response = client.get("/api/v1/auth/me")

    assert response.json()["character"]["expiresAt"] >= before
    assert sessions.COOKIE_NAME in response.headers.get("set-cookie", "")


def test_a_session_used_twice_in_a_moment_is_not_rewritten(client, sign_in, configure):
    configure(session_renew_after_seconds=3600)
    sign_in(90_000_001)
    client.get("/api/v1/auth/me")

    response = client.get("/api/v1/auth/me")

    assert "set-cookie" not in response.headers


def test_signing_out_clears_the_cookie_and_ends_the_session(client, sign_in):
    sign_in(90_000_001)

    response = client.post("/api/v1/auth/logout")

    assert response.status_code == 204
    assert 'comptool_session=""' in response.headers["set-cookie"]
    assert rows(AuthSession) == []


def test_signing_out_is_harmless_when_nobody_is_signed_in(client):
    # What a stale tab does. Answering with an error would leave it stuck.
    assert client.post("/api/v1/auth/logout").status_code == 204


def test_signing_out_everywhere_ends_the_other_devices_sessions(client, sign_in):
    phone = sign_in(90_000_001)
    sign_in(90_000_001)

    assert client.post("/api/v1/auth/logout-all").status_code == 204

    client.cookies.set(sessions.COOKIE_NAME, phone)
    assert client.get("/api/v1/auth/me").json()["character"] is None


def test_signing_out_everywhere_leaves_other_characters_alone(client, sign_in):
    sign_in(90_000_002, "Somebody Else")
    sign_in(90_000_001, "Kadir")

    client.post("/api/v1/auth/logout-all")

    assert [record.character_id for record in rows(AuthSession)] == [90_000_002]


def test_signing_out_everywhere_without_a_session_is_a_401(client):
    response = client.post("/api/v1/auth/logout-all")

    assert response.status_code == 401
    assert response.json()["detail"] == "Not signed in"


def test_signing_in_refreshes_the_name_shown_beside_a_grant(client, eve):
    _grant_to(90_000_001, "Kadir Under Their Old Name")

    state = begin_login(client)
    client.get(f"/api/v1/auth/callback?code=c&state={state}", follow_redirects=False)

    from comptool.models import TeamGrant

    assert [grant.subject_name for grant in rows(TeamGrant)] == ["Kadir"]


def test_signing_in_refreshes_the_name_on_a_team_you_own(client, eve):
    # The owner is not in the grant sweep above — ownership is a column — so without this
    # half the one name that can never be reconciled is the owner's own.
    _grant_to(90_000_001, "Kadir", owner_name="Kadir Under Their Old Name")

    state = begin_login(client)
    client.get(f"/api/v1/auth/callback?code=c&state={state}", follow_redirects=False)

    from comptool.models import Team

    assert [team.owner_character_name for team in rows(Team)] == ["Kadir"]


def test_signing_in_fills_in_an_owner_name_that_was_never_stored(client, eve):
    # The backfill 0007 could not do. `!=` does not match NULL in SQL, so this is the case
    # the explicit is_(None) arm exists for — and every team predating the column is in it.
    _grant_to(90_000_001, "Kadir", owner_name=None)

    state = begin_login(client)
    client.get(f"/api/v1/auth/callback?code=c&state={state}", follow_redirects=False)

    from comptool.models import Team

    assert [team.owner_character_name for team in rows(Team)] == ["Kadir"]


def _grant_to(character_id: int, name: str, owner_name: str | None = "Somebody Else") -> None:
    from comptool.models import AccessLevel, SubjectKind, Team, TeamGrant

    opened = db()
    session = next(opened)
    try:
        # Owned by the character signing in, so the owner half of the reconciliation has
        # something to find. The grant below is a *separate* row for the same character —
        # which is the realistic shape: you can be granted access to a team you own.
        team = Team(
            name="Aurora Vanguard",
            owner_character_id=character_id,
            owner_character_name=owner_name,
        )
        session.add(team)
        session.flush()
        session.add(
            TeamGrant(
                team_id=team.id,
                subject_kind=SubjectKind.CHARACTER,
                subject_id=character_id,
                subject_name=name,
                level=AccessLevel.VIEWER,
            )
        )
        session.commit()
    finally:
        opened.close()


def test_the_ruleset_routes_stay_public_without_a_session(client):
    # Authentication is attached per router, never to the /api/v1 prefix. If this ever
    # fails, something swept the published tournament data behind a login.
    assert client.get("/api/v1/rulesets").status_code == 200
    assert client.get("/api/v1/rulesets/atxxii/latest").status_code == 404


def test_a_revoked_authorization_is_a_distinct_failure():
    # Pinned here because the callback and any later liveness check must be able to tell
    # "sign in again" from "try again later".
    assert issubclass(SsoAuthRevoked, SsoError)
