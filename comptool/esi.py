"""Public ESI: turning a character name into the id that access is matched on.

Access is granted by name, because a name is what a captain knows, but names change and
ids do not — so a grant stores both and matches on the id. This module is the one place
that turns the first into the second.

Every outcome other than a clean hit stops the grant being created. That used to go the
other way — the miss was stored as a "pending invitation" so that adding someone could not
fail because a third-party service was slow. It is not worth it. Such a row grants nobody
anything and never becomes able to, so what the leniency actually bought was an operator
being told their teammate was added when they were not. This module therefore reports
*why*, in four words the caller has to handle, and ``teams.add_grant`` turns each into a
sentence.

Only the SSO half of the app talks to ``login.eveonline.com``; this talks to the public,
unauthenticated API and needs no token.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass
from enum import StrEnum

import httpx
from fastapi import Depends
from sqlalchemy.orm import Session

from . import __version__
from .db import get_session
from .settings import Settings, get_settings, is_development_environment

logger = logging.getLogger("comptool")

#: The public name-to-id endpoint. Unauthenticated, and it answers for several kinds of
#: entity at once — which is why the reader below is so narrow.
UNIVERSE_IDS_PATH = "/latest/universe/ids/"
DATASOURCE = "tranquility"
#: Short: a name lookup sits on a request path an operator is waiting on, and "try again"
#: arriving in three seconds beats a correct answer arriving in thirty.
HTTP_TIMEOUT = httpx.Timeout(3.0, connect=2.0)


def user_agent(settings: Settings) -> str:
    """How this app identifies itself to CCP.

    They ask callers to be identifiable and contactable; an anonymous caller risks being
    throttled on everyone else's behalf.
    """
    contact = f"; {settings.esi_contact}" if settings.esi_contact else ""
    return f"comptool/{__version__} ({settings.brand_name}{contact})"


class Resolution(StrEnum):
    """What a lookup produced.

    Only ``RESOLVED`` yields an id. The other three are kept apart rather than collapsed
    into one failure because they ask the operator for three different things: fix the
    spelling, disambiguate, or wait a moment and retry.
    """

    RESOLVED = "resolved"
    NOT_FOUND = "not_found"
    AMBIGUOUS = "ambiguous"
    UNAVAILABLE = "unavailable"


@dataclass(frozen=True, slots=True)
class Character:
    resolution: Resolution
    character_id: int | None = None
    #: ESI's own spelling, which is authoritative — what the operator typed is not.
    name: str | None = None


def _read(payload: object, wanted: str) -> tuple[int, str] | None:
    """The single character match in an ESI response, if there is exactly one.

    Reads only the ``characters`` key. The endpoint also answers for corporations,
    alliances, systems and inventory types, and letting any of those through would put a
    non-character id into a grant that claims to name a character — access quietly
    handed to the wrong entity.
    """
    if not isinstance(payload, dict):
        return None
    matches = payload.get("characters")
    if not isinstance(matches, list):
        return None
    # ESI matches case-insensitively; keep only exact hits so "Kad" cannot stand in for
    # a longer name the operator did not mean.
    exact = [
        entry
        for entry in matches
        if isinstance(entry, dict) and str(entry.get("name", "")).lower() == wanted.lower()
    ]
    if len(exact) != 1:
        return None
    # Read the id defensively rather than trusting the shape: a body that is the right
    # JSON but the wrong shape must come back as NOT_FOUND, which the caller knows how to
    # phrase, rather than as a TypeError five frames up.
    entry = exact[0]
    identifier = entry.get("id")
    if not isinstance(identifier, int) or identifier <= 0:
        return None
    return identifier, str(entry.get("name"))


def resolve_character(
    name: str, settings: Settings, http: httpx.Client | None = None
) -> Character:
    """Look one character name up, reporting why if it did not resolve.

    ``http`` is injectable so this is testable without a network; callers in the app pass
    nothing and get a client per call, which is fine for an operator-paced action.
    """
    wanted = name.strip()
    if not wanted:
        return Character(Resolution.NOT_FOUND)
    if not settings.esi_enabled:
        # Nothing to call, and pretending otherwise would put a timeout on every grant.
        # This is now visible instead of silent: with lookups switched off every add is
        # refused with "cannot reach EVE", where it used to store a grant that resolved to
        # nothing and looked like a success. That difference is not hypothetical — a
        # server started without this setting is exactly how the pending state came to be
        # mistaken for "waiting for them to log in".
        return Character(Resolution.UNAVAILABLE)

    url = f"{settings.esi_api_base_url}{UNIVERSE_IDS_PATH}"
    headers = {"User-Agent": user_agent(settings)}
    try:
        if http is None:
            with httpx.Client(timeout=HTTP_TIMEOUT) as client:
                response = client.post(
                    url, json=[wanted], params={"datasource": DATASOURCE}, headers=headers
                )
        else:
            response = http.post(
                url, json=[wanted], params={"datasource": DATASOURCE}, headers=headers
            )
        response.raise_for_status()
        payload = response.json()
    except (httpx.HTTPError, ValueError):
        # Including a non-2xx, a timeout and a body that is not JSON. All of them mean
        # the same thing to the caller: ask again later.
        logger.warning(
            "character_lookup_failed", extra={"event": "character_lookup_failed"}, exc_info=True
        )
        return Character(Resolution.UNAVAILABLE)

    match = _read(payload, wanted)
    if match is None:
        matches = payload.get("characters") if isinstance(payload, dict) else None
        if isinstance(matches, list) and len(matches) > 1:
            return Character(Resolution.AMBIGUOUS)
        return Character(Resolution.NOT_FOUND)
    character_id, canonical = match
    return Character(Resolution.RESOLVED, character_id=character_id, name=canonical)


#: What a route depends on: a name goes in, an outcome comes out.
CharacterResolver = Callable[[str], Character]


def get_character_resolver(
    settings: Settings = Depends(get_settings),
    session: Session = Depends(get_session),
) -> CharacterResolver:
    """The dependency routes take, so no route imports an HTTP client.

    Tests override this with a dictionary; nothing downstream can tell the difference,
    and no test can accidentally reach the network.

    The development branch is a back door and is documented as one in
    ``comptool/dev_resolve.py``. It is chosen here rather than inside ``resolve_character``
    so that the one function which talks to CCP has no idea the alternative exists, and so
    that swapping it is a decision made once, per request, in the open.

    There is deliberately **no local-accounts branch**. One existed briefly, when a grant under
    that mode was still made by typing a name; it is gone because the mode no longer resolves
    names at all. ``teams.add_grant`` refuses outright there and points at the team's join link,
    which needs no lookup — the person joining supplies their own identity. So this function
    serves EVE deployments and their offline stand-in, and nothing else.
    """
    if settings.dev_resolve_enabled and is_development_environment(settings.environment):
        # Both conditions re-checked here rather than trusted from boot: Settings
        # .model_copy does not re-run validators, which is how the test suite overrides
        # configuration, so the boot-time refusal is a guarantee no test can exercise.
        # Same argument, at length, in comptool/auth/dev.py.
        # Imported here, not at module scope: dev_resolve builds this module's Character
        # and Resolution, so the dependency only runs one way if this end is deferred.
        from .dev_resolve import resolve_from_sessions

        def resolve_dev(name: str) -> Character:
            return resolve_from_sessions(name, session)

        return resolve_dev

    def resolve(name: str) -> Character:
        return resolve_character(name, settings)

    return resolve
