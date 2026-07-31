"""Application configuration, read once from the environment.

All config comes from environment variables (twelve-factor). Most keys use the
``COMPTOOL_`` prefix; the database URL and port also accept their unprefixed,
ecosystem-standard names so a platform that injects ``DATABASE_URL``/``PORT`` works
without extra mapping.
"""

from __future__ import annotations

from enum import StrEnum
from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class SignInMode(StrEnum):
    """Which door this deployment opens, and the only three answers there are.

    One value rather than a flag per mode, because the validator below makes two doors
    impossible and a pair of booleans could still spell it. The same string is served by
    ``/api/v1/auth/me`` — where an anonymous browser needs it to know what to draw — and by
    ``/api/health``, where an operator needs it without shell access. Neither discloses
    anything: what the door *is* was never the secret.
    """

    SSO = "sso"
    #: Named for what it is rather than for a credential, because there isn't one at this
    #: door: signing in means claiming a display name and nothing else. The passwords in this
    #: mode belong to *teams* — see ``comptool/join.py`` — and a value called "password" would
    #: select a sign-in screen that never asks for one.
    LOCAL = "local"
    #: Ruleset data and share links still work. Nothing else does.
    NONE = "none"

#: Environment names the development sign-in is allowed to exist in. An allow-list rather
#: than a list of production names to refuse, because a deny-list fails open: it has to
#: enumerate every word anybody might ever call a deployment, and the one it misses is the
#: one that ships a back door. The same argument, learned the same expensive way, is set out
#: at length in tests/conftest.py's database guard.
DEVELOPMENT_ENVIRONMENTS = frozenset({"local", "docker", "dev", "development", "test", "ci"})

#: 32 characters is what ``secrets.token_urlsafe(24)`` prints. The floor is not
#: cryptographic subtlety — nothing here is brute-forced over HTTP — it exists so that
#: nobody sets this to "dev", and so the refusal below has a number to quote.
DEV_AUTH_SECRET_MIN_LENGTH = 32

#: The creation key's floor, and read against the constant above it: that one says the length
#: is not cryptographic subtlety, and here it is exactly that. This key sits on a public URL
#: and is the only thing stopping a stranger filling the instance with teams, and there is no
#: lockout a human would notice and nobody to email. The floor is the primary defence.
#:
#: 24 rather than 32, so a four-word passphrase qualifies alongside ``token_urlsafe(24)``. The
#: operator has to send this to whoever runs a team, and something typeable is worth more than
#: eight characters nobody will read back correctly.
#:
#: Note what it does *not* guard. It is not a sign-in credential — in this mode there is none —
#: and it does not protect a single team's data. A team is guarded by its own password, which
#: its owner sets, which is stored hashed, and which has a much lower floor because a person
#: chooses and dictates it. See ``comptool/join.py``.
TEAM_CREATION_KEY_MIN_LENGTH = 24


def is_development_environment(name: str) -> bool:
    """Shared by the boot check and the route, so there is one definition of the rule."""
    return name.strip().lower() in DEVELOPMENT_ENVIRONMENTS


def _default_spa_dir() -> Path:
    # Repo-relative web/dist for local `npm run build` + uvicorn. The container image
    # overrides this via COMPTOOL_SPA_DIR to the baked-in copy.
    return Path(__file__).resolve().parent.parent / "web" / "dist"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="COMPTOOL_", env_file=".env", extra="ignore"
    )

    # Database. A plain postgresql:// URL is accepted; the driver is normalized in db.py.
    database_url: str = Field(
        default="postgresql://comptool:comptool@localhost:5432/comptool",
        validation_alias=AliasChoices("DATABASE_URL", "COMPTOOL_DATABASE_URL"),
    )
    db_pool_size: int = 10
    db_max_overflow: int = 20
    db_pool_recycle_seconds: int = 1800

    # Server.
    port: int = Field(default=8000, validation_alias=AliasChoices("PORT", "COMPTOOL_PORT"))
    #: How many uvicorn workers the platform is asking for. Declared here only so the
    #: validator below can refuse it; nothing reads the value. Unprefixed because it is
    #: uvicorn's variable rather than ours — see ``_check_single_worker``.
    web_concurrency: int = Field(default=1, validation_alias=AliasChoices("WEB_CONCURRENCY"))
    log_level: str = "INFO"
    environment: str = "local"
    spa_dir: Path = Field(default_factory=_default_spa_dir)

    # Brand. Default BurnSun; a self-hoster overrides it (assets live under web/public).
    brand_name: str = "BurnSun"

    # Sessions. A generous rolling TTL: an active user is never signed out, and an
    # abandoned session ages out on its own.
    session_ttl_seconds: int = 2592000
    #: Push the sliding expiry out at most this often. Renewing on literally every
    #: request would be one row UPDATE per request forever on the one table every
    #: request reads; against a 30-day window, hourly is indistinguishable.
    session_renew_after_seconds: int = 3600
    #: Off only for local HTTP development. A Secure cookie over plain http is silently
    #: dropped by the browser, which looks exactly like a broken login.
    session_cookie_secure: bool = True
    #: Empty means a host-only cookie, which is what the single-origin design wants.
    session_cookie_domain: str = ""

    # EVE SSO / ESI.
    esi_enabled: bool = False
    esi_client_id: str = ""
    esi_callback_url: str = ""
    #: Encrypts the stored SSO refresh token. Not part of the OAuth exchange — the PKCE
    #: flow is a public client and has no client secret. Comma-separated to rotate: the
    #: first key encrypts, every listed key still decrypts.
    esi_token_secret: str = ""
    #: Identity only — the verified character id and name are all this tool needs.
    esi_scopes: str = "publicData"
    esi_sso_base_url: str = "https://login.eveonline.com"
    esi_api_base_url: str = "https://esi.evetech.net"
    #: Sent in the User-Agent. CCP asks callers to identify themselves contactably.
    esi_contact: str = ""
    #: Where the callback sends the browser once signed in. Relative by default, because
    #: the API serves the SPA; in development the SPA is on its own port.
    esi_post_login_url: str = "/"

    # Local accounts. The other door, for a deployment with no EVE application — see
    # comptool/auth/local.py, comptool/local_accounts.py and comptool/join.py.
    #: Mutually exclusive with ``esi_enabled``, refused at boot. One principal kind per
    #: database is what keeps every authorization invariant in this app true without a
    #: discriminator threaded through five tables: an EVE character's id is positive, a local
    #: principal's is negative, and nothing has to ask which it is holding.
    #:
    #: Signing in under it asks for a name and nothing else. The credentials in this mode
    #: belong to teams, not to the instance, and they live in the database where the person
    #: who owns the team can change them.
    local_auth_enabled: bool = False
    #: Who may create a team. **Not** a sign-in credential and not a guard on any team's data —
    #: it exists because open sign-in would otherwise let a stranger fill the instance with
    #: teams. Not hashed, because there is nowhere to hash it *to*: it lives here, in the
    #: environment, and the plaintext is already readable by anything that can read the
    #: process. A stored hash would protect a database backup from a secret the backup never
    #: contained — unlike a team's password, which is in a row and therefore is hashed.
    team_creation_key: str = ""

    # Development sign-in. A back door, named like one — see comptool/auth/dev.py for what
    # it bypasses and, more usefully, for what it deliberately does not.
    #: Off by default and refused outside a development environment, so reaching it takes
    #: two variables set on purpose.
    dev_auth_enabled: bool = False
    #: Whoever holds this can become any character in this database. It is not a password
    #: guarding a feature; for the duration it is the identity provider.
    dev_auth_secret: str = ""

    # Development name resolution. The second back door — see comptool/dev_resolve.py.
    #: Resolves a character name from ``auth_session`` instead of from ESI, so an offline
    #: end-to-end run can grant access to a character it has signed in. No secret: it hands
    #: out nothing and is reachable only through a route that already requires ownership.
    dev_resolve_enabled: bool = False

    @model_validator(mode="after")
    def _check_sso_configuration(self) -> Settings:
        # Trailing slashes would double up when joined with a path.
        self.esi_sso_base_url = self.esi_sso_base_url.rstrip("/")
        self.esi_api_base_url = self.esi_api_base_url.rstrip("/")
        if not self.esi_enabled:
            return self
        # Refuse to start rather than degrade: a blank token secret would otherwise mean
        # refresh tokens quietly stored in the clear.
        missing = [
            name
            for name in ("esi_client_id", "esi_callback_url", "esi_token_secret")
            if not getattr(self, name)
        ]
        if missing:
            keys = ", ".join(f"COMPTOOL_{name.upper()}" for name in missing)
            raise ValueError(f"COMPTOOL_ESI_ENABLED is set but {keys} is empty")
        return self

    @property
    def sign_in_mode(self) -> SignInMode:
        """Which door is open. Derived, never configured — see the validator below.

        SSO first, though the order cannot matter: a deployment with both set does not boot.
        """
        if self.esi_enabled:
            return SignInMode.SSO
        if self.local_auth_enabled:
            return SignInMode.LOCAL
        return SignInMode.NONE

    @model_validator(mode="after")
    def _check_local_auth_configuration(self) -> Settings:
        """Refuse to boot rather than run two doors, or a mode nobody can use.

        Its own validator, like the three around it, because the failures below are about
        different variables and an error that has to say which one it means is an error that
        gets read wrong at 2am.
        """
        if not self.local_auth_enabled:
            return self
        if self.esi_enabled:
            raise ValueError(
                "COMPTOOL_ESI_ENABLED and COMPTOOL_LOCAL_AUTH_ENABLED are both set. A "
                "deployment offers one door: EVE SSO identifies people by a character the "
                "game vouches for, local accounts by a name they claim here, and a database "
                "that held both would have grants and teams whose owners came from two "
                "different worlds. Turn one off."
            )
        if not self.team_creation_key:
            # Not merely unconfigured — unusable. Sign-in would work, and then nobody could
            # ever make a team, so the whole instance would be a sign-in screen leading to an
            # empty room. Better to say so at boot than to let somebody discover it.
            raise ValueError(
                "COMPTOOL_LOCAL_AUTH_ENABLED is set but COMPTOOL_TEAM_CREATION_KEY is empty. "
                "Signing in is open in this mode, so the key is what stops a stranger filling "
                "your instance with teams — and with none set, nobody can create one at all."
            )
        if len(self.team_creation_key) < TEAM_CREATION_KEY_MIN_LENGTH:
            raise ValueError(
                f"COMPTOOL_LOCAL_AUTH_ENABLED is set but COMPTOOL_TEAM_CREATION_KEY is under "
                f"{TEAM_CREATION_KEY_MIN_LENGTH} characters. It sits on a public URL with "
                f"nothing else in front of it; generate one with "
                f'python -c "import secrets; print(secrets.token_urlsafe(24))" — or use a '
                f"passphrase of four or more words."
            )
        return self

    @model_validator(mode="after")
    def _check_dev_auth_configuration(self) -> Settings:
        """Refuse to boot rather than ship a back door by accident.

        Its own validator rather than a branch inside the SSO one above: the two share no
        setting and no failure mode, and an error that has to say which half it is about is
        an error that gets read wrong at 2am.
        """
        if not self.dev_auth_enabled:
            return self
        if not is_development_environment(self.environment):
            raise ValueError(
                f"COMPTOOL_DEV_AUTH_ENABLED is set but COMPTOOL_ENVIRONMENT is "
                f"{self.environment!r}. The development sign-in mints a session for any "
                f"character a caller names, so it is allowed only where the environment says "
                f"it is a development one ({', '.join(sorted(DEVELOPMENT_ENVIRONMENTS))})."
            )
        if len(self.dev_auth_secret) < DEV_AUTH_SECRET_MIN_LENGTH:
            raise ValueError(
                f"COMPTOOL_DEV_AUTH_ENABLED is set but COMPTOOL_DEV_AUTH_SECRET is under "
                f"{DEV_AUTH_SECRET_MIN_LENGTH} characters. It is the only thing between a "
                f"caller and every identity in this database; generate one with "
                f'python -c "import secrets; print(secrets.token_urlsafe(24))"'
            )
        return self

    @model_validator(mode="after")
    def _check_dev_resolve_configuration(self) -> Settings:
        """The same refusal for the same reason, one door along.

        Separate from the sign-in's validator although the rule is identical: the two are
        independent switches, and an error naming the wrong one sends whoever reads it to
        the wrong variable.
        """
        if not self.dev_resolve_enabled:
            return self
        if not is_development_environment(self.environment):
            raise ValueError(
                f"COMPTOOL_DEV_RESOLVE_ENABLED is set but COMPTOOL_ENVIRONMENT is "
                f"{self.environment!r}. Development resolution answers character lookups "
                f"from this database's sign-in history instead of from EVE, so it is allowed "
                f"only where the environment says it is a development one "
                f"({', '.join(sorted(DEVELOPMENT_ENVIRONMENTS))})."
            )
        return self

    @model_validator(mode="after")
    def _check_single_worker(self) -> Settings:
        """Refuse to boot forked, because the live stream fans out in-process.

        ``live.py`` keeps a dict of open streams per team and hands each write to the ones it
        can see. A second worker sees none of the first one's, so half the events stop
        crossing — and with presence, the roster starts making a *false statement about which
        people are in the room*, which is worse in kind. An absence gets debugged eventually;
        a roster gets believed.

        Crash-looping rather than warning, the same call the dev-auth validators above make,
        because the failure this prevents is silent in production and invisible in a smoke
        test. And this variable in particular is worth catching by name: it is the standard
        advice for every FastAPI deployment and set by default on some platforms, so it
        arrives without anybody deciding anything.

        ``__main__.py`` also passes ``workers=1`` explicitly, which is the belt to this
        braces — ``uvicorn.Config`` only consults ``WEB_CONCURRENCY`` when ``workers`` is
        ``None``, so passing it is what stops the variable winning. This validator is what
        stops a deployment *thinking* it got what it asked for.
        """
        if self.web_concurrency > 1:
            raise ValueError(
                f"WEB_CONCURRENCY is {self.web_concurrency}, and this application serves one "
                f"worker by design. The live event stream fans out inside a single process, "
                f"so a second worker silently stops delivering events to half the team and "
                f"makes the presence roster wrong rather than merely late. Unset it, or scale "
                f"by moving the fan-out behind a broker first (see comptool/live.py)."
            )
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
