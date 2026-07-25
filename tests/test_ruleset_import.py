"""Importing a ruleset version and serving it back.

The end-to-end path: the real snapshot goes in through the command, and the payload the
client engine will read comes back out of the API unchanged.
"""

from __future__ import annotations

import json

from sqlalchemy import select

from comptool.ingest import cli
from comptool.models import RulesetVersion
from conftest import POINTS_CSV, SHIP_INDEX, VERSION_LABEL

IMPORT = ["import-points", "--csv", str(POINTS_CSV), "--ships", str(SHIP_INDEX)]


def test_emit_payload_needs_no_database(tmp_path):
    out = tmp_path / "payload.json"
    emit = ["emit-payload", "--csv", str(POINTS_CSV), "--ships", str(SHIP_INDEX), "--out", str(out)]

    assert cli.main(emit) == 0

    payload = json.loads(out.read_text(encoding="utf-8"))
    assert payload["version"] == VERSION_LABEL
    assert len(payload["ships"]) == 278


def test_imports_the_snapshot_as_one_immutable_version(session, payload):
    assert cli.main(IMPORT) == 0

    version = session.scalars(select(RulesetVersion)).one()
    assert version.version_label == VERSION_LABEL
    assert version.fetched_at.date().isoformat() == VERSION_LABEL
    assert version.ruleset.slug == "atxxii"
    assert version.ruleset.organizer == "Fenris Creations"
    assert version.payload == payload


def test_reimporting_the_same_label_is_refused(database, capsys):
    assert cli.main(IMPORT) == 0
    assert cli.main(IMPORT) == 1

    assert "already imported" in capsys.readouterr().err


def test_a_second_version_can_be_published_under_a_new_label(session):
    assert cli.main(IMPORT) == 0
    assert cli.main([*IMPORT, "--version-label", "2026-08-01"]) == 0

    labels = session.scalars(select(RulesetVersion.version_label)).all()
    assert sorted(labels) == [VERSION_LABEL, "2026-08-01"]


def test_serves_the_latest_version_with_the_payload_intact(client, payload):
    assert cli.main(IMPORT) == 0

    response = client.get("/api/v1/rulesets/atxxii/latest")

    assert response.status_code == 200
    body = response.json()
    assert body["slug"] == "atxxii"
    assert body["organizer"] == "Fenris Creations"
    assert body["versionLabel"] == VERSION_LABEL
    assert body["sourceUrl"].startswith("https://docs.google.com/spreadsheets/")
    assert body["payload"] == payload


def test_serves_a_pinned_version_so_old_comps_revalidate(client):
    assert cli.main(IMPORT) == 0
    assert cli.main([*IMPORT, "--version-label", "2026-08-01"]) == 0

    latest = client.get("/api/v1/rulesets/atxxii/latest").json()
    pinned = client.get(f"/api/v1/rulesets/atxxii/versions/{VERSION_LABEL}").json()

    assert latest["versionLabel"] == "2026-08-01"
    assert pinned["versionLabel"] == VERSION_LABEL


def test_lists_rulesets_with_the_version_currently_loaded(client):
    assert cli.main(IMPORT) == 0

    body = client.get("/api/v1/rulesets").json()

    assert len(body) == 1
    assert body[0]["slug"] == "atxxii"
    assert body[0]["latestVersion"]["versionLabel"] == VERSION_LABEL


def test_an_unknown_ruleset_is_a_404(client):
    assert client.get("/api/v1/rulesets/atxxi/latest").status_code == 404


def test_an_unknown_version_is_a_404(client):
    assert cli.main(IMPORT) == 0

    assert client.get("/api/v1/rulesets/atxxii/versions/1999-01-01").status_code == 404
