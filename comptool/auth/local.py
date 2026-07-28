"""Signing in without EVE: claiming a name, and changing the one you claimed.

The other door. ``routes.py`` sends a browser to EVE and trusts what comes back; this asks what
to call you and takes your word for it. What it bypasses is **the identity provider, not the
session**: the row goes in through ``sessions.mint``, the cookie goes out through
``sessions.set_session_cookie``, and from the next request onward ``optional_session``,
``current_viewer``, ``access.authorize`` and the permission resolver cannot tell this session
from one EVE issued. ``sessions.py`` said its module would be the same if identity came from
somewhere else entirely; this is that somewhere else, and unlike ``dev.py`` it is meant for a
deployment.

**There is no credential here, and that is the design rather than an omission.** The secrets in
this mode belong to *teams* — a join link and its password, in ``comptool/join.py`` — and to the
environment, where ``COMPTOOL_TEAM_CREATION_KEY`` decides who may make a team at all. Neither is
a sign-in credential, and an earlier draft of this feature put a password here instead: an
instance-wide one, in an environment variable, which meant only whoever held deploy access could
change it and rotating it to remove one person signed out everybody. Moving the credential to
the team moved it to the person who should hold it.

**What that costs, stated plainly because it is the sharpest edge in the product.** Anybody who
can reach this route can claim any name, including one somebody already holds, and inherit every
team that principal belongs to. Nothing is presented and nothing is checked. It was a bounded
hole when an instance password stood in front of it; now it is bounded only by an attacker
having to know a name to type — which is why ``local_accounts.py`` records that no anonymous
route may disclose a member's name, and why claims are rate limited below.

**This is not ``dev.py``.** They look alike, and the differences all run one way: that one
answers 404 to everything because its existence is the exposure, refuses to run outside a
development environment, and logs a success at WARNING because an identity minted without proof
is not normal there. Here it is the only normal way in.

Removing the feature is this file, ``comptool/local_accounts.py``, ``comptool/join.py``, their
lines in ``main.py``, two settings and a validator in ``settings.py``, and migrations 0009/0010.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, StringConstraints
from pydantic.alias_generators import to_camel
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from .. import local_accounts
from ..db import get_session
from ..local_accounts import NameTaken
from ..models import AuthSession, LocalAccount
from ..ratelimit import FixedWindow, caller_of
from ..settings import Settings, SignInMode, get_settings
from . import sessions
from .dependencies import current_session
from .routes import refresh_character_names

logger = logging.getLogger("comptool")

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

#: How many identities one caller may mint in a window.
#:
#: A *rate* limit, not a failure count, and the difference is why this lives in memory here
#: rather than in the database beside the join route's throttle. Nothing at this door can fail —
#: every name is accepted — so there are no failures to count. What is worth slowing is bulk
#: claiming: somebody guessing at names to find one that already exists, or squatting a hundred
#: plausible ones. Ten is far above what a person does (claim once, plus a few reloads after a
#: typo) and far below what a script wants.
CLAIM_LIMIT = 10
CLAIM_WINDOW_SECONDS = 300

_claims = FixedWindow(
    limit=CLAIM_LIMIT,
    window_seconds=CLAIM_WINDOW_SECONDS,
    detail="Too many sign-ins from here; wait a few minutes and try again.",
)


def reset_rate_limit() -> None:
    """Tests only, like ``share.reset_rate_limit``."""
    _claims.reset()


class _Model(BaseModel):
    # camelCase on the wire, like every other route here. Spelled out rather than imported
    # from routes.py, for the reason dev.py gives: a module that reaches into the one it sits
    # beside has not been kept separable from it.
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


#: Trimmed before it is measured, so a name of nothing but spaces is refused rather than
#: stored as an empty string. 200 is what ``local_account.display_name`` holds; without the cap
#: a long name is a database error at commit — a 500 where a 422 belongs.
DisplayName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)
]


class ClaimName(_Model):
    display_name: DisplayName


class SignedInLocally(_Model):
    """Shaped like ``/me``'s character, so a caller needs no second reader."""

    character_id: int
    character_name: str
    expires_at: datetime


def _require_local_auth(settings: Settings) -> None:
    if settings.sign_in_mode is not SignInMode.LOCAL:
        # A 503 like ``routes._require_sso``, and pointedly not ``dev.py``'s 404: nothing is
        # hidden here, and an operator debugging a deployment deserves to be told the
        # difference between "missing" and "not configured".
        raise HTTPException(status_code=503, detail="Local sign-in is not configured")


@router.post("/name", response_model=SignedInLocally)
def claim_name(
    body: ClaimName,
    request: Request,
    response: Response,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> SignedInLocally:
    """Say what to call you, and be signed in as that.

    POST rather than GET because it creates something — a session, and possibly an account.
    SameSite=Lax is this app's whole CSRF defence and it does cover the route (a cross-site POST
    carries no cookie), but here the cookie is the *output*, so what actually matters is that no
    page can trigger this with an ``<img>`` tag or a bare navigation.
    """
    _require_local_auth(settings)
    _claims.check(caller_of(request))

    now = datetime.now(tz=UTC)
    account = local_accounts.claim(session, body.display_name, now=now)
    issued = sessions.mint(
        session,
        character_id=account.principal_id,
        character_name=account.display_name,
        # No owner claim, because there was no SSO to make one — and unlike a character, a
        # local principal cannot change hands, so there is nothing an owner hash would ever
        # detect. revoke_sessions_of_a_previous_owner returns 0 on a null hash and stays inert.
        owner_hash=None,
        ttl_seconds=settings.session_ttl_seconds,
    )
    # Cheap housekeeping on a human-paced path, the way /login does it. dev.py deliberately
    # does not, because an end-to-end run calls it hundreds of times.
    sessions.purge_expired(session)
    # The same reconciliation both other sign-in paths do, and for the same reason: this
    # principal has just asserted an id and a name together. A no-op until somebody renames
    # themselves, at which point it is the thing that keeps every grant naming them correctly.
    refresh_character_names(session, account.principal_id, account.display_name)
    session.commit()

    logger.info(
        "name_claimed",
        extra={"event": "name_claimed", "character_id": account.principal_id},
    )
    # On the *injected* response, which is correct here and would not be in the SSO callback:
    # this route returns a model, so FastAPI builds the final response and merges these headers
    # into it. A route returning a Response of its own gets no such merge — the trap named in
    # routes.py's docstring and in sessions.set_session_cookie.
    sessions.set_session_cookie(response, issued.token, settings)
    return SignedInLocally(
        character_id=issued.record.character_id,
        character_name=issued.record.character_name,
        expires_at=issued.record.expires_at,
    )


@router.patch("/me", response_model=SignedInLocally)
def rename_me(
    body: ClaimName,
    record: AuthSession = Depends(current_session),
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> SignedInLocally:
    """Change what this instance calls you.

    Here rather than in ``routes.py`` beside ``GET /me``, so the whole of the mode-specific
    surface is in one file and removing the feature is a file plus a line — the same quarantine
    ``dev.py`` keeps.

    It exists because without it a typo on first claim is permanent: the misspelling is what
    teammates know you by, and the name you meant is not free to re-claim if the typo was close.
    Only the name moves — ``principal_id`` is what every team, grant, comp and layout points at
    — so nobody loses work by fixing it.
    """
    _require_local_auth(settings)

    account = session.scalar(
        select(LocalAccount).where(LocalAccount.principal_id == record.character_id)
    )
    if account is None:
        # A session with no local account behind it, on an instance that only mints local
        # accounts. In practice a session that outlived the table — a database restored without
        # it, or a mode switched under a live cookie. 409 rather than 404: the route is real and
        # the caller is signed in; what is missing is the thing being renamed.
        raise HTTPException(
            status_code=409, detail="This session has no local account to rename."
        )

    try:
        local_accounts.rename(session, account, body.display_name)
    except NameTaken:
        raise HTTPException(
            status_code=409,
            detail=f"Somebody here is already called {body.display_name!r}.",
        ) from None

    # Three places hold this name, and all three have to move together or the rename is visible
    # in some parts of the UI and not others.
    #
    # First: every session this principal has open, on every device, because ``/me`` reads the
    # name off the session row rather than off the account — which is what keeps the hot path
    # to one query.
    session.execute(
        update(AuthSession)
        .where(AuthSession.character_id == account.principal_id)
        .values(character_name=account.display_name),
        execution_options={"synchronize_session": False},
    )
    # Then the grants and the owned teams. This is the call ``refresh_character_names`` was
    # written for; on the sign-in paths it is a no-op guarding against a rename that happened
    # elsewhere, and here it is the rename.
    refresh_character_names(session, account.principal_id, account.display_name)
    session.commit()

    logger.info(
        "local_account_renamed",
        extra={"event": "local_account_renamed", "character_id": account.principal_id},
    )
    return SignedInLocally(
        character_id=account.principal_id,
        character_name=account.display_name,
        expires_at=record.expires_at,
    )
