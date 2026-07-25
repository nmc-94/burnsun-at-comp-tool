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


@lru_cache
def get_settings() -> Settings:
    return Settings()
