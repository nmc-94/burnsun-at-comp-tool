"""Resolving a character name to the id a grant matches on.

The rule these enforce is that a lookup never raises: every way it can go wrong is an
outcome the caller stores as a pending invitation. No network — a mock transport answers
in ESI's shape.
"""

from __future__ import annotations

import httpx

from comptool.esi import Resolution, resolve_character, user_agent
from comptool.settings import Settings

SSO = {
    "esi_enabled": True,
    "esi_client_id": "client",
    "esi_callback_url": "http://localhost:8000/api/v1/auth/callback",
    "esi_token_secret": "secret",
}


def settings(**overrides) -> Settings:
    return Settings(**{**SSO, **overrides})


def transport(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def answering(payload, status: int = 200):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, json=payload)

    return handler


def test_a_known_name_resolves_to_its_character_id():
    body = {"characters": [{"id": 90_000_001, "name": "Kadir"}]}

    with transport(answering(body)) as http:
        found = resolve_character("Kadir", settings(), http)

    assert found.resolution is Resolution.RESOLVED
    assert found.character_id == 90_000_001


def test_the_canonical_spelling_is_kept_over_what_was_typed():
    # ESI matches case-insensitively; the name stored for display should be the game's.
    body = {"characters": [{"id": 90_000_001, "name": "Kadir"}]}

    with transport(answering(body)) as http:
        found = resolve_character("kadir", settings(), http)

    assert found.resolution is Resolution.RESOLVED
    assert found.name == "Kadir"


def test_only_character_matches_are_accepted():
    # The endpoint answers for several kinds of entity at once. A corporation id landing
    # in a grant that claims to name a character would hand access to the wrong entity.
    body = {
        "corporations": [{"id": 98_000_001, "name": "Aurora Holdings"}],
        "alliances": [{"id": 99_000_001, "name": "Aurora Holdings"}],
    }

    with transport(answering(body)) as http:
        found = resolve_character("Aurora Holdings", settings(), http)

    assert found.resolution is Resolution.NOT_FOUND
    assert found.character_id is None


def test_a_partial_match_is_not_taken_for_the_name_that_was_asked_for():
    body = {"characters": [{"id": 90_000_001, "name": "Kadir Vex"}]}

    with transport(answering(body)) as http:
        found = resolve_character("Kadir", settings(), http)

    assert found.resolution is Resolution.NOT_FOUND


def test_an_unknown_name_is_reported_as_not_found():
    with transport(answering({})) as http:
        found = resolve_character("Nobody At All", settings(), http)

    assert found.resolution is Resolution.NOT_FOUND


def test_two_matches_are_reported_as_ambiguous_rather_than_guessed():
    body = {
        "characters": [
            {"id": 90_000_001, "name": "Kadir Prime"},
            {"id": 90_000_002, "name": "Kadir Secundus"},
        ]
    }

    with transport(answering(body)) as http:
        found = resolve_character("Kadir", settings(), http)

    assert found.resolution is Resolution.AMBIGUOUS
    assert found.character_id is None


def test_a_match_without_a_usable_id_resolves_to_nothing():
    # Never a traceback: this runs outside the request's error handling, and a grant that
    # stays pending is always a better answer than a 500.
    malformed = (
        {"name": "Kadir"},
        {"id": "ninety", "name": "Kadir"},
        {"id": 0, "name": "Kadir"},
    )
    for broken in malformed:
        with transport(answering({"characters": [broken]})) as http:
            found = resolve_character("Kadir", settings(), http)

        assert found.resolution is Resolution.NOT_FOUND
        assert found.character_id is None


def test_a_timeout_is_reported_as_unavailable_rather_than_raising():
    # Adding someone to a team must not fail because a third party was slow.
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("too slow", request=request)

    with transport(handler) as http:
        found = resolve_character("Kadir", settings(), http)

    assert found.resolution is Resolution.UNAVAILABLE


def test_a_server_error_is_reported_as_unavailable():
    with transport(answering({"error": "down"}, status=503)) as http:
        found = resolve_character("Kadir", settings(), http)

    assert found.resolution is Resolution.UNAVAILABLE


def test_nothing_is_called_at_all_when_esi_is_disabled():
    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError("a disabled ESI must not be dialled")

    with transport(handler) as http:
        found = resolve_character("Kadir", settings(esi_enabled=False), http)

    assert found.resolution is Resolution.UNAVAILABLE


def test_a_blank_name_never_reaches_the_network():
    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError("an empty name is not a lookup")

    with transport(handler) as http:
        assert resolve_character("   ", settings(), http).resolution is Resolution.NOT_FOUND


def test_the_caller_identifies_itself_and_its_contact():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["agent"] = request.headers["user-agent"]
        return httpx.Response(200, json={})

    with transport(handler) as http:
        resolve_character("Kadir", settings(esi_contact="ops@example.invalid"), http)

    assert "comptool/" in seen["agent"]
    assert "ops@example.invalid" in seen["agent"]
    assert "ops@example.invalid" in user_agent(settings(esi_contact="ops@example.invalid"))
