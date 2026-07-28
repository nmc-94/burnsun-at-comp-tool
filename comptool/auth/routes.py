"""Signing in, signing out, and saying who is signed in.

The shape of the flow: ``/login`` sends the browser to EVE with a challenge only this
server can answer, ``/callback`` answers it and hands back a cookie. The tokens themselves
never reach the browser — it holds an opaque session cookie and nothing else.

Two mechanical rules run through this module, both of them easy to get wrong silently:
a route that returns a Response of its own must set its cookie on *that* object, because
the injected response's headers are not merged into it; and anything derived from the
query string is untrusted, which is why ``next`` is reduced to a relative path before it is
allowed anywhere near a redirect.
"""

from __future__ import annotations

import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel
from sqlalchemy import or_, update
from sqlalchemy.orm import Session

from ..db import get_session
from ..models import AuthEsiToken, AuthSession, SubjectKind, Team, TeamGrant
from ..settings import Settings, SignInMode, get_settings
from . import crypto, sessions
from .dependencies import current_session, optional_session, sso_client
from .sso import SsoClient, SsoError, start_login

logger = logging.getLogger("comptool")

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


class _Response(BaseModel):
    # camelCase on the wire: the SPA is the only consumer.
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class CurrentCharacter(_Response):
    character_id: int
    character_name: str
    #: When this session lapses if it goes unused. It moves on every request.
    expires_at: datetime


class SignedIn(_Response):
    #: Which door this deployment opens: ``sso``, ``password``, or ``none`` when it has
    #: neither configured. The SPA draws a different screen for each, and cannot find out any
    #: other way — a sign-in button that could only ever 503 is worse than no button.
    #:
    #: One field rather than a flag per mode, because the two cannot both be on: a deployment
    #: configured for both refuses to boot (``settings._check_password_auth_configuration``),
    #: and a pair of booleans would still be able to spell the state that cannot exist. The
    #: same argument ``models.TeamGrant`` makes about ``subject_id``.
    sign_in: SignInMode
    #: Null when nobody is signed in — which is an answer, not an error.
    character: CurrentCharacter | None


def _safe_next(raw: str | None) -> str:
    """Reduce a caller-supplied destination to somewhere on this site.

    Anything else and ``/login`` becomes an open redirect: a link that looks like this
    application and lands on someone else's, which is exactly the shape of a phishing
    page for the credentials this route exists to collect.
    """
    if not raw or not raw.startswith("/") or raw.startswith("//"):
        return "/"
    return raw


def _destination(settings: Settings, next_path: str, error: str | None = None) -> str:
    base = settings.esi_post_login_url.rstrip("/")
    suffix = f"?authError={error}" if error else ""
    return f"{base}{next_path}{suffix}"


def _require_sso(settings: Settings) -> None:
    if not settings.esi_enabled:
        # Not a 404: nothing is being hidden, and an operator debugging a deployment
        # deserves to be told the difference between "missing" and "not configured".
        raise HTTPException(status_code=503, detail="EVE SSO is not configured")


def refresh_character_names(session: Session, character_id: int, character_name: str) -> None:
    """Keep every name stored beside this character's id current.

    Grants are entered by name and matched by id, so a rename leaves the stored name
    stale. The signed-in character has just proved both, which makes this the cheapest
    possible moment to reconcile them — and it needs no lookup service at all.

    Two places hold such a name. Grants hold ``subject_name``, and a team holds
    ``owner_character_name`` — ownership is a column rather than a grant row, so the owner
    is not in the first sweep and would otherwise never be reconciled at all.

    The team half doubles as the backfill for 0007, which had no honest value to write:
    ``!=`` does not match NULL in SQL, so the null case is spelled out rather than left to
    it. A team whose owner has not signed in since the migration keeps its null, and the
    UI says "The team owner" until they do.

    Public because there are now two sign-in paths and both owe this: the callback below,
    and the development sign-in in ``dev.py``.
    """
    session.execute(
        update(TeamGrant)
        .where(
            TeamGrant.subject_kind == SubjectKind.CHARACTER,
            TeamGrant.subject_id == character_id,
            TeamGrant.subject_name != character_name,
        )
        .values(subject_name=character_name)
    )
    session.execute(
        update(Team)
        .where(
            Team.owner_character_id == character_id,
            or_(
                Team.owner_character_name.is_(None),
                Team.owner_character_name != character_name,
            ),
        )
        .values(owner_character_name=character_name)
    )


@router.get("/login", include_in_schema=True)
def login(
    next_path: str = Query("/", alias="next"),
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    client: SsoClient = Depends(sso_client),
) -> RedirectResponse:
    """Start a sign-in.

    Must be reached by a top-level navigation, not by fetch: the response redirects to
    another origin's consent page, which a background request cannot follow.
    """
    _require_sso(settings)

    # Cheap housekeeping on a rare path, so abandoned logins and dead sessions never need
    # a scheduled job.
    sessions.purge_expired(session)
    challenge = start_login()
    sessions.start_attempt(session, challenge, next_path=_safe_next(next_path))
    session.commit()

    return RedirectResponse(client.authorize_url(challenge), status_code=302)


@router.get("/callback", include_in_schema=True)
def callback(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    client: SsoClient = Depends(sso_client),
) -> RedirectResponse:
    """Finish a sign-in.

    Every failure here redirects back to the app carrying a reason, rather than rendering
    a JSON error: this is a browser navigation, and a raw error body is a dead end for
    whoever is looking at it. The detail goes to the log instead.
    """
    _require_sso(settings)

    if error or not code or not state:
        # The person declined at EVE's consent screen, or the callback is malformed.
        logger.info("login_abandoned", extra={"event": "login_abandoned", "reason": error})
        return RedirectResponse(_destination(settings, "/", "denied"), status_code=302)

    # Claimed — and deleted — before the exchange, so a state is spent whether or not what
    # follows succeeds and a replayed callback finds nothing.
    attempt = sessions.claim_attempt(session, state)
    if attempt is None:
        session.commit()
        logger.warning("login_state_rejected", extra={"event": "login_state_rejected"})
        return RedirectResponse(_destination(settings, "/", "state"), status_code=302)

    next_path = attempt.next_path
    verifier = attempt.code_verifier
    session.commit()

    try:
        grant = client.exchange_code(code, verifier)
        identity = client.identity(grant.access_token)
    except SsoError:
        logger.warning(
            "login_exchange_failed", extra={"event": "login_exchange_failed"}, exc_info=True
        )
        return RedirectResponse(_destination(settings, "/", "exchange"), status_code=302)

    # A character that has changed hands takes its old sessions with it; with a 30-day
    # window one could easily still be alive.
    sessions.revoke_sessions_of_a_previous_owner(
        session, identity.character_id, identity.owner_hash
    )
    issued = sessions.mint(
        session,
        character_id=identity.character_id,
        character_name=identity.name,
        owner_hash=identity.owner_hash,
        ttl_seconds=settings.session_ttl_seconds,
    )
    if grant.refresh_token:
        session.add(
            AuthEsiToken(
                session_id=issued.record.id,
                refresh_token_encrypted=crypto.encrypt(
                    grant.refresh_token, settings.esi_token_secret
                ),
            )
        )
    refresh_character_names(session, identity.character_id, identity.name)
    session.commit()

    logger.info(
        "login",
        extra={"event": "login", "character_id": identity.character_id},
    )
    response = RedirectResponse(_destination(settings, next_path), status_code=302)
    # On the returned response, not the injected one: a Response a route hands back does
    # not inherit headers set on the dependency-injected one.
    sessions.set_session_cookie(response, issued.token, settings)
    return response


@router.get("/me", response_model=SignedIn)
def me(
    response: Response,
    record: AuthSession | None = Depends(optional_session),
    settings: Settings = Depends(get_settings),
) -> SignedIn:
    """Who is signed in, if anyone.

    Answers 200 either way. The SPA calls this once on boot, and "nobody" is a perfectly
    good answer to that question — a 401 would make an anonymous page load look like a
    failure. It also reports *how* signing in works here, which an anonymous client needs in
    order to draw anything at all and cannot find out any other way.

    Answers for both doors, and knows about neither. The character on a password session was
    minted by ``auth/local.py`` and reads back through the same ``optional_session``; all
    this route contributes is the mode, which it takes off settings.
    """
    response.headers["Cache-Control"] = "no-store"
    character = (
        CurrentCharacter(
            character_id=record.character_id,
            character_name=record.character_name,
            expires_at=record.expires_at,
        )
        if record is not None
        else None
    )
    return SignedIn(sign_in=settings.sign_in_mode, character=character)


@router.post("/logout", status_code=204)
def logout(
    record: AuthSession | None = Depends(optional_session),
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> Response:
    """End this session. Idempotent, and never a 401.

    Signing out when already signed out is what a stale tab does, and answering it with
    an error would leave that tab holding a cookie it cannot get rid of.
    """
    if record is not None:
        sessions.revoke(session, record)
        session.commit()
    response = Response(status_code=204)
    sessions.clear_session_cookie(response, settings)
    return response


@router.post("/logout-all", status_code=204)
def logout_everywhere(
    record: AuthSession = Depends(current_session),
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> Response:
    """End every session this character holds, on every device.

    The counterweight to a 30-day window: a session left open on someone else's machine
    can be ended from anywhere, without waiting for it to lapse.
    """
    ended = sessions.revoke_all_for_character(session, record.character_id)
    session.commit()
    logger.info(
        "logout_everywhere",
        extra={"event": "logout_everywhere", "character_id": record.character_id, "ended": ended},
    )
    response = Response(status_code=204)
    sessions.clear_session_cookie(response, settings)
    return response
