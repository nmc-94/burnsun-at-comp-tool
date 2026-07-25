"""Encryption of the stored SSO refresh token.

What these pin is the property the feature exists for: a stolen database row is useless
without the environment. Pure — no database, no network.
"""

from __future__ import annotations

import pytest

from comptool.auth import crypto

SECRET = "a-development-secret"
TOKEN = "gEy...refresh-token-value"


def test_a_refresh_token_round_trips_through_the_cipher():
    assert crypto.decrypt(crypto.encrypt(TOKEN, SECRET), SECRET) == TOKEN


def test_the_stored_ciphertext_does_not_carry_the_token():
    stored = crypto.encrypt(TOKEN, SECRET)

    assert TOKEN not in stored
    assert "refresh-token-value" not in stored


def test_the_same_token_encrypts_differently_every_time():
    # Fernet carries a random IV, so equal plaintexts do not reveal themselves as equal
    # rows to anyone reading the table.
    assert crypto.encrypt(TOKEN, SECRET) != crypto.encrypt(TOKEN, SECRET)


def test_another_secret_cannot_read_what_this_one_wrote():
    stored = crypto.encrypt(TOKEN, SECRET)

    with pytest.raises(crypto.TokenSecretError):
        crypto.decrypt(stored, "a-different-secret")


def test_a_rotated_secret_still_reads_tokens_written_under_the_old_one():
    stored = crypto.encrypt(TOKEN, "old-secret")

    # A rotation deploys both keys, newest first, and rewrites nothing.
    assert crypto.decrypt(stored, "new-secret,old-secret") == TOKEN


def test_a_rotated_secret_writes_under_the_new_key_only():
    rotated = crypto.encrypt(TOKEN, "new-secret,old-secret")

    assert crypto.decrypt(rotated, "new-secret") == TOKEN
    with pytest.raises(crypto.TokenSecretError):
        crypto.decrypt(rotated, "old-secret")


def test_an_empty_secret_is_refused_rather_than_storing_plaintext():
    for secret in ("", "   ", ",,"):
        with pytest.raises(crypto.TokenSecretError, match="COMPTOOL_ESI_TOKEN_SECRET"):
            crypto.encrypt(TOKEN, secret)


def test_tampering_with_a_stored_row_is_detected():
    stored = crypto.encrypt(TOKEN, SECRET)
    tampered = stored[:-4] + ("AAAA" if not stored.endswith("AAAA") else "BBBB")

    with pytest.raises(crypto.TokenSecretError):
        crypto.decrypt(tampered, SECRET)
