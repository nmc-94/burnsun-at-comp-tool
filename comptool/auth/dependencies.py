"""Turning a cookie into an identity, once per request.

Separate from the routes because every other router depends on these, and importing from a
module that also defines a router is how import cycles start.

A dependency rather than middleware, deliberately. Middleware cannot use ``Depends``, so it
could not reach a database session; it would also run on static assets and the SPA
fallback, where there is nothing to do. This runs exactly where an identity is wanted.
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime

from fastapi import Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from ..db import get_session
from ..models import AuthSession
from ..permissions import Viewer
from ..settings import Settings, get_settings
from . import sessions
from .sso import SsoClient


def optional_session(
    request: Request,
    response: Response,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> AuthSession | None:
    """The session this request carries, renewing it on the way past.

    FastAPI caches a dependency's result within a request, so this resolves once however
    many of the dependencies below a route asks for — which is what keeps the renewal to
    one write per request rather than one per dependency.
    """
    token = request.cookies.get(sessions.COOKIE_NAME)
    if not token:
        return None

    now = datetime.now(tz=UTC)
    record = sessions.load(session, token, now=now)
    if record is None:
        # The browser is holding something this server no longer honours. Clear it so it
        # stops presenting a dead credential on every subsequent request.
        sessions.clear_session_cookie(response, settings)
        return None

    renewed = sessions.renew(
        session,
        record,
        ttl_seconds=settings.session_ttl_seconds,
        renew_after_seconds=settings.session_renew_after_seconds,
        now=now,
    )
    if renewed:
        # Committed here rather than left to the route: get_session never commits and a
        # read-only route has no reason to, so an uncommitted renewal would be rolled
        # back at the end of the request and the session would not slide at all.
        session.commit()
        # Re-roll the cookie so its max-age moves with the row's expiry; otherwise the
        # browser forgets a session the server still considers live.
        sessions.set_session_cookie(response, token, settings)
    return record


def current_session(record: AuthSession | None = Depends(optional_session)) -> AuthSession:
    """The session, or a 401.

    401 rather than the 404 used for teams: hiding a resource is one thing, but the SPA
    has to be able to tell "sign in" from "gone", and "am I signed in" is not a secret.
    """
    if record is None:
        raise HTTPException(status_code=401, detail="Not signed in")
    return record


def current_viewer(record: AuthSession = Depends(current_session)) -> Viewer:
    """The identity a request acts as.

    Character only. Corporation and alliance grants would need public lookups the SSO
    token cannot supply, and both change over time; the resolver already treats an absent
    id as no match, so those grants sit inert rather than broken and switching them on
    later needs no migration.
    """
    return Viewer(character_id=record.character_id, character_name=record.character_name)


def optional_viewer(record: AuthSession | None = Depends(optional_session)) -> Viewer | None:
    if record is None:
        return None
    return Viewer(character_id=record.character_id, character_name=record.character_name)


def sso_client(settings: Settings = Depends(get_settings)) -> Iterator[SsoClient]:
    client = SsoClient(settings)
    try:
        yield client
    finally:
        client.close()
