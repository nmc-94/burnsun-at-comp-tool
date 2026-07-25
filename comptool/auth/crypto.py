"""Encrypting the SSO refresh token at rest.

The threat this answers is a leaked database — a backup on a laptop, a support export, a
read-only injection — in a world where the environment did not leak with it. So the token
is stored as ciphertext under a key derived from a secret that lives only in the
environment, and the derivation is deliberately slow enough that a short operator
passphrase is not worth grinding offline.

Fernet, rather than anything assembled here: it authenticates as well as encrypts, so a
tampered row fails loudly instead of decrypting to garbage.
"""

from __future__ import annotations

import base64
import hashlib
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken, MultiFernet

#: Bound into the derivation so that changing the scheme later is a visible break rather
#: than silent corruption: keys derived under a new salt simply cannot read old rows.
_KEY_SALT = b"comptool-esi-token-v1"

#: scrypt cost. ~16 MiB and a few tens of milliseconds — paid once per process, because
#: the derived cipher is cached, and enough to make offline guessing expensive.
_SCRYPT_N = 2**14
_SCRYPT_R = 8
_SCRYPT_P = 1
_SCRYPT_MAXMEM = 64 * 1024 * 1024


class TokenSecretError(RuntimeError):
    """The configured secret is missing, or cannot read what was stored under it."""


def _keys(secret: str) -> list[str]:
    """The keys a secret names, newest first.

    Comma-separated so a rotation is two deploys and no schema change: put the new key
    first, ship, then drop the old one once nothing is left encrypted under it.
    """
    return [part.strip() for part in secret.split(",") if part.strip()]


def derive_key(secret: str) -> bytes:
    """A Fernet key from an arbitrary secret.

    Fernet wants 32 url-safe base64 bytes; an operator supplies a passphrase. scrypt
    closes the gap and does the stretching, so a weak passphrase is not simply a weak key.
    """
    material = hashlib.scrypt(
        secret.encode("utf-8"),
        salt=_KEY_SALT,
        n=_SCRYPT_N,
        r=_SCRYPT_R,
        p=_SCRYPT_P,
        dklen=32,
        maxmem=_SCRYPT_MAXMEM,
    )
    return base64.urlsafe_b64encode(material)


@lru_cache(maxsize=4)
def _cipher(secret: str) -> MultiFernet:
    keys = _keys(secret)
    if not keys:
        raise TokenSecretError(
            "COMPTOOL_ESI_TOKEN_SECRET is empty; refresh tokens cannot be stored safely"
        )
    # The first key encrypts; every listed key still decrypts.
    return MultiFernet([Fernet(derive_key(key)) for key in keys])


def encrypt(plaintext: str, secret: str) -> str:
    return _cipher(secret).encrypt(plaintext.encode("utf-8")).decode("ascii")


def decrypt(ciphertext: str, secret: str) -> str:
    """Read a stored token back.

    Raises ``TokenSecretError`` when no configured key can read it — which is what a
    rotation that dropped the old key too early looks like. The caller treats that the
    same as a revoked token: the session's owner signs in once more, and nothing else is
    affected, because sessions do not depend on this ciphertext.
    """
    try:
        return _cipher(secret).decrypt(ciphertext.encode("ascii")).decode("utf-8")
    except InvalidToken as error:
        raise TokenSecretError(
            "The stored token cannot be read with the configured secret"
        ) from error
