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

    with TestClient(app) as test_client:
        yield test_client
