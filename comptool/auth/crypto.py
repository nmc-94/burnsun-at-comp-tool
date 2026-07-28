"""Two secrets at rest: the SSO refresh token, and a team's join password.

The threat both answer is a leaked database — a backup on a laptop, a support export, a
read-only injection — in a world where the environment did not leak with it. The token
is stored as ciphertext under a key derived from a secret that lives only in the
environment, and the derivation is deliberately slow enough that a short operator
passphrase is not worth grinding offline.

Fernet for the token, rather than anything assembled here: it authenticates as well as
encrypts, so a tampered row fails loudly instead of decrypting to garbage.

**A join password is hashed, not encrypted**, and the difference is the whole point of
keeping them in one file where the contrast is visible. A refresh token has to be *read back*
to be presented to EVE, so it must be recoverable and therefore encrypted. A password only
ever has to be *compared*, so nothing here can recover one — a leaked database yields
verifiers, not passwords, and the same leak that would hand over every team's password under
a reversible scheme hands over nothing under this one.

The environment's own secrets are deliberately not hashed anywhere. ``COMPTOOL_TEAM_CREATION_KEY``
is compared with ``compare_digest`` against the variable itself, because a hash of something
already readable by anything that can read the process is theatre.
"""

from __future__ import annotations

import base64
import hashlib
import secrets
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


#: Bytes of salt per password. Random per row, so two teams choosing "hydra" store two
#: unrelated verifiers and one cracked password reveals nothing about the other.
_PASSWORD_SALT_BYTES = 16
#: How a stored verifier names itself. The parameters travel *with* the hash rather than
#: living in this module, so raising the cost later is a code change and not a migration: old
#: rows keep verifying under the parameters they were written with, and each one is rewritten
#: at the next password change. Same shape as every password format worth copying.
_PASSWORD_SCHEME = "scrypt"


def hash_password(plain: str) -> str:
    """A verifier for a password somebody typed, safe to store in a row.

    One-way on purpose — see the module docstring. Nothing in this application ever needs a
    join password back, only an answer to "is this it", so there is no decrypt to pair with
    this and adding one later would be a downgrade rather than a feature.
    """
    salt = secrets.token_bytes(_PASSWORD_SALT_BYTES)
    derived = hashlib.scrypt(
        plain.encode("utf-8"),
        salt=salt,
        n=_SCRYPT_N,
        r=_SCRYPT_R,
        p=_SCRYPT_P,
        dklen=32,
        maxmem=_SCRYPT_MAXMEM,
    )
    return "$".join(
        (
            _PASSWORD_SCHEME,
            str(_SCRYPT_N),
            str(_SCRYPT_R),
            str(_SCRYPT_P),
            base64.b64encode(salt).decode("ascii"),
            base64.b64encode(derived).decode("ascii"),
        )
    )


def verify_password(plain: str, stored: str) -> bool:
    """Whether ``plain`` is the password ``stored`` was made from.

    Deliberately **not** cached, unlike ``_cipher``. That one is memoized because a Fernet key
    is derived once and used for the life of the process; this is the cost itself. Roughly
    16 MiB and tens of milliseconds per call is what makes guessing expensive, and a cache
    keyed on the password would hand that back to whoever is guessing.

    Returns False rather than raising on a stored string this cannot parse — a row corrupted
    or written by some future scheme must refuse the caller, not 500 the route. There is
    nothing a caller could do differently, and "wrong password" is already the answer the join
    route gives to everything it will not explain.
    """
    try:
        scheme, n, r, p, salt_b64, expected_b64 = stored.split("$")
        if scheme != _PASSWORD_SCHEME:
            return False
        derived = hashlib.scrypt(
            plain.encode("utf-8"),
            salt=base64.b64decode(salt_b64),
            n=int(n),
            r=int(r),
            p=int(p),
            dklen=len(base64.b64decode(expected_b64)),
            maxmem=_SCRYPT_MAXMEM,
        )
    except (ValueError, TypeError):
        return False
    # Constant time, over bytes: the comparison is the one place a timing difference would
    # leak how much of a guess was right.
    return secrets.compare_digest(derived, base64.b64decode(expected_b64))


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
