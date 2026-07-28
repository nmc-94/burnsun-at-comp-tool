"""Identity for a deployment with no EVE application: a name somebody claimed.

Two things live here, because the route in ``auth/local.py`` should contain no SQL and no rules
about names:

- :func:`claim` — the sign-in half. First person to type a name owns it; everybody after them
  *is* them.
- :func:`rename` — because a typo on first claim would otherwise be permanent, and the name is
  what a teammate is known by.

**Folding, and why it is a column.** Two names are the same name when they differ only by case
or by run-of-whitespace: ``"Sable  Kaneko"`` and ``"sable kaneko"`` are one person, and a tool
that made them two would hand somebody an empty account and no way to see why. The rule is
lifted verbatim from ``comps._canonical``, which settled it for tags — collapse, then fold —
and the fold is *stored* rather than expressed as an index for the reason that function and
``comp_share.slug`` both record: an expression index reflects back from Postgres with casts
the drift check cannot match.

**The spelling that survives is the first one.** Re-entering as ``sable`` shows as ``Sable``.
This mirrors ``esi.py`` returning EVE's own spelling rather than the operator's, and it is what
keeps a grant's ``subject_name`` agreeing with what its subject reads in their own account
menu. :func:`rename` is the only thing that moves it.

**A claimed name is not a proof, and here that is unbounded.** Nothing is presented to claim
one — signing in asks for a name and nothing else — so anybody who can reach the site can type
a name somebody already holds and become them, inheriting every team that principal belongs to.
This was a bounded hole when an instance-wide password stood in front of it; with sign-in open
it is bounded only by an attacker having to *know* a name to type.

Two consequences follow, and both are load-bearing rather than advisory:

- **No anonymous route may disclose a member's name.** None does today —
  ``share.SharedCompDetail`` carries a comp name, ruleset keys and hulls, and no person at all.
  Any new one is a security change, not a feature.
- **Claims are rate limited** in ``auth/local.py``, so a name cannot be harvested by guessing
  at speed.

The smallest fix, if this is ever judged too sharp, is one nullable password column here and
one field on two screens; ``auth/crypto.py:hash_password`` already exists for the team
passwords and would serve. Nothing in this module forecloses it.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .models import PRINCIPAL_SEQUENCE, LocalAccount

logger = logging.getLogger("comptool")


class NameTaken(RuntimeError):
    """Somebody else already holds the name a rename asked for.

    An exception rather than a returned ``None`` because :func:`rename` has exactly one
    failure and a caller that ignored it would silently keep the old name — which reads, to
    whoever pressed the button, as the feature not working.
    """


def collapse(value: str) -> str:
    """The name as it will be stored: ends trimmed, internal runs squeezed to one space."""
    return " ".join(value.split())


def fold(value: str) -> str:
    """The name as it will be *matched*. Never displayed — see the module docstring."""
    return collapse(value).casefold()


def claim(session: Session, display_name: str, *, now: datetime | None = None) -> LocalAccount:
    """The account this name belongs to, creating it if nobody has claimed it yet.

    Not "sign up" and not "sign in", because with a shared password there is no difference
    between them: the caller has already proved everything they are able to prove, and what is
    left is only to find out which row to act as.

    The insert races — two people claiming the same new name in the same second — and the race
    is settled by the unique index rather than by a lock, because the loser's correct outcome
    is to get the winner's row, which is exactly what re-selecting gives them. The sequence
    value the loser burned is not reused, and that costs nothing: they are not scarce and
    nothing counts them.
    """
    now = now or datetime.now(tz=UTC)
    wanted = collapse(display_name)
    folded = wanted.casefold()

    existing = _by_fold(session, folded)
    if existing is not None:
        existing.last_seen_at = now
        return existing

    # Read from the sequence rather than left to a column default: this database is checked
    # for drift with compare_server_default=True, and a nextval default reflects back in a
    # shape the check cannot match. Migration 0009 has the long version.
    principal_id = session.scalar(select(PRINCIPAL_SEQUENCE.next_value()))
    account = LocalAccount(
        principal_id=principal_id,
        display_name=wanted,
        name_folded=folded,
        last_seen_at=now,
    )
    try:
        # A savepoint, so a lost race does not poison the surrounding transaction — the route
        # still has a session cookie to mint and a name reconciliation to run after this.
        with session.begin_nested():
            session.add(account)
            session.flush()
    except IntegrityError:
        winner = _by_fold(session, folded)
        if winner is None:
            # Not the race, then: something else about this row is unacceptable, and
            # swallowing it would turn a schema problem into a mysterious sign-in failure.
            raise
        winner.last_seen_at = now
        return winner
    return account


def rename(session: Session, account: LocalAccount, new_name: str) -> LocalAccount:
    """Change what this principal is called. Raises :class:`NameTaken` if it is not free.

    Only the name moves. ``principal_id`` is what every team, grant, comp and layout in the
    database points at, so a rename cannot cost anybody their work — which is the whole reason
    a display name and an identity are two columns rather than one.

    A pure respelling — ``sable`` to ``Sable`` — is the interesting case, and it is handled
    first: the fold does not change, so the row would otherwise find *itself* in the way and
    refuse. That is the case somebody fixing their own capitalization is actually in.
    """
    wanted = collapse(new_name)
    folded = wanted.casefold()

    if folded == account.name_folded:
        account.display_name = wanted
        return account

    if _by_fold(session, folded) is not None:
        raise NameTaken(wanted)

    account.display_name = wanted
    account.name_folded = folded
    return account


def _by_fold(session: Session, folded: str) -> LocalAccount | None:
    return session.scalar(select(LocalAccount).where(LocalAccount.name_folded == folded))
