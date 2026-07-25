"""The assembled payload.

These pin the three things the snapshot cannot state for itself: that the fallback layer holds
only genuine buckets, that exclusion is carried by omission rather than a flag, and that §8's
ban phase is carried whole with its two statements of the same count still agreeing. All three
are easy to get subtly wrong in a way that still produces a payload that looks right.
"""

from __future__ import annotations

import collections
import dataclasses
import json

import pytest

from comptool.ingest import atxxii, ruleset, schema
from comptool.ingest.errors import IngestError
from conftest import ENGINE_FIXTURE, VERSION_LABEL


def replace_first_ship(snapshot, **changes):
    first = dataclasses.replace(snapshot.ship_rows[0], **changes)
    return dataclasses.replace(snapshot, ship_rows=(first, *snapshot.ship_rows[1:]))


def test_validates_against_the_payload_schema(payload):
    assert schema.Ruleset.model_validate(payload).version == VERSION_LABEL


def test_carries_the_constants_the_snapshot_does_not(payload):
    assert payload["pointCap"] == 200
    assert payload["fieldSize"] == 10
    assert payload["hullSizeCaps"]["Battleship"] == 2
    assert payload["hullSizeCaps"]["Cruiser"] == 3
    assert payload["logisticsLimits"] == {"cruiser": 1, "frigate": 2, "exclusive": True}
    assert payload["flagship"] == {"allowed": True, "battleshipAllowance": 3}


def test_lists_exactly_the_hulls_the_snapshot_prices(payload, snapshot):
    assert len(payload["ships"]) == len(snapshot.ship_rows) == 278
    assert all(ship["points"] is not None for ship in payload["ships"].values())


def test_the_fallback_layer_holds_only_generic_buckets(payload):
    class_points = payload["classPoints"]

    assert len(class_points) == 42
    assert class_points["Battleship"] == 40
    assert class_points["Cruiser"] == 9
    # A per-hull override expressed as a class row must not become a bucket, or every hull
    # would fall back to itself and the layer could never differ from the individual value.
    assert "Megathron (Battleship)" not in class_points
    assert "Megathron" not in class_points


def test_the_rookie_ship_row_survives_as_a_bucket(payload):
    # Its parenthetical is a hull size, not a bucket, so the naive reading would lose it and
    # leave the four racial corvettes pointing at a class that does not exist.
    assert payload["classPoints"]["Rookie Ship"] == 1
    by_name = {ship["name"]: ship for ship in payload["ships"].values()}
    assert by_name["Impairor"]["shipClass"] == "Rookie Ship"
    assert by_name["Impairor"]["hullSize"] == "Corvette"


def test_only_the_uniques_lack_a_bucket_to_fall_back_to(payload):
    outside = {
        ship["shipClass"]
        for ship in payload["ships"].values()
        if ship["shipClass"] not in payload["classPoints"]
    }
    assert outside == set(atxxii.UNIQUE_CLASS_LABELS)
    # They never need one: each is priced individually.
    assert all(
        ship["points"] is not None
        for ship in payload["ships"].values()
        if ship["shipClass"] in outside
    )


def test_maps_hull_type_to_a_size_plus_a_logistics_exemption(payload):
    ships = payload["ships"].values()
    sizes = collections.Counter(ship["hullSize"] for ship in ships)
    logistics = collections.Counter(ship["logisticsGroup"] for ship in ships)

    assert dict(sizes) == {
        "Corvette": 9,
        "Frigate": 82,
        "Destroyer": 35,
        "Cruiser": 67,
        "Battlecruiser": 33,
        "Battleship": 38,
        "Industrial": 14,
    }
    # Logistics hulls keep the size they really are and are exempted by group instead.
    assert logistics["cruiser"] == 10
    assert logistics["frigate"] == 8
    by_name = {ship["name"]: ship for ship in ships}
    assert (by_name["Scimitar"]["hullSize"], by_name["Scimitar"]["logisticsGroup"]) == (
        "Cruiser",
        "cruiser",
    )
    assert (by_name["Scalpel"]["hullSize"], by_name["Scalpel"]["logisticsGroup"]) == (
        "Frigate",
        "frigate",
    )


def test_reads_inflation_verbatim(payload):
    by_name = {ship["name"]: ship for ship in payload["ships"].values()}
    assert by_name["Geri"]["inflationValue"] == 3
    assert by_name["Shapash"]["inflationValue"] == 0
    assert by_name["Abaddon"]["inflationValue"] == 4


def test_nothing_is_flagged_banned_because_omission_does_the_work(payload):
    assert [ship for ship in payload["ships"].values() if ship["banned"]] == []
    names = {ship["name"] for ship in payload["ships"].values()}
    assert names.isdisjoint(atxxii.EXCLUDED_HULLS)


def test_every_battleship_but_the_bhaalgorn_may_be_the_flagship(payload):
    eligible = [ship for ship in payload["ships"].values() if ship["flagshipEligible"]]
    by_name = {ship["name"]: ship for ship in payload["ships"].values()}

    assert len(eligible) == 37
    assert {ship["hullSize"] for ship in eligible} == {"Battleship"}
    assert by_name["Bhaalgorn"]["flagshipEligible"] is False
    # A special edition the rules permit explicitly, and read as a battleship like any other.
    assert by_name["Praxis"]["flagshipEligible"] is True


def test_carries_the_ban_phase(payload):
    # Asserted whole rather than field by field: the sequence *is* the rule, and a round
    # quietly gaining or losing a ban is the failure this is here to catch.
    assert payload["banPhase"] == {
        "sequence": [
            {"side": "red", "bans": 1, "inPrelims": True},
            {"side": "blue", "bans": 2, "inPrelims": True},
            {"side": "red", "bans": 2, "inPrelims": True},
            {"side": "blue", "bans": 1, "inPrelims": True},
            {"side": "red", "bans": 1, "inPrelims": False},
            {"side": "blue", "bans": 1, "inPrelims": False},
        ],
        "caps": {"perHullSize": 3, "logistics": 2},
    }


def test_the_ban_sequence_adds_up_to_what_each_captain_has(payload):
    # The reader's half of the check the ingester makes. Distinct from it on purpose: this one
    # runs against the shipped file, so it also catches a payload edited by hand.
    rounds = payload["banPhase"]["sequence"]
    for tournament, expected in (("main", 4), ("prelims", 3)):
        played = [r for r in rounds if tournament == "main" or r["inPrelims"]]
        for side in ("red", "blue"):
            assert sum(r["bans"] for r in played if r["side"] == side) == expected


def test_the_prelims_drop_the_last_round_of_each_side(payload):
    rounds = payload["banPhase"]["sequence"]
    dropped = [index for index, entry in enumerate(rounds) if not entry["inPrelims"]]

    # §8 excludes "the last round of each side", which for this sequence is the trailing pair
    # — the coincidence a leading-round count would have encoded as if it were the rule.
    assert dropped == [4, 5]
    assert [rounds[index]["side"] for index in dropped] == ["red", "blue"]


def test_the_logistics_ban_cap_covers_exactly_the_hulls_the_article_names(payload):
    # The cap keys off logisticsGroup rather than its own list, which is only sound while the
    # two describe the same eighteen hulls.
    grouped = {
        ship["name"] for ship in payload["ships"].values() if ship["logisticsGroup"] is not None
    }
    assert grouped == set(atxxii.LOGISTICS_BANNABLE_HULLS)
    assert len(grouped) == 18


def test_stops_if_the_ban_sequence_stops_adding_up(monkeypatch, snapshot, ship_index):
    # A dropped round still produces a well-formed phase; only the total says otherwise.
    monkeypatch.setattr(atxxii, "BAN_SEQUENCE", atxxii.BAN_SEQUENCE[:-2])
    with pytest.raises(IngestError, match="the main ban sequence gives red 3 bans, not 4"):
        ruleset.build(snapshot, ship_index, VERSION_LABEL)


def test_stops_if_the_logistics_roster_parts_from_the_group_flag(monkeypatch, snapshot, ship_index):
    monkeypatch.setattr(
        atxxii, "LOGISTICS_BANNABLE_HULLS", atxxii.LOGISTICS_BANNABLE_HULLS | {"Rifter"}
    )
    with pytest.raises(IngestError, match=r"no longer the ones .8 caps: missing \['Rifter'\]"):
        ruleset.build(snapshot, ship_index, VERSION_LABEL)


def test_stops_if_the_snapshot_ever_prices_a_hull_the_rules_exclude(snapshot, ship_index):
    # Omission is what bans these. The moment one appears in the table, that stops being
    # true and the payload would quietly make it legal.
    listed = replace_first_ship(snapshot, name="Nestor")
    with pytest.raises(IngestError, match="omission no longer bans them: Nestor"):
        ruleset.build(listed, ship_index, VERSION_LABEL)


def test_stops_on_an_unmapped_hull_type(snapshot, ship_index):
    with pytest.raises(IngestError, match="unknown Hull Type 'Capital'"):
        ruleset.build(replace_first_ship(snapshot, hull_type="Capital"), ship_index, VERSION_LABEL)


def test_stops_on_a_class_that_is_neither_a_bucket_nor_a_known_unique(snapshot, ship_index):
    unknown = replace_first_ship(snapshot, ship_class="Escort Frigate")
    with pytest.raises(IngestError, match="neither a bucket in the class table nor a known"):
        ruleset.build(unknown, ship_index, VERSION_LABEL)


def test_the_committed_engine_fixture_is_not_stale(payload):
    # The Vitest contract test reads this file. If it drifts from what the ingester emits,
    # that test goes on passing against data nothing produces any more.
    assert json.loads(ENGINE_FIXTURE.read_text(encoding="utf-8")) == payload
