"""End-to-end checks of the spine: health probe, API 404 semantics, SPA fallback."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from comptool.db import get_engine
from comptool.models import AppMeta


def test_health_ok(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["db"]["ok"] is True
    assert isinstance(body["db"]["latency_ms"], (int, float))
    assert body["build"]["service"] == "api"
    assert body["dev_auth"] is False
    # No EVE application and no password: the default deployment serves ruleset data and
    # share links, and offers no way in at all.
    assert body["auth"] == "none"


def test_health_names_which_process_answered(client):
    """So "are two of me running?" is answerable from outside, in one command.

    The live stream fans out in-process, and a process cannot count its own replicas — a
    self-check would be dishonest. What it can be is distinguishable: two curls against one
    hostname returning two ``instance`` values is positive proof of a second process.
    """
    from comptool.health import INSTANCE_ID

    body = client.get("/api/health").json()

    assert body["instance"] == INSTANCE_ID
    # Stable within a process, or two probes of one instance would look like two instances.
    assert client.get("/api/health").json()["instance"] == body["instance"]


def test_health_reports_whether_the_development_sign_in_is_on(client, configure):
    # An operator should be able to ask a running instance whether it has a back door open
    # without reading environment variables on a box they may not have.
    configure(
        dev_auth_enabled=True,
        dev_auth_secret="a-development-secret-of-sufficient-length",
        environment="local",
    )

    assert client.get("/api/health").json()["dev_auth"] is True


def test_health_reports_which_door_is_open(client, configure):
    # Same argument as the back-door keys, one step less sensitive: which door a deployment
    # opens is already public at /me, because the SPA cannot draw a sign-in screen without it.
    configure(esi_enabled=True)
    assert client.get("/api/health").json()["auth"] == "sso"

    configure(
        esi_enabled=False,
        local_auth_enabled=True,
        team_creation_key="a-creation-key-long-enough-here",
    )
    assert client.get("/api/health").json()["auth"] == "local"


def test_unknown_api_path_returns_json_404(client):
    response = client.get("/api/does-not-exist")
    assert response.status_code == 404
    # A wrong API path must be an honest JSON error, never the SPA HTML shell.
    assert response.headers["content-type"].startswith("application/json")
    assert response.json()["detail"]


def test_spa_fallback_serves_index_and_real_files(client, tmp_path):
    from comptool.main import app
    from comptool.settings import get_settings

    (tmp_path / "index.html").write_text("<!doctype html><title>spa</title>")
    (tmp_path / "robots.txt").write_text("User-agent: *\n")
    override = get_settings().model_copy(update={"spa_dir": tmp_path})
    app.dependency_overrides[get_settings] = lambda: override
    try:
        # An unknown non-/api route returns the SPA shell (client-side routing).
        page = client.get("/teams/42")
        assert page.status_code == 200
        assert "<!doctype html>" in page.text.lower()
        # A real file under the dist dir is served directly.
        robots = client.get("/robots.txt")
        assert robots.status_code == 200
        assert "User-agent" in robots.text
    finally:
        app.dependency_overrides.clear()


def test_app_meta_round_trip(database):
    with Session(get_engine()) as session:
        session.add(AppMeta(key="probe", value="v1", updated_at=datetime.now(tz=UTC)))
        session.commit()
        found = session.execute(select(AppMeta).where(AppMeta.key == "probe")).scalar_one()
        assert found.value == "v1"
