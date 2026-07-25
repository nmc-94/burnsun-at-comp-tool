"""EVE SSO: the OAuth2 + PKCE exchange, and verifying the identity it returns.

This module is the security boundary of the whole tool. Everything downstream — who owns
a team, who may edit a comp — rests on the character id read out of a token here, so the
token is verified rather than merely decoded: signature against the SSO's published keys,
plus issuer, audience and expiry. A decoded-but-unverified token would let anyone claim
any character.

No database and no FastAPI, so a keypair and a fake transport are enough to test all of
it. The protocol constants below are quoted from CCP's SSO documentation; each has a
comment because each is the kind of detail a well-meaning cleanup would break.
"""

from __future__ import annotations

import base64
import hashlib
import secrets
from dataclasses import dataclass
from functools import lru_cache
from typing import Any
from urllib.parse import urlencode

import httpx
import jwt
from jwt import PyJWKClient

from ..esi import user_agent
from ..settings import Settings

SSO_AUTHORIZE_PATH = "/v2/oauth/authorize"
SSO_TOKEN_PATH = "/v2/oauth/token"
SSO_JWKS_PATH = "/oauth/jwks"

#: The SSO names itself in every token's audience alongside the client id.
SSO_AUDIENCE = "EVE Online"
#: RS-256 today, ES-256 announced. Anything else — above all "none" — is a forgery, so the
#: list is fixed here rather than read from the token's own header.
SIGNING_ALGORITHMS = ("RS256", "ES256")
#: Every player token's subject looks like ``CHARACTER:EVE:90000001``. A subject that does
#: not is some other kind of principal and must not become a character id.
CHARACTER_SUBJECT_PREFIX = "CHARACTER:EVE:"
#: PKCE's only challenge method the SSO advertises.
CODE_CHALLENGE_METHOD = "S256"
#: 32 bytes url-safe base64 is 43 characters, the shortest RFC 7636 permits.
VERIFIER_BYTES = 32
STATE_BYTES = 24
#: The SSO is on a request path during login; a slow one should fail rather than hang.
HTTP_TIMEOUT = httpx.Timeout(10.0, connect=5.0)
#: The signing keys change rarely; refetching them on every login would be absurd.
JWKS_LIFESPAN_SECONDS = 3600
#: Small leeway for clock skew between this host and CCP's.
CLOCK_LEEWAY_SECONDS = 10


class SsoError(RuntimeError):
    """A call to EVE SSO failed, or returned something that will not be trusted."""


class SsoAuthRevoked(SsoError):
    """The refresh token is no longer good. Only a fresh sign-in can fix it."""


@dataclass(frozen=True)
class PkceChallenge:
    """A login in flight, before the browser has been sent anywhere."""

    state: str
    code_verifier: str

    @property
    def code_challenge(self) -> str:
        return code_challenge_for(self.code_verifier)


@dataclass(frozen=True)
class Identity:
    """A character, as the SSO proved it."""

    character_id: int
    name: str
    #: Changes when the character is transferred to another account, which is the signal
    #: that sessions opened before it belong to somebody else.
    owner_hash: str


@dataclass(frozen=True)
class TokenGrant:
    access_token: str
    #: Absent when the application requested no scope at all, in which case the SSO issues
    #: no refresh token and there is nothing to store.
    refresh_token: str | None
    expires_in: int


def code_challenge_for(code_verifier: str) -> str:
    digest = hashlib.sha256(code_verifier.encode("ascii")).digest()
    # base64url with the padding stripped, per RFC 7636.
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def start_login() -> PkceChallenge:
    return PkceChallenge(
        state=secrets.token_urlsafe(STATE_BYTES),
        code_verifier=secrets.token_urlsafe(VERIFIER_BYTES),
    )


def accepted_issuers(sso_base_url: str) -> tuple[str, ...]:
    """Both spellings the SSO uses.

    It puts either its host name or its full URI in ``iss``, and says applications must
    handle both — so accepting only one would reject perfectly good tokens at random.
    """
    without_scheme = sso_base_url.split("://", 1)[-1]
    return (sso_base_url, without_scheme)


def decode_identity(
    access_token: str, key: Any, *, client_id: str, issuers: tuple[str, ...]
) -> Identity:
    """Verify a token and read the character out of it.

    ``key`` is passed in rather than fetched, so this is callable in a test against a
    locally generated keypair with no network at all.
    """
    try:
        claims = jwt.decode(
            access_token,
            key,
            algorithms=list(SIGNING_ALGORITHMS),
            # The audience also lists "EVE Online"; PyJWT is satisfied by one match, and
            # the one that matters is that this token was minted for *this* application.
            audience=client_id,
            issuer=list(issuers),
            leeway=CLOCK_LEEWAY_SECONDS,
            options={"require": ["exp", "iss", "aud", "sub"]},
        )
    except jwt.PyJWTError as error:
        raise SsoError(f"identity token rejected: {error}") from error

    subject = str(claims.get("sub", ""))
    if not subject.startswith(CHARACTER_SUBJECT_PREFIX):
        raise SsoError(f"identity token does not name a character: {subject!r}")
    character_id = subject.removeprefix(CHARACTER_SUBJECT_PREFIX)
    if not character_id.isdigit():
        raise SsoError(f"identity token carries no character id: {subject!r}")

    name = claims.get("name")
    owner = claims.get("owner")
    if not isinstance(name, str) or not isinstance(owner, str):
        raise SsoError("identity token is missing the character name or owner hash")
    return Identity(character_id=int(character_id), name=name, owner_hash=owner)


@lru_cache(maxsize=4)
def signing_keys(jwks_url: str) -> PyJWKClient:
    """One key client per process. Cached upstream too, so logins do not refetch."""
    return PyJWKClient(jwks_url, cache_keys=True, lifespan=JWKS_LIFESPAN_SECONDS, timeout=5)


class SsoClient:
    """Everything that speaks HTTP to login.eveonline.com.

    The transport is injectable, which is the whole testing strategy: a mock transport
    asserts the exact form body that goes out, with no monkeypatching and no network.
    """

    def __init__(self, settings: Settings, http: httpx.Client | None = None) -> None:
        self._settings = settings
        self._owned = http is None
        self._http = http or httpx.Client(timeout=HTTP_TIMEOUT)

    def close(self) -> None:
        if self._owned:
            self._http.close()

    def authorize_url(self, challenge: PkceChallenge) -> str:
        query = urlencode(
            {
                "response_type": "code",
                # Must match the value registered with the application byte for byte,
                # scheme, port and trailing slash included.
                "redirect_uri": self._settings.esi_callback_url,
                "client_id": self._settings.esi_client_id,
                # A scope is not decoration here: the SSO issues a refresh token only if
                # the initial redirect asked for at least one, and identity-only still
                # wants one so a session can be revalidated without a fresh sign-in.
                "scope": self._settings.esi_scopes,
                "code_challenge": challenge.code_challenge,
                "code_challenge_method": CODE_CHALLENGE_METHOD,
                "state": challenge.state,
            }
        )
        return f"{self._settings.esi_sso_base_url}{SSO_AUTHORIZE_PATH}?{query}"

    def exchange_code(self, code: str, code_verifier: str) -> TokenGrant:
        # No redirect_uri and no Basic authorization: PKCE makes this a public client, and
        # the verifier is what proves the exchange comes from whoever started the login.
        return self._token(
            {
                "grant_type": "authorization_code",
                "code": code,
                "client_id": self._settings.esi_client_id,
                "code_verifier": code_verifier,
            }
        )

    def refresh(self, refresh_token: str) -> TokenGrant:
        return self._token(
            {
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
                "client_id": self._settings.esi_client_id,
            }
        )

    def identity(self, access_token: str) -> Identity:
        url = f"{self._settings.esi_sso_base_url}{SSO_JWKS_PATH}"
        try:
            key = signing_keys(url).get_signing_key_from_jwt(access_token).key
        except jwt.PyJWTError as error:
            raise SsoError(f"could not find a signing key for the token: {error}") from error
        return decode_identity(
            access_token,
            key,
            client_id=self._settings.esi_client_id,
            issuers=accepted_issuers(self._settings.esi_sso_base_url),
        )

    def _token(self, form: dict[str, str]) -> TokenGrant:
        url = f"{self._settings.esi_sso_base_url}{SSO_TOKEN_PATH}"
        # The Host header CCP documents is the one httpx derives from the URL; setting it
        # by hand would only let it disagree with where the request actually goes.
        headers = {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": user_agent(self._settings),
        }
        try:
            response = self._http.post(url, data=form, headers=headers)
        except httpx.HTTPError as error:
            raise SsoError(f"could not reach EVE SSO: {error}") from error

        if response.status_code >= 400:
            raise self._failure(response)
        try:
            payload = response.json()
        except ValueError as error:
            raise SsoError("EVE SSO returned a token response that is not JSON") from error

        access_token = payload.get("access_token")
        if not isinstance(access_token, str):
            raise SsoError("EVE SSO returned no access token")
        refresh_token = payload.get("refresh_token")
        return TokenGrant(
            access_token=access_token,
            # Always keep whatever came back: the SSO rotates refresh tokens for native
            # applications, so the one submitted may already be spent.
            refresh_token=refresh_token if isinstance(refresh_token, str) else None,
            expires_in=int(payload.get("expires_in", 0) or 0),
        )

    def _failure(self, response: httpx.Response) -> SsoError:
        try:
            error = str(response.json().get("error", ""))
        except ValueError:
            error = ""
        if error == "invalid_grant":
            # The player revoked this application, or the token was already rotated away.
            # Distinct from every other failure because it is the only one where signing
            # in again is the fix, rather than waiting.
            return SsoAuthRevoked("EVE SSO refused the grant; the authorization is gone")
        detail = error or f"HTTP {response.status_code}"
        return SsoError(f"EVE SSO rejected the token request: {detail}")
