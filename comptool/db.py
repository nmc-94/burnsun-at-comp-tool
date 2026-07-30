"""Database engine and session lifecycle.

A single module-level engine is created once from settings and reused. Request code
gets a session via the ``get_session`` FastAPI dependency. Migrations own all DDL in
every environment; the app never creates tables at runtime (tests do, from
``Base.metadata``).
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from .settings import Settings

_engine: Engine | None = None
_session_factory: sessionmaker[Session] | None = None


def normalize_url(url: str) -> str:
    """Route plain postgres URLs through psycopg (v3).

    Platforms and psql tooling emit ``postgresql://`` / ``postgres://``; SQLAlchemy
    would default those to psycopg2. We standardize on psycopg 3.
    """
    if url.startswith("postgresql+"):
        return url
    if url.startswith("postgresql://"):
        return "postgresql+psycopg://" + url[len("postgresql://") :]
    if url.startswith("postgres://"):
        return "postgresql+psycopg://" + url[len("postgres://") :]
    return url


def init_db(settings: Settings) -> None:
    """Create the engine and session factory once (idempotent)."""
    global _engine, _session_factory
    if _engine is not None:
        return
    _engine = create_engine(
        normalize_url(settings.database_url),
        pool_pre_ping=True,
        pool_size=settings.db_pool_size,
        max_overflow=settings.db_max_overflow,
        pool_recycle=settings.db_pool_recycle_seconds,
    )
    _session_factory = sessionmaker(bind=_engine, expire_on_commit=False)


def dispose_db() -> None:
    global _engine, _session_factory
    if _engine is not None:
        _engine.dispose()
    _engine = None
    _session_factory = None


def get_engine() -> Engine:
    if _engine is None:
        raise RuntimeError("Database engine is not initialized; call init_db() first.")
    return _engine


def get_session() -> Iterator[Session]:
    """FastAPI dependency: yield a session, always closing it afterward."""
    if _session_factory is None:
        raise RuntimeError("Database is not initialized; call init_db() first.")
    session = _session_factory()
    try:
        yield session
    finally:
        session.close()


@contextmanager
def session_scope() -> Iterator[Session]:
    """A session for work that is not one request, closed when the block ends.

    The dependency above is the right tool everywhere a route does its work and returns.
    This is for the one place that is not that shape: ``live.py``'s event stream holds its
    response open for minutes, and a ``yield`` dependency is not released until the response
    *finishes* — so asking for ``get_session`` there would pin a pooled connection per
    open stream, against a pool of ``db_pool_size + db_max_overflow``. That surfaces as the
    whole application failing to reach the database once enough people have a board open,
    which is a long way from where the mistake was made.

    Same factory and therefore the same ``expire_on_commit=False``; only the lifetime
    differs.
    """
    if _session_factory is None:
        raise RuntimeError("Database is not initialized; call init_db() first.")
    session = _session_factory()
    try:
        yield session
    finally:
        session.close()
