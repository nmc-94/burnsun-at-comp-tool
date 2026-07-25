"""Shared test fixtures.

The DB-backed fixtures need a reachable Postgres. They run against
``COMPTOOL_TEST_DATABASE_URL``, which defaults to a ``comptool_test`` database on the
Postgres ``docker compose up -d db`` publishes — deliberately *not* ``DATABASE_URL``, for
the reason spelled out in ``_guard_the_test_database`` below. Create it once with:

    docker exec at-comp-tool-db-1 createdb -U comptool comptool_test

Pure tests (settings, URL normalization, ingestion) need nothing: the snapshots below are
committed, so ingestion is tested offline and against the exact data that ships.
"""

from __future__ import annotations

import os
from datetime import UTC, datetime, timedelta
from pathlib import Path
from urllib.parse import urlsplit

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from comptool.db import dispose_db, get_engine, get_session, init_db
from comptool.ingest import points_csv, ruleset, sde
from comptool.models import Base
from comptool.settings import get_settings

#: Where the DB-backed tests run. Same server as the dev stack, different database.
DEFAULT_TEST_DATABASE_URL = "postgresql://comptool:comptool@localhost:5432/comptool_test"

#: A database name has to say it is disposable before anything here will drop its tables.
TEST_DATABASE_MARKERS = ("test", "scratch", "ci", "tmp")


def _guard_the_test_database() -> None:
    """Refuse to run the DB suite against a database that is not obviously disposable.

    The ``database`` fixture below drops every table, twice, for every test that touches
    the database. That is the right behaviour for a test schema and a catastrophe anywhere
    else, and nothing about running ``pytest`` announces which one it is pointed at.

    The setup makes the mistake easy rather than exotic. ``docker-compose.yml`` publishes
    the stack's Postgres on the host so local tooling can reach it, ``Settings`` defaults
    ``DATABASE_URL`` to that same host and database, and a ``.env`` file — which
    pydantic-settings reads — usually names the development database too. So the obvious
    invocation, ``pytest`` from the repo root with the stack up, aims the whole suite at
    the database somebody is actively using. It has happened; it emptied a dev database and
    left the app crash-looping, because ``alembic_version`` is not part of ``Base.metadata``
    and survives to tell the next migration there is nothing to do.

    Hence a name check rather than a comment. The suite reads its own environment variable,
    the default names a database that only exists to be dropped, and anything else has to
    say in its name that it is disposable.
    """
    url = os.environ.get("COMPTOOL_TEST_DATABASE_URL", DEFAULT_TEST_DATABASE_URL)
    name = urlsplit(url).path.lstrip("/")
    if not any(marker in name.lower() for marker in TEST_DATABASE_MARKERS):
        raise pytest.UsageError(
            f"Refusing to run the database suite against {name!r}: these tests drop every "
            f"table. Point COMPTOOL_TEST_DATABASE_URL at a disposable database whose name "
            f"contains one of {', '.join(TEST_DATABASE_MARKERS)} "
            f"(default: {DEFAULT_TEST_DATABASE_URL})."
        )
    # Set before any settings are read, so the app's own configuration cannot aim the
    # fixtures somewhere else.
    os.environ["DATABASE_URL"] = url
    os.environ["COMPTOOL_DATABASE_URL"] = url


def _ignore_the_developers_env_file() -> None:
    """Read configuration from this process's environment only, never from ``.env``.

    ``Settings`` loads a ``.env`` from the repo root, which is right for running the app
    and wrong for testing it: a developer who follows ``.env.example`` and turns off
    ``COMPTOOL_SESSION_COOKIE_SECURE`` for local http then fails the two tests asserting
    that the cookie is secure by default — a red suite reporting their configuration
    rather than the code. Any key in a ``.env`` is a test the suite might silently be
    answering from the wrong source.

    So the suite supplies its own environment and nothing else. Tests that need a setting
    say so explicitly, through the ``configure`` fixture or by constructing ``Settings``
    with arguments.
    """
    from comptool.settings import Settings

    Settings.model_config["env_file"] = None


_guard_the_test_database()
_ignore_the_developers_env_file()

REPO_ROOT = Path(__file__).resolve().parent.parent
SOURCES = REPO_ROOT / "docs" / "sources"
POINTS_CSV = SOURCES / "points-atxxii-2026-07-23.csv"
SHIP_INDEX = SOURCES / "ships-sde-3444265.json"
ENGINE_FIXTURE = REPO_ROOT / "web" / "src" / "engine" / "__fixtures__" / "atxxii-2026-07-23.json"

#: The label this snapshot publishes under — its capture date, as the CLI derives it.
VERSION_LABEL = "2026-07-23"

#: The slug the bundled ruleset publishes under.
RULESET_SLUG = "atxxii"

#: A ruleset payload small enough to read, shaped like the engine's ``Ruleset``. Nothing
#: on the server reads inside it — legality is the client's — so tests that only need a
#: version to bind a comp to use this rather than building the real one from the CSV.
STUB_PAYLOAD = {
    "version": VERSION_LABEL,
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


@pytest.fixture(scope="session")
def snapshot() -> points_csv.PointsSnapshot:
    return points_csv.parse(POINTS_CSV)


@pytest.fixture(scope="session")
def ship_index() -> sde.ShipIndex:
    return sde.load(SHIP_INDEX)


@pytest.fixture(scope="session")
def payload(snapshot, ship_index) -> dict:
    return ruleset.build(snapshot, ship_index, VERSION_LABEL)


def _unreachable(problem: OperationalError) -> str:
    """What to do about a database the suite cannot open.

    Raised in place of psycopg's traceback, which reports the failure accurately and says
    nothing about the fix. The test database is deliberately not the one the app uses, so
    "it does not exist" is the expected state of a fresh clone rather than a fault.
    """
    url = os.environ.get("COMPTOOL_TEST_DATABASE_URL", DEFAULT_TEST_DATABASE_URL)
    return (
        f"Cannot open the test database {_redacted(url)}.\n\n"
        f"It is deliberately separate from the one the app runs on, so a fresh clone has "
        f"to create it once:\n"
        f"    docker exec at-comp-tool-db-1 createdb -U comptool comptool_test\n\n"
        f"If Postgres is not running at all:\n"
        f"    docker compose up -d db\n\n"
        f"Underlying error: {problem.orig}"
    )


def _redacted(url: str) -> str:
    """The URL with any password removed, so a failure is quotable in a bug report."""
    parts = urlsplit(url)
    if not parts.password:
        return url
    return url.replace(f":{parts.password}@", ":***@", 1)


@pytest.fixture()
def database():
    """A clean schema for one test: create tables, yield, drop, dispose."""
    get_settings.cache_clear()
    init_db(get_settings())
    engine = get_engine()
    try:
        Base.metadata.drop_all(engine)
    except OperationalError as problem:
        # Only the first contact is wrapped. Once the connection is known good, a later
        # failure is a real one and deserves its own traceback rather than this advice.
        dispose_db()
        raise pytest.UsageError(_unreachable(problem)) from None
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
def publish(database):
    """Publish a ruleset version, the way seeding does, and hand back its label.

    Comps bind to a version, so anything that creates one needs a published ruleset first.
    Called again with a new label it adds a version to the same ruleset, which is how a
    test shows that an existing comp stays pinned to the older one.
    """
    from comptool.models import Ruleset, RulesetVersion

    def publish_version(version_label: str = VERSION_LABEL, *, slug: str = RULESET_SLUG) -> str:
        opened = get_session()
        db = next(opened)
        try:
            record = db.query(Ruleset).filter(Ruleset.slug == slug).one_or_none()
            if record is None:
                record = Ruleset(
                    slug=slug, name="Alliance Tournament XXII", organizer="Fenris Creations"
                )
                db.add(record)
            db.add(
                RulesetVersion(
                    ruleset=record,
                    version_label=version_label,
                    source_url="https://example.invalid/points.csv",
                    # Ordering is by fetched_at, so a later label has to look later too.
                    fetched_at=datetime(2026, 7, 23, tzinfo=UTC)
                    + timedelta(days=len(record.versions)),
                    payload={**STUB_PAYLOAD, "version": version_label},
                )
            )
            db.commit()
        finally:
            opened.close()
        return version_label

    return publish_version


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
