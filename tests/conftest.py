"""Shared test fixtures.

The DB-backed fixtures need a reachable Postgres (set ``DATABASE_URL``, or run
``docker compose up -d db``). Pure tests (settings, URL normalization, ingestion) need
nothing: the snapshots below are committed, so ingestion is tested offline and against the
exact data that ships.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from comptool.db import dispose_db, get_engine, get_session, init_db
from comptool.ingest import points_csv, ruleset, sde
from comptool.models import Base
from comptool.settings import get_settings

REPO_ROOT = Path(__file__).resolve().parent.parent
SOURCES = REPO_ROOT / "docs" / "sources"
POINTS_CSV = SOURCES / "points-atxxii-2026-07-23.csv"
SHIP_INDEX = SOURCES / "ships-sde-3444265.json"
ENGINE_FIXTURE = REPO_ROOT / "web" / "src" / "engine" / "__fixtures__" / "atxxii-2026-07-23.json"

#: The label this snapshot publishes under — its capture date, as the CLI derives it.
VERSION_LABEL = "2026-07-23"


@pytest.fixture(scope="session")
def snapshot() -> points_csv.PointsSnapshot:
    return points_csv.parse(POINTS_CSV)


@pytest.fixture(scope="session")
def ship_index() -> sde.ShipIndex:
    return sde.load(SHIP_INDEX)


@pytest.fixture(scope="session")
def payload(snapshot, ship_index) -> dict:
    return ruleset.build(snapshot, ship_index, VERSION_LABEL)


@pytest.fixture()
def database():
    """A clean schema for one test: create tables, yield, drop, dispose."""
    get_settings.cache_clear()
    init_db(get_settings())
    engine = get_engine()
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    try:
        yield
    finally:
        Base.metadata.drop_all(engine)
        dispose_db()


@pytest.fixture()
def session(database):
    """A session from the app's own dependency, closed the way a request would close it."""
    sessions = get_session()
    try:
        yield next(sessions)
    finally:
        sessions.close()


@pytest.fixture()
def client(database):
    """A TestClient whose lifespan (startup/shutdown) runs against the clean schema."""
    from comptool.main import app

    # https, not http: the session cookie is Secure by default and a cookie jar will not
    # send a Secure cookie over plain http, so an http client would silently exercise a
    # configuration nothing deploys. No TLS is involved — the scheme is just part of the
    # request scope.
    with TestClient(app, base_url="https://testserver") as test_client:
        yield test_client


@pytest.fixture()
def configure(client):
    """Override application settings for one test, undone afterwards.

    Via dependency_overrides rather than the environment: ``database`` has already called
    ``get_settings.cache_clear()`` by the time a test body runs, so a variable set there
    arrives too late to be read and then leaks into the next test.
    """
    from comptool.main import app

    def apply(**overrides):
        settings = get_settings().model_copy(update=overrides)
        app.dependency_overrides[get_settings] = lambda: settings
        return settings

    try:
        yield apply
    finally:
        # pop, not clear: other fixtures put their own overrides in this same dictionary.
        app.dependency_overrides.pop(get_settings, None)


class FakeResolver:
    """Stands in for the character lookup.

    Nothing resolves unless a test says so, which means a test that forgets to register a
    name gets a pending invitation rather than an accidental network call.
    """

    def __init__(self):
        from comptool.esi import Character, Resolution

        self._character = Character
        self._resolution = Resolution
        self._known: dict[str, tuple] = {}

    def knows(self, name: str, character_id: int, spelled: str | None = None) -> None:
        self._known[name.lower()] = (self._resolution.RESOLVED, character_id, spelled or name)

    def finds_several(self, name: str) -> None:
        self._known[name.lower()] = (self._resolution.AMBIGUOUS, None, None)

    def is_unreachable(self, name: str) -> None:
        self._known[name.lower()] = (self._resolution.UNAVAILABLE, None, None)

    def __call__(self, name: str):
        resolution, character_id, spelled = self._known.get(
            name.strip().lower(), (self._resolution.NOT_FOUND, None, None)
        )
        return self._character(resolution, character_id=character_id, name=spelled)


@pytest.fixture()
def resolver(client):
    """Route character-name lookups to a fake for the duration of one test."""
    from comptool.esi import get_character_resolver
    from comptool.main import app

    fake = FakeResolver()
    app.dependency_overrides[get_character_resolver] = lambda: fake
    try:
        yield fake
    finally:
        app.dependency_overrides.pop(get_character_resolver, None)


@pytest.fixture()
def sign_in(client):
    """Sign the test client in as a character.

    Mints a real session row and presents the real cookie, so routes are exercised through
    the same dependency a browser would go through — the difference from a live sign-in is
    only that EVE is not involved.
    """
    from comptool.auth import sessions

    def as_character(character_id: int, name: str = "Kadir") -> str:
        opened = get_session()
        db = next(opened)
        try:
            issued = sessions.mint(
                db,
                character_id=character_id,
                character_name=name,
                owner_hash="an-owner-hash",
                ttl_seconds=get_settings().session_ttl_seconds,
            )
            db.commit()
            token = issued.token
        finally:
            opened.close()
        client.cookies.set(sessions.COOKIE_NAME, token)
        return token

    try:
        yield as_character
    finally:
        client.cookies.clear()
