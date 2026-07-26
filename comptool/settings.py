"""Application configuration, read once from the environment.

All config comes from environment variables (twelve-factor). Most keys use the
``COMPTOOL_`` prefix; the database URL and port also accept their unprefixed,
ecosystem-standard names so a platform that injects ``DATABASE_URL``/``PORT`` works
without extra mapping.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

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

    # Development sign-in. A back door, named like one — see comptool/auth/dev.py for what
    # it bypasses and, more usefully, for what it deliberately does not.
    #: Off by default and refused outside a development environment, so reaching it takes
    #: two variables set on purpose.
    dev_auth_enabled: bool = False
    #: Whoever holds this can become any character in this database. It is not a password
    #: guarding a feature; for the duration it is the identity provider.
    dev_auth_secret: str = ""

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


@lru_cache
def get_settings() -> Settings:
    return Settings()
