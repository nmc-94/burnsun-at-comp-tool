"""Signing in without EVE, for a browser nobody is driving by hand.

This is a back door. It exists for one reason: the real sign-in ends at a consent screen on
``login.eveonline.com``, which no headless browser can complete — so an end-to-end suite
could not get past the front page, and the only alternative was a ``docker exec`` one-liner
that minted a row and printed a token for a person to paste into a script.

What it bypasses, stated plainly: **the proof, and nothing else**. There is no verification
that the caller is the character they name, and no EVE token of any kind. What it does *not*
bypass is everything downstream — the row goes in through ``sessions.mint``, the cookie goes
out through ``sessions.set_session_cookie``, and from the next request onward
``optional_session``, ``current_viewer``, ``access.authorize`` and the permission resolver
cannot tell this session from one EVE issued. That is the point. A mock session would prove
the mock works; this proves the application does. ``sessions.py`` already said its module
would be the same if identity came from somewhere else entirely — this is that somewhere
else.

Three things keep it out of a deployment, and they are meant to be read together:

- ``Settings`` refuses to boot when ``dev_auth_enabled`` is set outside an environment that
  names itself a development one.
- The route re-checks the same thing per request, because ``Settings.model_copy`` — how the
  test suite overrides configuration — does not re-run validators, so without the second
  check the first one is a claim no test can make.
- Every outcome that is not a successful sign-in answers **404**, so no response ever
  confirms that this build carries a back door. See ``_refuse`` for why that trade runs the
  opposite way from ``routes._require_sso``'s 503.

What it does not solve on its own: a grant is asked for by name, and turning a name into an
id goes through ``comptool/esi.py`` and the public service a headless browser cannot reach
either. So a second character could be signed in and still not be given access to a team.
That is now answered by ``comptool/dev_resolve.py``, a sibling back door on the same terms —
which is what lets an end-to-end run prove the positive (grant a character, and they reach
the team) and not only the negative (a stranger reaches nothing).

Removing the feature is this file, its two lines in ``main.py``, its two settings and
validator in ``settings.py``, and one key in ``health.py``.
"""

from __future__ import annotations

import logging
import secrets
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from pydantic.alias_generators import to_camel
from sqlalchemy.orm import Session

from ..db import get_session
from ..settings import Settings, get_settings, is_development_environment
from . import sessions
from .routes import refresh_character_names

logger = logging.getLogger("comptool")

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

#: Where the secret travels. A header rather than the body, so the credential is not mixed
#: into the description of what is being asked for, and rather than the query string,
#: because a URL reaches browser history, proxy logs and the Referer header.
SECRET_HEADER = "x-comptool-dev-auth"


class _Model(BaseModel):
    # camelCase on the wire, like every other route here. Spelled out rather than imported
    # from routes.py: a back door that reaches into the module it is quarantined from is not
    # quarantined.
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


#: Capped at 200 because that is what ``AuthSession.character_name`` holds. Without the cap a
#: long name is a database error at commit — a 500 where a 422 belongs.
CharacterName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)
]


class DevSignIn(_Model):
    character_id: int = Field(ge=1)
    #: No default. Two characters is the interesting case, and a default name would quietly
    #: give them the same one.
    character_name: CharacterName


class DevSignedIn(_Model):
    """Shaped like ``/me``'s character, so a caller needs no second reader."""

    character_id: int
    character_name: str
    expires_at: datetime


def _refuse() -> HTTPException:
    """The one answer this route gives anyone who has not proved they may use it.

    404, not the 503 ``routes._require_sso`` uses, and the difference is deliberate. That
    comment says "nothing is being hidden", and for EVE SSO it is true — whether an
    application is configured is already public at ``/me``, and an operator debugging a
    deployment needs to tell "missing" from "not configured". Here the feature's *existence*
    is the exposure. A 503 reading "development sign-in is not configured" tells whoever
    asked that this build carries a back door and that it is one environment variable away
    from open. A 404 tells them nothing.

    Honest about what this does not achieve: it is *not* indistinguishable from a build
    without the route. This app answers 405 to a POST at an unregistered ``/api`` path,
    because the SPA catch-all matches the path and not the method. Answering 405 to look
    identical was considered and rejected — it would send a developer who mistyped a variable
    name hunting a routing bug. Saying nothing is the requirement; lying is not.

    What the 503 was protecting is served by the WARNING logged at each call site instead,
    which is also where a wrong secret is told apart from a route that is switched off.
    """
    return HTTPException(status_code=404, detail="Not found")


@router.post("/dev-login", response_model=DevSignedIn, include_in_schema=False)
def dev_login(
    body: DevSignIn,
    response: Response,
    secret: Annotated[str, Header(alias=SECRET_HEADER)] = "",
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> DevSignedIn:
    """Mint a session for the character named in the body. No EVE, no proof.

    POST rather than GET for two reasons that are not quite CSRF: this creates something, and
    a GET would put the credential somewhere it could be logged. SameSite=Lax is this app's
    entire CSRF defence and it does cover the route — a cross-site POST carries no cookie —
    but here the cookie is the *output*, so what actually matters is that no page can trigger
    this with an ``<img>`` tag or a bare navigation.

    Kept out of the OpenAPI document for the same reason the failures are 404s: a schema that
    lists a back door is the disclosure the 404 was avoiding.
    """
    if not settings.dev_auth_enabled:
        logger.warning("dev_login_disabled", extra={"event": "dev_login_disabled"})
        raise _refuse()
    if not is_development_environment(settings.environment):
        # Already refused at boot. Repeated here because Settings.model_copy does not re-run
        # validators, which is how the test suite overrides configuration — so this is the
        # only form of the guarantee a test can actually exercise.
        logger.warning(
            "dev_login_refused_environment",
            extra={"event": "dev_login_refused_environment", "environment": settings.environment},
        )
        raise _refuse()
    # Constant time, over bytes: compare_digest raises TypeError on a non-ASCII str, and a
    # secret with an accent in it must refuse the caller, not crash the server. The length is
    # not hidden and does not need to be — the floor is 32 characters.
    if not secrets.compare_digest(
        secret.encode("utf-8"), settings.dev_auth_secret.encode("utf-8")
    ):
        # The same 404 as a route that is switched off. Nothing about the attempt is
        # recorded: a character id here is somebody's guess, not an identity.
        logger.warning("dev_login_rejected", extra={"event": "dev_login_rejected"})
        raise _refuse()

    issued = sessions.mint(
        session,
        character_id=body.character_id,
        character_name=body.character_name,
        # No owner claim, because there was no SSO to make one. The honest value, and a
        # useful one twice over: `character_owner_hash IS NULL` lists every session this
        # route ever minted, and a later real sign-in as the same character revokes them,
        # because revoke_sessions_of_a_previous_owner already reads a null hash as a
        # different owner.
        owner_hash=None,
        ttl_seconds=settings.session_ttl_seconds,
    )
    # The same reconciliation a real sign-in does, for the same reason: this character has
    # just asserted an id and a name together. Not the no-op it once was — with
    # dev_resolve.py reading this same table, the row this writes is what a later grant by
    # name will find.
    refresh_character_names(session, body.character_id, body.character_name)
    session.commit()
    # Deliberately no purge_expired. /login runs one because it is rare and is the only thing
    # that creates login attempts; this creates none, an end-to-end run calls it many times
    # over, and a test that back-dates a row to observe expiry would rather the database were
    # not tidied underneath it.

    # WARNING, not the INFO the real login uses. A real sign-in is normal; this is an
    # identity minted without proof, and in this app WARNING goes to stderr — which is
    # exactly where you want to find it if one ever appears in a log you did not expect. The
    # token is not here and is not anywhere: it exists in IssuedSession and in the Set-Cookie
    # header, and nowhere else.
    logger.warning(
        "dev_login",
        extra={
            "event": "dev_login",
            "character_id": body.character_id,
            "environment": settings.environment,
        },
    )
    # On the *injected* response, which is correct here and would not be in the callback:
    # this route returns a model, so FastAPI builds the final response and merges these
    # headers into it. A route returning a Response of its own gets no such merge — the trap
    # named in routes.py's docstring and in sessions.set_session_cookie.
    sessions.set_session_cookie(response, issued.token, settings)
    return DevSignedIn(
        character_id=issued.record.character_id,
        character_name=issued.record.character_name,
        expires_at=issued.record.expires_at,
    )
