"""What actually goes on the wire to EVE SSO, and what comes back.

A mock transport stands in for CCP, so these assert the exact request rather than trusting
that it was built right. The two that matter most: no client secret is ever sent (PKCE
makes this a public client, and sending one would mean the settings grew a secret nobody
meant to add), and a revoked authorization is distinguishable from a bad afternoon on the
network — because only one of them should sign somebody out.
"""

from __future__ import annotations

from urllib.parse import parse_qs, urlparse

import httpx
import pytest

from comptool.auth import sso
from comptool.settings import Settings

SETTINGS = Settings(
    esi_enabled=True,
    esi_client_id="a-client-id",
    esi_callback_url="http://localhost:8000/api/v1/auth/callback",
    esi_token_secret="secret",
)

GRANT = {"access_token": "an-access-token", "refresh_token": "a-refresh-token", "expires_in": 1199}


def client(handler) -> sso.SsoClient:
    return sso.SsoClient(SETTINGS, httpx.Client(transport=httpx.MockTransport(handler)))


def answering(payload, status: int = 200):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, json=payload)

    return handler


def capturing(payload, seen: dict, status: int = 200):
    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["headers"] = request.headers
        seen["form"] = parse_qs(request.content.decode())
        return httpx.Response(status, json=payload)

    return handler


def test_the_authorize_url_carries_the_client_id_state_and_challenge():
    challenge = sso.start_login()

    url = client(answering({})).authorize_url(challenge)
    query = parse_qs(urlparse(url).query)

    assert urlparse(url).path == sso.SSO_AUTHORIZE_PATH
    assert query["response_type"] == ["code"]
    assert query["client_id"] == ["a-client-id"]
    assert query["state"] == [challenge.state]
    assert query["code_challenge"] == [challenge.code_challenge]
    assert query["code_challenge_method"] == ["S256"]
    assert query["redirect_uri"] == ["http://localhost:8000/api/v1/auth/callback"]


def test_the_authorize_url_asks_for_a_scope_so_a_refresh_token_is_issued():
    # The SSO returns a refresh token only if the initial redirect requested one valid
    # scope. An empty scope here would silently cost the silent-refresh behaviour.
    url = client(answering({})).authorize_url(sso.start_login())

    assert parse_qs(urlparse(url).query)["scope"] == ["publicData"]


def test_the_verifier_never_leaves_in_the_authorize_url():
    # Only its hash goes out; the verifier itself is what proves the exchange later.
    challenge = sso.start_login()

    url = client(answering({})).authorize_url(challenge)

    assert challenge.code_verifier not in url


def test_the_code_exchange_posts_the_verifier_and_no_secret():
    seen: dict = {}

    grant = client(capturing(GRANT, seen)).exchange_code("an-auth-code", "the-verifier")

    assert seen["form"]["grant_type"] == ["authorization_code"]
    assert seen["form"]["code"] == ["an-auth-code"]
    assert seen["form"]["code_verifier"] == ["the-verifier"]
    assert seen["form"]["client_id"] == ["a-client-id"]
    # PKCE is a public client: no Basic authorization, and no redirect_uri on the
    # exchange either.
    assert "authorization" not in seen["headers"]
    assert "client_secret" not in seen["form"]
    assert "redirect_uri" not in seen["form"]
    assert seen["headers"]["content-type"] == "application/x-www-form-urlencoded"
    assert grant.access_token == "an-access-token"
    assert grant.refresh_token == "a-refresh-token"


def test_the_token_request_identifies_the_caller():
    seen: dict = {}

    client(capturing(GRANT, seen)).exchange_code("code", "verifier")

    assert "comptool/" in seen["headers"]["user-agent"]


def test_a_refused_code_raises():
    with pytest.raises(sso.SsoError, match="rejected"):
        client(answering({"error": "invalid_request"}, status=400)).exchange_code("bad", "v")


def test_a_revoked_authorization_is_reported_as_revoked():
    # Distinct from every other failure: this is the only one where signing in again is
    # the fix, so it is the only one that should end a session.
    with pytest.raises(sso.SsoAuthRevoked):
        client(answering({"error": "invalid_grant"}, status=400)).refresh("spent-token")


def test_a_network_failure_is_not_mistaken_for_a_revocation():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route", request=request)

    with pytest.raises(sso.SsoError) as raised:
        client(handler).refresh("a-refresh-token")

    assert not isinstance(raised.value, sso.SsoAuthRevoked)


def test_a_refresh_sends_the_token_and_the_client_id():
    seen: dict = {}

    client(capturing(GRANT, seen)).refresh("a-refresh-token")

    assert seen["form"]["grant_type"] == ["refresh_token"]
    assert seen["form"]["refresh_token"] == ["a-refresh-token"]
    assert seen["form"]["client_id"] == ["a-client-id"]
    assert "authorization" not in seen["headers"]


def test_a_refresh_returns_whatever_token_came_back():
    # The SSO rotates refresh tokens for native applications, so the reply is what to
    # store — not the token that was submitted.
    rotated = {**GRANT, "refresh_token": "a-rotated-token"}

    assert client(answering(rotated)).refresh("a-refresh-token").refresh_token == "a-rotated-token"


def test_a_grant_without_a_refresh_token_is_not_invented():
    assert client(answering({"access_token": "t", "expires_in": 1199})).refresh("x") is not None
    assert client(answering({"access_token": "t"})).exchange_code("c", "v").refresh_token is None


def test_a_reply_without_an_access_token_is_refused():
    with pytest.raises(sso.SsoError, match="no access token"):
        client(answering({"expires_in": 1199})).exchange_code("c", "v")


def test_a_reply_that_is_not_json_is_refused():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="<html>a proxy error page</html>")

    with pytest.raises(sso.SsoError, match="not JSON"):
        client(handler).exchange_code("c", "v")
