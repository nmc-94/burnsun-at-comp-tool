"""Public ESI: turning a character name into the id that access is matched on.

Access is granted by name, because a name is what a captain knows, but names change and
ids do not — so a grant stores both and matches on the id. This module is the one place
that turns the first into the second.

Every outcome other than a clean hit leaves the grant *pending*: a row that displays the
name and grants nothing. That is deliberate and load-bearing. Adding someone to a team
must never fail because a third-party service was slow, so the failure mode of this module
is "not resolved yet", never an error the caller has to handle.

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

from . import __version__
from .settings import Settings, get_settings

logger = logging.getLogger("comptool")

#: The public name-to-id endpoint. Unauthenticated, and it answers for several kinds of
#: entity at once — which is why the reader below is so narrow.
UNIVERSE_IDS_PATH = "/latest/universe/ids/"
DATASOURCE = "tranquility"
#: Short: a name lookup sits on a request path, and a pending grant is a fine answer.
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

    Only ``RESOLVED`` yields an id. Every other outcome is a reason to show the operator,
    not an error: the grant is still created, still visible, and simply grants nothing
    until the name resolves.
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
    # Read the id defensively rather than trusting the shape: this runs outside the
    # request's error handling, and the whole point of this module is that a lookup
    # leaves a grant pending instead of failing.
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


def get_character_resolver(settings: Settings = Depends(get_settings)) -> CharacterResolver:
    """The dependency routes take, so no route imports an HTTP client.

    Tests override this with a dictionary; nothing downstream can tell the difference,
    and no test can accidentally reach the network.
    """

    def resolve(name: str) -> Character:
        return resolve_character(name, settings)

    return resolve
