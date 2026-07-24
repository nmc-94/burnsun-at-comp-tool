"""Settings and URL-normalization tests (no database needed)."""

from __future__ import annotations

from comptool import settings as settings_module
from comptool.db import normalize_url


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


def test_normalize_url_routes_to_psycopg():
    assert normalize_url("postgresql://u:p@h/db") == "postgresql+psycopg://u:p@h/db"
    assert normalize_url("postgres://u:p@h/db") == "postgresql+psycopg://u:p@h/db"
    # An explicit driver is left untouched.
    assert normalize_url("postgresql+psycopg://u:p@h/db") == "postgresql+psycopg://u:p@h/db"
