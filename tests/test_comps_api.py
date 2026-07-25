"""The comp API.

Two invariants carry this file.

**A comp you may not see does not exist.** Every way of failing to reach one — no such
comp, a comp in a team you have no grant on, a comp id that belongs to somebody else's
team — has to answer identically, or a comp id becomes a way to enumerate teams.

**The server has no opinion on legality.** It stores what it is sent. A comp that is
eleven ships and eighty points over budget round-trips exactly like a legal one, because
the rules live in the client engine and a second copy here would be a second copy to keep
in step.
"""

from __future__ import annotations

import uuid

from conftest import RULESET_SLUG, VERSION_LABEL

OWNER = 90_000_001
EDITOR = 90_000_002
VIEWER = 90_000_003
STRANGER = 90_000_004

# A few real type ids, so a comp in a test reads like a comp.
ABADDON = 24_692
VINDICATOR = 17_740
RIFTER = 587


def make_team(client, name: str = "Aurora Vanguard") -> dict:
    response = client.post("/api/v1/teams", json={"name": name})
    assert response.status_code == 201
    return response.json()


def make_comp(client, team: dict, name: str = "Angel Shield Kite") -> dict:
    response = client.post(
        f"/api/v1/teams/{team['id']}/comps", json={"name": name, "rulesetSlug": RULESET_SLUG}
    )
    assert response.status_code == 201
    return response.json()


def grant_to(client, team: dict, name: str, level: str) -> None:
    response = client.post(
        f"/api/v1/teams/{team['id']}/grants", json={"characterName": name, "level": level}
    )
    assert response.status_code == 201


def slots(*type_ids: int, flagship: int | None = None) -> dict:
    return {
        "slots": [
            {"typeId": type_id, "isFlagship": index == flagship}
            for index, type_id in enumerate(type_ids)
        ]
    }


def test_creates_a_comp_bound_to_the_current_ruleset_version(client, sign_in, publish):
    publish()
    sign_in(OWNER)
    team = make_team(client)

    comp = make_comp(client, team)

    assert comp["name"] == "Angel Shield Kite"
    assert comp["rulesetSlug"] == RULESET_SLUG
    assert comp["rulesetVersionLabel"] == VERSION_LABEL
    assert comp["slots"] == []
    assert comp["shipCount"] == 0
    assert comp["yourLevel"] == "owner"


def test_a_comp_cannot_be_built_against_a_ruleset_that_was_never_published(
    client, sign_in, publish
):
    sign_in(OWNER)
    team = make_team(client)

    response = client.post(
        f"/api/v1/teams/{team['id']}/comps", json={"name": "Nowhere", "rulesetSlug": "atxxiii"}
    )

    assert response.status_code == 404


def test_slots_round_trip_in_the_order_they_were_sent(client, sign_in, publish):
    publish()
    sign_in(OWNER)
    comp = make_comp(client, make_team(client))

    response = client.put(f"/api/v1/comps/{comp['id']}/slots", json=slots(ABADDON, RIFTER, ABADDON))

    assert response.status_code == 200
    body = response.json()
    assert [slot["typeId"] for slot in body["slots"]] == [ABADDON, RIFTER, ABADDON]
    assert [slot["position"] for slot in body["slots"]] == [0, 1, 2]
    assert body["shipCount"] == 3


def test_replacing_slots_renumbers_from_zero(client, sign_in, publish):
    """Positions are the server's to assign, so a shorter list cannot leave a hole."""
    publish()
    sign_in(OWNER)
    comp = make_comp(client, make_team(client))
    client.put(f"/api/v1/comps/{comp['id']}/slots", json=slots(ABADDON, RIFTER, ABADDON))

    response = client.put(f"/api/v1/comps/{comp['id']}/slots", json=slots(RIFTER))

    assert response.status_code == 200
    assert response.json()["slots"] == [{"position": 0, "typeId": RIFTER, "isFlagship": False}]


def test_the_server_stores_an_illegal_comp_without_complaint(client, sign_in, publish):
    """The one that pins the design: legality is the client's, and the server just stores.

    Eleven battleships is over the field size, far over budget, and four times the
    battleship cap. It saves, and it comes back exactly as sent.
    """
    publish()
    sign_in(OWNER)
    comp = make_comp(client, make_team(client))

    response = client.put(f"/api/v1/comps/{comp['id']}/slots", json=slots(*([ABADDON] * 11)))

    assert response.status_code == 200
    assert response.json()["shipCount"] == 11
    assert [slot["typeId"] for slot in response.json()["slots"]] == [ABADDON] * 11


def test_one_slot_may_be_the_flagship(client, sign_in, publish):
    publish()
    sign_in(OWNER)
    comp = make_comp(client, make_team(client))

    response = client.put(
        f"/api/v1/comps/{comp['id']}/slots", json=slots(ABADDON, VINDICATOR, flagship=1)
    )

    assert response.status_code == 200
    assert [slot["isFlagship"] for slot in response.json()["slots"]] == [False, True]


def test_a_second_flagship_is_refused_and_changes_nothing(client, sign_in, publish):
    """The rule the database also holds, answered in words rather than as an integrity error.

    Note this is the schema's constraint, not the ruleset's: whether a hull is *eligible*
    to be the flagship is a rule, and the client flags it rather than the server refusing.
    """
    publish()
    sign_in(OWNER)
    comp = make_comp(client, make_team(client))
    client.put(f"/api/v1/comps/{comp['id']}/slots", json=slots(ABADDON, VINDICATOR, flagship=0))

    refused = client.put(
        f"/api/v1/comps/{comp['id']}/slots",
        json={
            "slots": [
                {"typeId": ABADDON, "isFlagship": True},
                {"typeId": VINDICATOR, "isFlagship": True},
            ]
        },
    )

    assert refused.status_code == 409
    after = client.get(f"/api/v1/comps/{comp['id']}").json()
    assert [slot["isFlagship"] for slot in after["slots"]] == [True, False]


def test_a_comp_may_not_carry_more_slots_than_one_request_allows(client, sign_in, publish):
    """A request-size bound, not a rule: the field size is the ruleset's business."""
    publish()
    sign_in(OWNER)
    comp = make_comp(client, make_team(client))

    response = client.put(f"/api/v1/comps/{comp['id']}/slots", json=slots(*([RIFTER] * 101)))

    assert response.status_code == 422


def test_a_hidden_comp_and_a_missing_comp_answer_identically(client, sign_in, publish):
    publish()
    sign_in(OWNER)
    comp = make_comp(client, make_team(client))

    sign_in(STRANGER)
    hidden = client.get(f"/api/v1/comps/{comp['id']}")
    missing = client.get(f"/api/v1/comps/{uuid.uuid4()}")

    assert hidden.status_code == missing.status_code == 404
    assert set(hidden.json()) == set(missing.json())
    assert hidden.json()["detail"].startswith("No comp ")


def test_a_hidden_comp_never_answers_in_the_words_of_its_team(client, sign_in, publish):
    """The comp-shaped 404 has to replace the team-shaped one, not sit behind it."""
    publish()
    sign_in(OWNER)
    comp = make_comp(client, make_team(client))

    sign_in(STRANGER)
    hidden = client.get(f"/api/v1/comps/{comp['id']}")

    assert "team" not in hidden.json()["detail"].lower()


def test_a_comp_in_someone_elses_team_is_not_reachable_by_owning_a_team(
    client, sign_in, publish
):
    publish()
    sign_in(OWNER)
    theirs = make_comp(client, make_team(client))

    sign_in(STRANGER)
    make_team(client, name="Nova Collective")
    response = client.get(f"/api/v1/comps/{theirs['id']}")

    assert response.status_code == 404


def test_a_viewer_may_read_a_comp_but_not_edit_it(client, sign_in, publish, resolver):
    publish()
    resolver.knows("Ruzan", VIEWER)
    sign_in(OWNER)
    team = make_team(client)
    grant_to(client, team, "Ruzan", "viewer")
    comp = make_comp(client, team)

    sign_in(VIEWER)
    readable = client.get(f"/api/v1/comps/{comp['id']}")
    renamed = client.patch(f"/api/v1/comps/{comp['id']}", json={"name": "Mine now"})
    edited = client.put(f"/api/v1/comps/{comp['id']}/slots", json=slots(RIFTER))
    removed = client.delete(f"/api/v1/comps/{comp['id']}")

    assert readable.status_code == 200
    assert readable.json()["yourLevel"] == "viewer"
    # A refusal to write reports as a 404 like every other refusal, so a viewer learns
    # nothing from the difference between "may not" and "is not there".
    assert renamed.status_code == edited.status_code == removed.status_code == 404


def test_an_editor_may_build_in_a_team_they_do_not_own(client, sign_in, publish, resolver):
    publish()
    resolver.knows("Salvos", EDITOR)
    sign_in(OWNER)
    team = make_team(client)
    grant_to(client, team, "Salvos", "editor")

    sign_in(EDITOR)
    comp = make_comp(client, team, name="Salvos' draft")
    built = client.put(f"/api/v1/comps/{comp['id']}/slots", json=slots(ABADDON))

    assert built.status_code == 200
    assert comp["yourLevel"] == "editor"


def test_authorship_is_captured_once_and_survives_an_edit_by_someone_else(
    client, sign_in, publish, resolver
):
    publish()
    resolver.knows("Salvos", EDITOR)
    sign_in(OWNER, "Kadir")
    team = make_team(client)
    grant_to(client, team, "Salvos", "editor")
    comp = make_comp(client, team)
    assert comp["createdByName"] == "Kadir"

    sign_in(EDITOR, "Salvos")
    client.patch(f"/api/v1/comps/{comp['id']}", json={"name": "Renamed by Salvos"})
    after = client.put(f"/api/v1/comps/{comp['id']}/slots", json=slots(ABADDON)).json()

    assert after["name"] == "Renamed by Salvos"
    assert after["createdByName"] == "Kadir"


def test_a_comp_stays_bound_to_the_version_it_was_built_against(client, sign_in, publish):
    """A newer ruleset does not reach back and re-point comps built under the old one."""
    publish()
    sign_in(OWNER)
    comp = make_comp(client, make_team(client))

    publish("2026-08-01")
    after = client.get(f"/api/v1/comps/{comp['id']}").json()

    assert after["rulesetVersionLabel"] == VERSION_LABEL


def test_a_comp_created_after_a_new_version_binds_to_the_newer_one(client, sign_in, publish):
    publish()
    publish("2026-08-01")
    sign_in(OWNER)

    comp = make_comp(client, make_team(client))

    assert comp["rulesetVersionLabel"] == "2026-08-01"


def test_listing_a_teams_comps_is_scoped_to_that_team(client, sign_in, publish):
    publish()
    sign_in(OWNER)
    mine = make_team(client)
    other = make_team(client, name="Nova Collective")
    make_comp(client, mine, name="Angel Shield Kite")
    make_comp(client, mine, name="Zenith Rush")
    make_comp(client, other, name="Somewhere else")

    listed = client.get(f"/api/v1/teams/{mine['id']}/comps").json()

    assert [comp["name"] for comp in listed] == ["Angel Shield Kite", "Zenith Rush"]


def test_an_archived_team_refuses_comp_edits_until_it_is_restored(client, sign_in, publish):
    publish()
    sign_in(OWNER)
    team = make_team(client)
    comp = make_comp(client, team)
    client.post(f"/api/v1/teams/{team['id']}/archive")

    blocked = client.put(f"/api/v1/comps/{comp['id']}/slots", json=slots(ABADDON))
    creating = client.post(
        f"/api/v1/teams/{team['id']}/comps", json={"name": "New", "rulesetSlug": RULESET_SLUG}
    )
    # Still plainly readable — archiving is not a loss of permission.
    readable = client.get(f"/api/v1/comps/{comp['id']}")

    assert blocked.status_code == creating.status_code == 409
    assert readable.status_code == 200

    client.post(f"/api/v1/teams/{team['id']}/restore")
    assert client.put(f"/api/v1/comps/{comp['id']}/slots", json=slots(ABADDON)).status_code == 200


def test_a_deleted_comp_is_gone_and_its_team_is_not(client, sign_in, publish):
    publish()
    sign_in(OWNER)
    team = make_team(client)
    comp = make_comp(client, team)

    removed = client.delete(f"/api/v1/comps/{comp['id']}")

    assert removed.status_code == 204
    assert client.get(f"/api/v1/comps/{comp['id']}").status_code == 404
    assert client.get(f"/api/v1/teams/{team['id']}").status_code == 200


def test_a_comp_name_may_not_be_blank(client, sign_in, publish):
    publish()
    sign_in(OWNER)
    team = make_team(client)

    response = client.post(
        f"/api/v1/teams/{team['id']}/comps", json={"name": "   ", "rulesetSlug": RULESET_SLUG}
    )

    assert response.status_code == 422


def test_every_comp_route_needs_a_session(client, publish):
    publish()
    team_id = uuid.uuid4()
    comp_id = uuid.uuid4()

    answers = [
        client.get(f"/api/v1/teams/{team_id}/comps"),
        client.post(f"/api/v1/teams/{team_id}/comps", json={"name": "x", "rulesetSlug": "atxxii"}),
        client.get(f"/api/v1/comps/{comp_id}"),
        client.patch(f"/api/v1/comps/{comp_id}", json={"name": "x"}),
        client.put(f"/api/v1/comps/{comp_id}/slots", json=slots(RIFTER)),
        client.delete(f"/api/v1/comps/{comp_id}"),
    ]

    assert [answer.status_code for answer in answers] == [401] * 6
