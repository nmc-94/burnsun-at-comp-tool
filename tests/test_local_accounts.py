"""Claiming a name, keeping it, and finding it again.

Unit-level, against a session rather than a client: the route in ``auth/local.py`` has its
own file, and these are the rules about *names* that it is not allowed to contain.

What they pin, in order of how expensive each would be to get wrong:

- The fold. Two spellings that differ only by case or whitespace are one person, and a tool
  that made them two hands somebody an empty account with no clue why.
- The first spelling wins. A grant lists the name its subject sees, forever after.
- The principal id is negative. That is the single assumption the rest of the schema was
  spared a migration by, and it is worth a test that fails loudly if it ever stops holding.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from comptool.local_accounts import NameTaken, claim, fold, rename
from comptool.models import LocalAccount


def test_folding_collapses_case_and_whitespace_together():
    # The rule is lifted from comps._canonical, which settled it for tags. Both halves matter:
    # case alone would still split "Sable  Kaneko" from "Sable Kaneko".
    assert fold("  Sable   Kaneko ") == fold("sable kaneko") == "sable kaneko"


def test_a_first_claim_mints_a_negative_principal(session):
    account = claim(session, "Sable Kaneko")
    session.commit()

    # The whole reason no existing table needed a migration. EVE's ids are positive; a local
    # principal lives in the half of the column the game never fills.
    assert account.principal_id < 0
    assert account.display_name == "Sable Kaneko"
    assert account.name_folded == "sable kaneko"


def test_claiming_the_same_name_again_is_the_same_person(session):
    first = claim(session, "Sable Kaneko")
    session.commit()

    again = claim(session, "  sable   KANEKO ")
    session.commit()

    assert again.principal_id == first.principal_id
    assert len(session.scalars(select(LocalAccount)).all()) == 1


def test_the_first_spelling_is_the_one_that_survives(session):
    claim(session, "Sable Kaneko")
    session.commit()

    again = claim(session, "sable kaneko")
    session.commit()

    # The same canonicalization ESI performs, and for the same reason: a grant added as
    # "sable kaneko" has to list as what its subject reads in their own account menu.
    assert again.display_name == "Sable Kaneko"


def test_two_names_are_two_principals(session):
    one = claim(session, "Sable Kaneko")
    two = claim(session, "Kadir")
    session.commit()

    assert one.principal_id != two.principal_id
    assert one.principal_id < 0 and two.principal_id < 0


def test_claiming_moves_last_seen(session):
    first = claim(session, "Sable Kaneko")
    session.commit()
    was = first.last_seen_at

    again = claim(session, "Sable Kaneko")
    session.commit()

    assert again.last_seen_at >= was


def test_renaming_keeps_the_principal(session):
    account = claim(session, "Sabel Kaneko")
    session.commit()
    principal = account.principal_id

    rename(session, account, "Sable Kaneko")
    session.commit()

    # The point of the whole route: a typo costs a name, never the teams hanging off the id.
    assert account.principal_id == principal
    assert account.display_name == "Sable Kaneko"
    assert account.name_folded == "sable kaneko"


def test_respelling_yourself_is_not_a_collision(session):
    account = claim(session, "sable kaneko")
    session.commit()

    # The case somebody fixing their own capitalization is actually in. Without the same-fold
    # branch the row would find *itself* in the way and refuse.
    rename(session, account, "Sable Kaneko")
    session.commit()

    assert account.display_name == "Sable Kaneko"


def test_renaming_onto_somebody_else_is_refused(session):
    claim(session, "Kadir")
    mine = claim(session, "Sable Kaneko")
    session.commit()

    with pytest.raises(NameTaken):
        rename(session, mine, "kadir")


def test_a_name_is_not_a_proof(session):
    """The model's sharpest edge, pinned so it cannot be softened by accident.

    Claiming a name somebody already holds returns *their* principal, which is how a returning
    person gets back to their teams — and, with sign-in open, is also how anybody who knows a
    name becomes its owner. This test does not endorse that; it records that the behaviour is
    deliberate, so that a future change making claim() refuse a taken name has to come here and
    decide to, rather than discovering it by breaking three others.
    """
    first = claim(session, "Sable Kaneko")
    session.commit()

    # A completely different person, presenting nothing, typing the same string.
    impostor = claim(session, "sable kaneko")
    session.commit()

    assert impostor.principal_id == first.principal_id
