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

DEV_AUTH = {
    "dev_auth_enabled": True,
    # At least DEV_AUTH_SECRET_MIN_LENGTH, or the wrong validator fires.
    "dev_auth_secret": "a-development-secret-of-sufficient-length",
}

LOCAL_AUTH = {
    "local_auth_enabled": True,
    # At least TEAM_CREATION_KEY_MIN_LENGTH, for the same reason.
    "team_creation_key": "a-creation-key-long-enough-here",
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
        assert settings.dev_auth_enabled is False
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


def test_two_doors_at_once_are_refused():
    # The decision that keeps every authorization invariant in this app true without a
    # discriminator column: one principal kind per database. Enforced here rather than left
    # to a route, because a deployment that booted with both would already have mixed rows in
    # it by the time anybody noticed.
    with pytest.raises(ValidationError, match="COMPTOOL_LOCAL_AUTH_ENABLED"):
        Settings(**SSO, **LOCAL_AUTH)


def test_local_accounts_without_a_creation_key_are_refused():
    # Not merely unconfigured — unusable. Sign-in would work and then nobody could ever make a
    # team, so the whole instance would be a sign-in screen leading to an empty room.
    with pytest.raises(ValidationError, match="COMPTOOL_TEAM_CREATION_KEY"):
        Settings(local_auth_enabled=True, team_creation_key="")


def test_a_short_creation_key_is_refused():
    # Unlike the development secret's floor, this one is doing real work: the key sits on a
    # public URL with nothing else in front of it.
    with pytest.raises(ValidationError, match="COMPTOOL_TEAM_CREATION_KEY"):
        Settings(local_auth_enabled=True, team_creation_key="hunter2")


def test_the_creation_key_is_only_required_once_local_accounts_are_on():
    assert Settings(local_auth_enabled=False, team_creation_key="").sign_in_mode == "none"


def test_the_sign_in_mode_names_whichever_door_is_open():
    assert Settings(esi_enabled=False).sign_in_mode == "none"
    assert Settings(**SSO).sign_in_mode == "sso"
    # "local", not "password": signing in at this door asks for a name and nothing else. The
    # passwords in this mode belong to teams.
    assert Settings(**LOCAL_AUTH).sign_in_mode == "local"


def test_local_accounts_need_no_development_environment():
    # The opposite of the two DEV_ switches below: this one is meant for a deployment, so
    # naming the environment "production" has to be entirely unremarkable.
    assert Settings(**LOCAL_AUTH, environment="production").local_auth_enabled is True


def test_the_development_sign_in_is_refused_outside_a_development_environment():
    # An allow-list, so a name nobody thought of refuses rather than admits.
    for named in ("production", "prod", "staging", "railway", "live"):
        with pytest.raises(ValidationError, match="COMPTOOL_ENVIRONMENT"):
            Settings(**DEV_AUTH, environment=named)

    for named in ("local", "docker", "ci", "DEV", " test "):
        assert Settings(**DEV_AUTH, environment=named).dev_auth_enabled is True


def test_a_short_development_secret_is_refused():
    # It is the only thing between a caller and every identity in the database.
    with pytest.raises(ValidationError, match="COMPTOOL_DEV_AUTH_SECRET"):
        Settings(dev_auth_enabled=True, dev_auth_secret="dev", environment="local")


def test_the_development_secret_is_only_required_once_it_is_enabled():
    assert Settings(dev_auth_enabled=False, dev_auth_secret="").dev_auth_enabled is False


def test_the_development_sign_in_needs_no_eve_application():
    # What CI runs: the back door on, no EVE credentials anywhere.
    settings = Settings(**DEV_AUTH, environment="ci", esi_enabled=False)

    assert settings.dev_auth_enabled is True
    assert settings.esi_enabled is False


def test_more_than_one_worker_is_refused():
    """The live stream fans out in-process, so a second worker is a correctness bug.

    Refused rather than warned about because the damage is silent: half the events stop
    crossing, and the presence roster starts making a false statement about who is in the
    room. And this variable arrives without anybody deciding anything — it is the standard
    advice for every FastAPI deployment and set by default on some platforms.
    """
    # Named by its alias, which is the only name it has: the field carries no COMPTOOL_
    # prefix because the variable is uvicorn's rather than ours, and reading it under one
    # would mean the refusal never fires on the name that actually forks the app.
    with pytest.raises(ValidationError, match="WEB_CONCURRENCY"):
        Settings(WEB_CONCURRENCY=4)


def test_more_than_one_worker_is_refused_from_the_environment(monkeypatch):
    # The path it actually arrives by — a platform default, set by nobody in particular.
    monkeypatch.setenv("WEB_CONCURRENCY", "2")
    settings_module.get_settings.cache_clear()
    try:
        with pytest.raises(ValidationError, match="WEB_CONCURRENCY"):
            settings_module.get_settings()
    finally:
        settings_module.get_settings.cache_clear()


def test_one_worker_is_the_default_and_may_also_be_said_out_loud(monkeypatch):
    monkeypatch.delenv("WEB_CONCURRENCY", raising=False)
    assert Settings().web_concurrency == 1
    assert Settings(WEB_CONCURRENCY=1).web_concurrency == 1


def test_normalize_url_routes_to_psycopg():
    assert normalize_url("postgresql://u:p@h/db") == "postgresql+psycopg://u:p@h/db"
    assert normalize_url("postgres://u:p@h/db") == "postgresql+psycopg://u:p@h/db"
    # An explicit driver is left untouched.
    assert normalize_url("postgresql+psycopg://u:p@h/db") == "postgresql+psycopg://u:p@h/db"
