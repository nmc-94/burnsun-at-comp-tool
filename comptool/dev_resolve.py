"""Turning a name into a character id without EVE, for a browser nobody is driving by hand.

The second back door, and the sibling of ``comptool/auth/dev.py``. That module's docstring
names what it deliberately did *not* solve:

    a grant is written by name, and turning a name into an id still goes through
    ``comptool/esi.py`` and the public service a headless browser cannot reach either. So a
    second character can be signed in, but cannot be given access to a team.

This is that hole. It mattered more once ``teams.add_grant`` began *refusing* a name it
could not resolve: before, an end-to-end run could at least create the row and inspect it,
and now an offline run cannot add anybody at all. So the whole point of an access list —
grant a character, and watch that character reach the team — was the one thing the suite
could never prove.

**What it bypasses: the lookup, and nothing else.** It does not mint sessions, does not
touch permissions, and does not make a grant that behaves differently in any way. The row
it produces is written by ``add_grant`` down the same path with the same duplicate checks;
what changes is only where the id came from.

**Where the ids come from, and why that is the honest choice.** ``auth_session`` — the most
recent sign-in whose ``character_name`` matches. Not a hash of the name, which would resolve
anything and prove nothing, and not a fixture table, which would drift. A character can be
granted access here only if that character has actually signed in, which is exactly the
population a test can then sign in *as* and assert against. The failure modes come out real
too: a name nobody has ever used is ``NOT_FOUND``, and two characters sharing a name are
``AMBIGUOUS``, so the refusal paths are exercised by the same mechanism rather than mocked.

Two things keep it out of a deployment, and they are the two that guard the sign-in:

- ``Settings`` refuses to boot when ``dev_resolve_enabled`` is set outside an environment
  that names itself a development one.
- ``get_character_resolver`` re-checks the same thing per request, because
  ``Settings.model_copy`` — how the test suite overrides configuration — does not re-run
  validators, so without the second check the first one is a claim no test can make.

There is deliberately no secret. ``dev-login`` needs one because it hands out identities to
whoever calls it; this hands out nothing and is reachable only through a route that already
requires being a team's owner. A secret here would suggest the guard is the secret, when the
guard is the environment.

Removing the feature is this file, its branch in ``esi.get_character_resolver``, its setting
and validator in ``settings.py``, and one key in ``health.py``.
"""

from __future__ import annotations

import logging

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .esi import Character, Resolution
from .models import AuthSession

logger = logging.getLogger("comptool")


def resolve_from_sessions(name: str, session: Session) -> Character:
    """The most recently signed-in character with this name, or why there was not one.

    Case-insensitive to match ESI, which resolves ``"john liwang"`` to ``John LiWang`` and
    returns its own spelling — so this returns the stored name rather than the typed one,
    and a test can assert the canonicalization that the real resolver performs.
    """
    wanted = name.strip()
    if not wanted:
        return Character(Resolution.NOT_FOUND)

    # Distinct ids, not distinct rows: one character with four browsers open is one
    # character, and counting sessions would call them ambiguous.
    matched = (
        session.execute(
            select(AuthSession.character_id, func.max(AuthSession.character_name))
            .where(func.lower(AuthSession.character_name) == wanted.lower())
            .group_by(AuthSession.character_id)
            .limit(2)
        )
        .tuples()
        .all()
    )
    if not matched:
        return Character(Resolution.NOT_FOUND)
    if len(matched) > 1:
        # Impossible in EVE, reachable here: ``dev-login`` takes an id and a name from the
        # caller and does not check that the pairing is one anybody has seen before.
        return Character(Resolution.AMBIGUOUS)

    character_id, canonical = matched[0]
    logger.warning(
        "dev_resolve",
        extra={"event": "dev_resolve", "character_id": character_id},
    )
    return Character(Resolution.RESOLVED, character_id=character_id, name=canonical)
