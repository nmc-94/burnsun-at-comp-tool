"""Settings and URL-normalization tests (no database needed)."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from comptool import settings as settings_module
from comptool.db import normalize_url
from comptool.settings import Settings

SSO = {
    "esi_enabled": True,
    "esi_client_id": "client",
    "esi_callback_url": "http://localhost:8000/api/v1/auth/callback",
    "esi_token_secret": "secret",
}


def test_database_url_accepts_unprefixed_alias(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@host:5432/db")
    settings_module.get_settings.cache_clear()
    try:
        assert settings_module.get_settings().database_url == "postgresql://u:p@host:5432/db"
    finally:
        settings_module.get_settings.cache_clear()


def test_defaults(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("COMPTOOL_DATABASE_URL", raising=False)
    monkeypatch.delenv("PORT", raising=False)
    settings_module.get_settings.cache_clear()
    try:
        settings = settings_module.get_settings()
        assert settings.port == 8000
        assert settings.brand_name == "BurnSun"
        assert settings.session_ttl_seconds == 2592000
        assert settings.esi_enabled is False
    finally:
        settings_module.get_settings.cache_clear()


def test_the_session_cookie_is_secure_unless_asked_otherwise():
    # Local HTTP development is the only reason to turn this off, so the default has to
    # be the deployed one.
    assert Settings(session_cookie_secure=True).session_cookie_secure is True
    assert Settings().session_cookie_secure is True


def test_enabling_sso_without_its_secrets_is_refused():
    # Booting half-configured would mean storing refresh tokens under an empty key.
    with pytest.raises(ValidationError, match="COMPTOOL_ESI_TOKEN_SECRET"):
        Settings(**{**SSO, "esi_token_secret": ""})

    with pytest.raises(ValidationError, match="COMPTOOL_ESI_CLIENT_ID"):
        Settings(**{**SSO, "esi_client_id": ""})


def test_sso_secrets_are_only_required_once_sso_is_enabled():
    # The default deployment has no EVE application and must still start.
    assert Settings(esi_enabled=False, esi_client_id="").esi_enabled is False
    assert Settings(**SSO).esi_client_id == "client"


def test_a_trailing_slash_on_a_base_url_is_dropped():
    # Every caller joins a path onto these; a trailing slash would double up.
    settings = Settings(
        esi_sso_base_url="https://login.eveonline.com/",
        esi_api_base_url="https://esi.evetech.net/",
    )

    assert settings.esi_sso_base_url == "https://login.eveonline.com"
    assert settings.esi_api_base_url == "https://esi.evetech.net"


def test_normalize_url_routes_to_psycopg():
    assert normalize_url("postgresql://u:p@h/db") == "postgresql+psycopg://u:p@h/db"
    assert normalize_url("postgres://u:p@h/db") == "postgresql+psycopg://u:p@h/db"
    # An explicit driver is left untouched.
    assert normalize_url("postgresql+psycopg://u:p@h/db") == "postgresql+psycopg://u:p@h/db"
