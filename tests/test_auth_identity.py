"""PKCE derivation, and what a valid identity token is.

This is the security boundary: every claim of ownership downstream is the character id
these tests say may be read out. So the negative cases matter more than the positive one —
each is a way somebody could otherwise assert an identity that is not theirs.

Pure. A keypair is generated here, so nothing reaches the network and no key is committed.
"""

from __future__ import annotations

import base64
import hashlib
from datetime import UTC, datetime, timedelta

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from comptool.auth import sso

CLIENT_ID = "a-client-id"
ISSUERS = ("https://login.eveonline.com", "login.eveonline.com")


@pytest.fixture(scope="session")
def keypair():
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return private, private.public_key()


def claims(**overrides) -> dict:
    now = datetime.now(tz=UTC)
    payload = {
        "sub": "CHARACTER:EVE:90000001",
        "name": "Kadir",
        "owner": "8PmzCeTKb4VFUDrHLc/AeZXDSWM=",
        "iss": "https://login.eveonline.com",
        "aud": [CLIENT_ID, sso.SSO_AUDIENCE],
        "exp": int((now + timedelta(minutes=20)).timestamp()),
        "iat": int(now.timestamp()),
    }
    payload.update(overrides)
    return payload


def token(keypair, **overrides) -> str:
    private, _ = keypair
    return jwt.encode(claims(**overrides), private, algorithm="RS256")


def read(keypair, raw: str) -> sso.Identity:
    _, public = keypair
    return sso.decode_identity(raw, public, client_id=CLIENT_ID, issuers=ISSUERS)


def test_the_challenge_is_the_unpadded_base64url_sha256_of_the_verifier():
    verifier = "a-known-verifier"
    expected = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=")

    challenge = sso.code_challenge_for(verifier)

    assert challenge == expected.decode()
    assert "=" not in challenge


def test_each_login_gets_its_own_state_and_verifier():
    first, second = sso.start_login(), sso.start_login()

    assert first.state != second.state
    assert first.code_verifier != second.code_verifier
    # RFC 7636 wants at least 43 characters, and the column holds 128.
    assert 43 <= len(first.code_verifier) <= 128
    assert len(first.state) <= 64


def test_both_spellings_of_the_issuer_are_accepted():
    # The SSO uses either, and says applications must handle both.
    assert sso.accepted_issuers("https://login.eveonline.com") == (
        "https://login.eveonline.com",
        "login.eveonline.com",
    )


def test_a_valid_identity_token_yields_the_character_id_and_name(keypair):
    identity = read(keypair, token(keypair))

    assert identity.character_id == 90_000_001
    assert identity.name == "Kadir"
    assert identity.owner_hash == "8PmzCeTKb4VFUDrHLc/AeZXDSWM="


def test_the_bare_host_name_is_an_acceptable_issuer(keypair):
    assert read(keypair, token(keypair, iss="login.eveonline.com")).character_id == 90_000_001


def test_a_token_signed_by_another_key_is_refused(keypair):
    impostor = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    forged = jwt.encode(claims(), impostor, algorithm="RS256")

    with pytest.raises(sso.SsoError, match="rejected"):
        read(keypair, forged)


def test_an_unsigned_token_is_refused(keypair):
    # The algorithm list is fixed in code rather than read from the token's own header,
    # which is what stops "alg: none" from being an identity.
    unsigned = jwt.encode(claims(), key="", algorithm="none")

    with pytest.raises(sso.SsoError):
        read(keypair, unsigned)


def test_a_token_minted_for_another_client_is_refused(keypair):
    with pytest.raises(sso.SsoError):
        read(keypair, token(keypair, aud=["someone-elses-client", sso.SSO_AUDIENCE]))


def test_a_token_from_another_issuer_is_refused(keypair):
    with pytest.raises(sso.SsoError):
        read(keypair, token(keypair, iss="https://login.eveonline.com.evil.invalid"))


def test_an_expired_token_is_refused(keypair):
    stale = datetime.now(tz=UTC) - timedelta(hours=1)
    with pytest.raises(sso.SsoError):
        read(keypair, token(keypair, exp=int(stale.timestamp())))


def test_a_token_that_does_not_name_a_character_is_refused(keypair):
    with pytest.raises(sso.SsoError, match="does not name a character"):
        read(keypair, token(keypair, sub="CORPORATION:EVE:98000001"))


def test_a_character_subject_without_an_id_is_refused(keypair):
    with pytest.raises(sso.SsoError, match="no character id"):
        read(keypair, token(keypair, sub="CHARACTER:EVE:not-a-number"))


def test_a_token_missing_its_subject_is_refused(keypair):
    private, _ = keypair
    without = {key: value for key, value in claims().items() if key != "sub"}

    with pytest.raises(sso.SsoError):
        read(keypair, jwt.encode(without, private, algorithm="RS256"))
