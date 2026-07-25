"""Storing a ruleset version.

The shared step behind both the maintainer's import and the deployment's seed, so its
edges are worth pinning once here rather than twice through the things that call it.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from sqlalchemy import select

from comptool.ingest.store import VersionAlreadyImported, capture_date, store_version
from comptool.models import Ruleset, RulesetVersion

PAYLOAD = {"version": "2026-07-23", "ships": {}}

DETAILS = {
    "slug": "atxxii",
    "name": "Alliance Tournament XXII",
    "organizer": "Fenris Creations",
    "source_url": "https://example.invalid/points.csv",
}


def test_storing_a_version_creates_the_ruleset_on_first_import(session):
    store_version(session, payload=PAYLOAD, version_label="2026-07-23", **DETAILS)
    session.commit()

    stored = session.scalars(select(Ruleset)).one()
    assert stored.slug == "atxxii"
    assert stored.organizer == "Fenris Creations"


def test_storing_a_second_version_reuses_the_ruleset(session):
    store_version(session, payload=PAYLOAD, version_label="2026-07-23", **DETAILS)
    store_version(session, payload=PAYLOAD, version_label="2026-08-01", **DETAILS)
    session.commit()

    assert len(session.scalars(select(Ruleset)).all()) == 1
    assert len(session.scalars(select(RulesetVersion)).all()) == 2


def test_storing_a_duplicate_label_is_refused(session):
    store_version(session, payload=PAYLOAD, version_label="2026-07-23", **DETAILS)
    session.commit()

    with pytest.raises(VersionAlreadyImported, match="immutable snapshot"):
        store_version(session, payload=PAYLOAD, version_label="2026-07-23", **DETAILS)


def test_storing_does_not_commit(session):
    # The caller owns the transaction, which is what lets a command and a request share
    # this without either guessing about the other's boundaries.
    store_version(session, payload=PAYLOAD, version_label="2026-07-23", **DETAILS)
    session.rollback()

    assert session.scalars(select(RulesetVersion)).all() == []


def test_a_date_shaped_label_becomes_the_capture_date():
    assert capture_date("2026-07-23") == datetime(2026, 7, 23, tzinfo=UTC)


def test_a_free_form_label_falls_back_to_the_import_time():
    # Labels are free-form by design; one that carries no date must not be a traceback.
    stamped = capture_date("mid-season-revision")

    assert stamped.tzinfo is not None
    assert (datetime.now(tz=UTC) - stamped).total_seconds() < 60


def test_a_free_form_label_can_be_stored(session):
    store_version(session, payload=PAYLOAD, version_label="mid-season", **DETAILS)
    session.commit()

    assert session.scalars(select(RulesetVersion)).one().version_label == "mid-season"
