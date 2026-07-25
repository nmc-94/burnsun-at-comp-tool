"""The ruleset that ships with the application.

Two things to hold onto. The bundled payload must be exactly what the ingester produces
from the committed sources — otherwise the app serves data nothing can reproduce. And
seeding has to be safe to run on every container start, because that is where it runs.
"""

from __future__ import annotations

from sqlalchemy import select

from comptool.ingest import bundled, cli
from comptool.models import Ruleset, RulesetVersion
from conftest import VERSION_LABEL


def test_the_bundled_payload_is_what_the_ingester_emits(payload):
    # The same guard the committed engine fixture gets. If this drifts, the deployment
    # publishes a ruleset that no source in the repo produces.
    assert bundled.payloads() == [payload]


def test_the_bundled_payload_names_its_own_version():
    # The label comes from inside the file, so nothing has to agree about filenames.
    assert bundled.payloads()[0]["version"] == VERSION_LABEL


def test_seeding_publishes_the_bundled_ruleset(session):
    added = bundled.seed(session)
    session.commit()

    assert [version.version_label for version in added] == [VERSION_LABEL]
    stored = session.scalars(select(RulesetVersion)).one()
    assert stored.version_label == VERSION_LABEL
    assert stored.ruleset.slug == "atxxii"
    assert stored.ruleset.organizer == "Fenris Creations"
    assert stored.fetched_at.date().isoformat() == VERSION_LABEL


def test_seeding_again_changes_nothing(session):
    # This runs on every container start, so a restart must be a no-op rather than an
    # error and must never publish a second copy.
    bundled.seed(session)
    session.commit()

    assert bundled.seed(session) == []
    session.commit()

    assert len(session.scalars(select(RulesetVersion)).all()) == 1
    assert len(session.scalars(select(Ruleset)).all()) == 1


def test_the_seed_command_is_idempotent(session, capsys):
    assert cli.main(["seed"]) == 0
    assert cli.main(["seed"]) == 0

    assert "already published" in capsys.readouterr().err
    assert len(session.scalars(select(RulesetVersion)).all()) == 1


def test_the_seeded_version_is_served_by_the_public_route(client, payload):
    assert cli.main(["seed"]) == 0

    response = client.get("/api/v1/rulesets/atxxii/latest")

    assert response.status_code == 200
    body = response.json()
    assert body["versionLabel"] == VERSION_LABEL
    assert body["payload"] == payload


def test_the_seeded_ruleset_is_readable_without_signing_in(client):
    # Published tournament data. The SPA renders it before anyone has an identity.
    assert cli.main(["seed"]) == 0

    assert client.get("/api/v1/rulesets").json()[0]["latestVersion"]["versionLabel"] == (
        VERSION_LABEL
    )
