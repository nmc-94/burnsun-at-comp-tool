"""Resolving ship names to EVE type ids.

The whole ruleset hangs off this step: a name that resolves to the wrong hull produces a
payload that looks entirely correct and prices the wrong ship. So the tests that matter here
are the ones about refusing to guess.
"""

from __future__ import annotations

import pytest

from comptool.ingest import sde
from comptool.ingest.errors import IngestError


def hull(name: str, type_id: int) -> sde.ShipReference:
    return sde.ShipReference(
        type_id=type_id,
        name=name,
        group="Frigate",
        group_id=25,
        tech="Tech I",
        faction=None,
        special_edition=False,
    )


def index_of(*hulls: sde.ShipReference) -> sde.ShipIndex:
    return sde.ShipIndex(
        source="https://example.invalid/sde.zip",
        sde_build=1,
        sde_release_date="2026-01-01T00:00:00Z",
        hulls=hulls,
    )


def test_the_committed_index_describes_one_static_data_build(ship_index):
    assert ship_index.sde_build == 3444265
    assert ship_index.sde_release_date.startswith("2026-07-23")
    assert len(ship_index.hulls) == 423


def test_every_hull_in_the_points_table_resolves(snapshot, ship_index):
    resolved = ship_index.resolve(row.name for row in snapshot.ship_rows)

    assert len(resolved) == len(snapshot.ship_rows)
    assert resolved["Rifter"] == 587
    assert resolved["Geri"] == 74141


def test_no_two_published_hulls_share_a_name(ship_index):
    assert [name for name, hulls in ship_index.by_name().items() if len(hulls) > 1] == []


def test_carries_what_the_blanket_exclusions_are_read_from(ship_index):
    by_name = ship_index.by_name()
    # Everything ORE builds is excluded, and so is every special edition; both are stated
    # by the static data rather than listed hull by hull.
    assert by_name["Venture"][0].faction == "ORE"
    assert by_name["Praxis"][0].special_edition is True
    assert by_name["Rifter"][0].special_edition is False


def test_an_unknown_name_fails_loudly_and_names_itself():
    with pytest.raises(IngestError, match="unresolved: Cormorant"):
        index_of(hull("Rifter", 587)).resolve(["Rifter", "Cormorant"])


def test_an_ambiguous_name_fails_rather_than_picking_one():
    with pytest.raises(IngestError, match=r"ambiguous: Rifter \(587, 999\)"):
        index_of(hull("Rifter", 587), hull("Rifter", 999)).resolve(["Rifter"])


def test_a_malformed_document_is_rejected():
    with pytest.raises(IngestError, match="malformed"):
        sde.from_document({"source": "x", "sde_build": 1, "hulls": []})


def test_the_index_round_trips(ship_index):
    assert sde.from_document(ship_index.to_document()) == ship_index
