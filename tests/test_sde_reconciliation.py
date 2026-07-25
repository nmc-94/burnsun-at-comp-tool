"""Reconciling the payload against every hull the game publishes.

The tool offers exactly the hulls the points snapshot names. That is a decision, not an
accident of the data: the rules also price hulls through the class layer, and nine published
hulls are priced that way and no other.

This is the test that keeps the decision a decision. If a later snapshot or static-data build
changes which hulls fall through the class layer, it fails and someone chooses again, rather
than the tool silently refusing a hull that became legal.
"""

from __future__ import annotations

from comptool.ingest import ruleset

#: Tech 2 industrials: four blockade runners and five deep space transports. Each is
#: published, sub-battleship, not built by ORE, not a special edition, and not named in the
#: article's exclusions — and none is listed individually in the snapshot.
CLASS_PRICED_ONLY = {
    "Bustard",
    "Crane",
    "Impel",
    "Mastodon",
    "Occator",
    "Prorator",
    "Prowler",
    "Torrent",
    "Viator",
}


def test_the_only_hulls_left_out_are_the_nine_priced_by_class_alone(payload, ship_index):
    omitted = ruleset.omitted_legal_hulls(payload, ship_index)

    assert {hull.name for hull in omitted} == CLASS_PRICED_ONLY
    assert {hull.group for hull in omitted} == {"Blockade Runner", "Deep Space Transport"}
    assert {hull.tech for hull in omitted} == {"Tech II"}


def test_the_bucket_that_would_price_them_is_served_anyway(payload):
    # The fallback layer is emitted in full even though nothing in this snapshot uses it —
    # it is part of the ruleset, and this bucket is why leaving those nine out is a choice.
    assert payload["classPoints"]["Tech 2 Industrial Ships"] == 10
    listed = [
        ship["name"]
        for ship in payload["ships"].values()
        if ship["shipClass"] == "Tech 2 Industrial Ships"
    ]
    assert listed == ["Deluge"]
