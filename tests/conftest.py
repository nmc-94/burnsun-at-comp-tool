"""Shared test fixtures.

The DB-backed fixtures need a reachable Postgres (set ``DATABASE_URL``, or run
``docker compose up -d db``). Pure tests (settings, URL normalization) need nothing.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from comptool.db import dispose_db, get_engine, get_session, init_db
from comptool.models import Base
from comptool.settings import get_settings


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
