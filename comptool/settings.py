"""Application configuration, read once from the environment.

All config comes from environment variables (twelve-factor). Most keys use the
``COMPTOOL_`` prefix; the database URL and port also accept their unprefixed,
ecosystem-standard names so a platform that injects ``DATABASE_URL``/``PORT`` works
without extra mapping.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field
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

    # Sessions. Placeholder for the auth phase (a generous ~30-day rolling TTL).
    session_ttl_seconds: int = 2592000

    # EVE SSO / ESI. Declared now to stabilize the env surface; wired in the auth phase.
    esi_enabled: bool = False
    esi_client_id: str = ""
    esi_callback_url: str = ""
    esi_token_secret: str = ""


@lru_cache
def get_settings() -> Settings:
    return Settings()
