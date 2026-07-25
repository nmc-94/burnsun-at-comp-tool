"""The session store, and the cookie that names a row in it.

Sessions are opaque and server-side: the cookie carries a random token and nothing else,
so there is no signed payload to get wrong and revoking a session is a ``DELETE`` rather
than a hope that a token expires. Only the token's hash is stored, so the table is not a
list of usable credentials.

Expiry slides. Each use pushes it out again, which is what makes a long session pleasant
rather than a security posture: an abandoned browser still ages out on schedule.

No network here, and nothing about OAuth — this module would be the same if identity came
from somewhere else entirely.
"""

from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from fastapi import Response
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..models import AuthLoginAttempt, AuthSession
from ..settings import Settings
from .sso import PkceChallenge

#: Brand-neutral: a self-hoster rebrands the app without invalidating everyone's session,
#: and the name gives nothing away about what is inside.
COOKIE_NAME = "comptool_session"
COOKIE_PATH = "/"
#: Lax, not Strict or None. Lax is the entire CSRF defence for every write route here —
#: it stops a cross-site form POST carrying the cookie. Strict would additionally drop the
#: cookie when arriving from an outside link, which reads to a user as being signed out
#: at random, and buys nothing this app needs.
COOKIE_SAMESITE = "lax"

#: 256 bits. Enough that the stored hash needs no salt and no stretching: there is nothing
#: to guess and nothing for a precomputed table to hit.
TOKEN_BYTES = 32
#: How long a half-finished login stays claimable. Long enough to read the SSO's consent
#: screen, short enough that abandoned rows are a rounding error.
LOGIN_ATTEMPT_LIFETIME_SECONDS = 300


@dataclass(frozen=True)
class IssuedSession:
    """A new session and the token that names it.

    The raw token exists here and in the ``Set-Cookie`` header, and nowhere else — not in
    the database, and not in a log.
    """

    record: AuthSession
    token: str


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def mint(
    session: Session,
    *,
    character_id: int,
    character_name: str,
    owner_hash: str | None,
    ttl_seconds: int,
    now: datetime | None = None,
) -> IssuedSession:
    now = now or datetime.now(tz=UTC)
    token = secrets.token_urlsafe(TOKEN_BYTES)
    record = AuthSession(
        token_hash=hash_token(token),
        character_id=character_id,
        character_name=character_name,
        character_owner_hash=owner_hash,
        last_seen_at=now,
        expires_at=now + timedelta(seconds=ttl_seconds),
    )
    session.add(record)
    session.flush()
    return IssuedSession(record=record, token=token)


def load(session: Session, token: str, *, now: datetime | None = None) -> AuthSession | None:
    """The live session a cookie names, or ``None`` if it is unknown or has expired.

    Deliberately does not delete an expired row: this runs on every request, and a read
    that writes would put an ``UPDATE`` on the path of every page load. ``purge_expired``
    clears them out instead.
    """
    now = now or datetime.now(tz=UTC)
    record = session.scalar(select(AuthSession).where(AuthSession.token_hash == hash_token(token)))
    if record is None or record.expires_at <= now:
        return None
    return record


def renew(
    session: Session,
    record: AuthSession,
    *,
    ttl_seconds: int,
    renew_after_seconds: int = 0,
    now: datetime | None = None,
) -> bool:
    """Push the expiry out to ``now + ttl``. Returns whether anything changed.

    No column is needed to throttle this: the gap between the expiry a renewal *would*
    write and the one already stored is exactly how long ago the last renewal happened.
    """
    now = now or datetime.now(tz=UTC)
    target = now + timedelta(seconds=ttl_seconds)
    if renew_after_seconds > 0 and target - record.expires_at < timedelta(
        seconds=renew_after_seconds
    ):
        return False
    record.expires_at = target
    record.last_seen_at = now
    return True


def revoke(session: Session, record: AuthSession) -> None:
    session.delete(record)


def revoke_all_for_character(session: Session, character_id: int) -> int:
    """End every session this character holds, on every device.

    A bulk delete, which skips the ORM's cascade entirely — the stored refresh tokens go
    with it because the foreign key cascades in the database. That is why the constraint
    carries ``ondelete="CASCADE"`` and why it must keep it.
    """
    result = session.execute(
        delete(AuthSession).where(AuthSession.character_id == character_id),
        execution_options={"synchronize_session": False},
    )
    return result.rowcount or 0


def revoke_sessions_of_a_previous_owner(
    session: Session, character_id: int, owner_hash: str | None
) -> int:
    """Drop sessions opened before the character changed hands.

    The SSO's owner hash changes when a character is transferred to another account. Any
    session predating that belongs to the previous owner, and a long TTL is exactly the
    circumstance in which one would still be alive.
    """
    if owner_hash is None:
        return 0
    result = session.execute(
        delete(AuthSession).where(
            AuthSession.character_id == character_id,
            AuthSession.character_owner_hash.is_distinct_from(owner_hash),
        ),
        execution_options={"synchronize_session": False},
    )
    return result.rowcount or 0


def purge_expired(session: Session, *, now: datetime | None = None) -> int:
    """Housekeeping: dead sessions and abandoned logins.

    Run opportunistically when someone signs in rather than on a schedule — both deletes
    are indexed on the column they filter, and sign-ins are rare enough that this never
    shows up on a request anyone is waiting for.
    """
    now = now or datetime.now(tz=UTC)
    removed = 0
    for table in (AuthSession, AuthLoginAttempt):
        result = session.execute(
            delete(table).where(table.expires_at <= now),
            execution_options={"synchronize_session": False},
        )
        removed += result.rowcount or 0
    return removed


def start_attempt(
    session: Session,
    challenge: PkceChallenge,
    *,
    next_path: str,
    now: datetime | None = None,
) -> AuthLoginAttempt:
    now = now or datetime.now(tz=UTC)
    attempt = AuthLoginAttempt(
        state=challenge.state,
        code_verifier=challenge.code_verifier,
        next_path=next_path,
        expires_at=now + timedelta(seconds=LOGIN_ATTEMPT_LIFETIME_SECONDS),
    )
    session.add(attempt)
    session.flush()
    return attempt


def claim_attempt(
    session: Session, state: str, *, now: datetime | None = None
) -> AuthLoginAttempt | None:
    """Take the login this callback belongs to, and consume it.

    The row is deleted whether or not what follows succeeds, which is what makes a state
    single-use: a replayed callback finds nothing. Returns ``None`` for an unknown or
    stale state — the caller cannot tell those apart, and neither can an attacker.
    """
    now = now or datetime.now(tz=UTC)
    attempt = session.scalar(select(AuthLoginAttempt).where(AuthLoginAttempt.state == state))
    if attempt is None:
        return None
    session.delete(attempt)
    if attempt.expires_at <= now:
        return None
    return attempt


def set_session_cookie(response: Response, token: str, settings: Settings) -> None:
    """Attach the session cookie to whatever response is actually being returned.

    Note *whatever response is actually being returned*: a route that returns a Response
    object of its own does not inherit headers set on the injected one, so this has to be
    called on the object the route hands back.
    """
    response.set_cookie(
        COOKIE_NAME,
        token,
        # Persistent, not session-scoped: closing the browser should not sign anyone out.
        max_age=settings.session_ttl_seconds,
        path=COOKIE_PATH,
        domain=settings.session_cookie_domain or None,
        secure=settings.session_cookie_secure,
        httponly=True,
        samesite=COOKIE_SAMESITE,
    )


def clear_session_cookie(response: Response, settings: Settings) -> None:
    # Every attribute has to match the cookie that was set, or the browser will not
    # recognize this as the same cookie and will go on sending the dead one.
    response.delete_cookie(
        COOKIE_NAME,
        path=COOKIE_PATH,
        domain=settings.session_cookie_domain or None,
        secure=settings.session_cookie_secure,
        httponly=True,
        samesite=COOKIE_SAMESITE,
    )
