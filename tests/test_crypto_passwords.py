"""Hashing a join password, and the four ways that can go wrong quietly.

Separate from ``test_auth_crypto.py``, which covers the Fernet half. The two live in one
module for the contrast — one is reversible because a token has to be presented, the other is
not because a password only has to be compared — and they are tested apart because nothing
about one constrains the other.

No database and no client: this is arithmetic.
"""

from __future__ import annotations

from comptool.auth.crypto import hash_password, verify_password

PASSWORD = "hydra reloaded 2026"


def test_a_password_verifies_against_its_own_hash():
    assert verify_password(PASSWORD, hash_password(PASSWORD)) is True


def test_a_wrong_password_does_not():
    stored = hash_password(PASSWORD)

    assert verify_password("hydra reloaded 2025", stored) is False
    assert verify_password("", stored) is False
    # Not a prefix match: a partial guess is as wrong as a blank one.
    assert verify_password("hydra", stored) is False


def test_the_same_password_hashes_differently_every_time():
    first = hash_password(PASSWORD)
    second = hash_password(PASSWORD)

    # The salt doing its job. Without it, two teams choosing the same password would store
    # identical rows — visibly identical to anyone holding the database, and crackable once
    # for both.
    assert first != second
    assert verify_password(PASSWORD, first)
    assert verify_password(PASSWORD, second)


def test_the_stored_form_carries_its_own_parameters():
    scheme, n, r, p, salt, digest = hash_password(PASSWORD).split("$")

    # Written down so raising the cost later is a code change and not a migration: an old row
    # keeps verifying under the parameters it was written with.
    assert scheme == "scrypt"
    assert int(n) >= 2**14 and int(r) >= 8 and int(p) >= 1
    assert salt and digest


def test_a_hash_never_contains_the_password():
    stored = hash_password(PASSWORD)

    # The property that makes a leaked database yield verifiers rather than passwords, and the
    # reason there is no decrypt to pair with this.
    assert PASSWORD not in stored
    assert "hydra" not in stored


def test_an_unreadable_stored_string_refuses_rather_than_raising():
    # A row corrupted, truncated, or written by some future scheme must refuse the caller — a
    # 500 from the join route would be a worse answer than "wrong password", and there is
    # nothing the caller could do differently either way.
    for broken in (
        "",
        "not-a-hash",
        "scrypt$16384$8$1$onlyfivefields",
        "bcrypt$16384$8$1$c2FsdA==$aGFzaA==",
        "scrypt$notanumber$8$1$c2FsdA==$aGFzaA==",
        "scrypt$16384$8$1$!!!notbase64!!!$aGFzaA==",
    ):
        assert verify_password(PASSWORD, broken) is False
