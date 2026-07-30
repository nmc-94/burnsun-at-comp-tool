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


def placed(*rows: tuple[int, int]) -> dict:
    """Hulls on named rows: ``placed((0, ABADDON), (4, RIFTER))``.

    The shape a client sends once somebody has arranged a comp — turned the tile's sort off
    and left rows empty between groups of hulls. `slots` above is the other half of the same
    route: a comp nobody has arranged says nothing about rows and is numbered by list order.
    """
    return {
        "slots": [
            {"typeId": type_id, "isFlagship": False, "position": position}
            for position, type_id in rows
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


def test_replacing_slots_moves_the_comps_updated_at(client, sign_in, publish):
    """Editing a comp's hulls is editing the comp.

    ``onupdate`` fires only when the *comp* row is in an UPDATE, and replacing slots writes
    ``comp_slot`` rows instead — so this went unmoved for five phases. Anything that asks
    "has this comp changed since?" reads this field, so a stale one is not a cosmetic problem.
    """
    publish()
    sign_in(OWNER)
    comp = make_comp(client, make_team(client))

    after = client.put(f"/api/v1/comps/{comp['id']}/slots", json=slots(ABADDON)).json()

    assert after["updatedAt"] > comp["updatedAt"]


def test_replacing_slots_renumbers_from_zero_when_the_client_names_no_rows(
    client, sign_in, publish
):
    """A caller with nothing to say about rows gets list order, and cannot leave a hole."""
    publish()
    sign_in(OWNER)
    comp = make_comp(client, make_team(client))
    client.put(f"/api/v1/comps/{comp['id']}/slots", json=slots(ABADDON, RIFTER, ABADDON))

    response = client.put(f"/api/v1/comps/{comp['id']}/slots", json=slots(RIFTER))

    assert response.status_code == 200
    assert response.json()["slots"] == [{"position": 0, "typeId": RIFTER, "isFlagship": False}]


def test_a_comp_may_leave_rows_empty_between_its_hulls(client, sign_in, publish):
    """The arrangement is the client's, because only the client draws the scaffold it is in.

    A builder who turns the tile's sort off groups hulls — a wing, then its logistics, then the
    tackle — and the gaps between the groups are part of what they arranged. Deriving positions
    from list order, which is what this route used to do, could not express one.
    """
    publish()
    sign_in(OWNER)
    comp = make_comp(client, make_team(client))

    response = client.put(
        f"/api/v1/comps/{comp['id']}/slots", json=placed((0, ABADDON), (4, RIFTER), (5, VINDICATOR))
    )

    assert response.status_code == 200
    assert [slot["position"] for slot in response.json()["slots"]] == [0, 4, 5]
    assert [slot["typeId"] for slot in response.json()["slots"]] == [ABADDON, RIFTER, VINDICATOR]
    # And it is the comp's shape now, not one client's view of it: a reload reads it back.
    reread = client.get(f"/api/v1/comps/{comp['id']}").json()
    assert [slot["position"] for slot in reread["slots"]] == [0, 4, 5]
    # Rows are not hulls. A comp of three that happens to reach row five is still three ships.
    assert reread["shipCount"] == 3


def test_slots_come_back_in_row_order_however_they_were_sent(client, sign_in, publish):
    """Every reader takes the list as ordered — the rail, the tile, a fork, a share snapshot."""
    publish()
    sign_in(OWNER)
    comp = make_comp(client, make_team(client))

    response = client.put(
        f"/api/v1/comps/{comp['id']}/slots", json=placed((7, ABADDON), (2, RIFTER))
    )

    assert [slot["position"] for slot in response.json()["slots"]] == [2, 7]
    assert [slot["typeId"] for slot in response.json()["slots"]] == [RIFTER, ABADDON]


def test_a_request_may_not_number_only_some_of_its_slots(client, sign_in, publish):
    """Half-numbered is a half-migrated client, not a comp with gaps.

    The one number that cannot be guessed is the one that matters, so filling the rest in from
    list order would put hulls somewhere nobody asked for.
    """
    publish()
    sign_in(OWNER)
    comp = make_comp(client, make_team(client))

    response = client.put(
        f"/api/v1/comps/{comp['id']}/slots",
        json={
            "slots": [
                {"typeId": ABADDON, "isFlagship": False, "position": 3},
                {"typeId": RIFTER, "isFlagship": False},
            ]
        },
    )

    assert response.status_code == 422
    assert client.get(f"/api/v1/comps/{comp['id']}").json()["slots"] == []


def test_two_slots_may_not_share_a_row(client, sign_in, publish):
    """Refused here so it is answered as the request's fault, not as the database's 500."""
    publish()
    sign_in(OWNER)
    comp = make_comp(client, make_team(client))

    response = client.put(
        f"/api/v1/comps/{comp['id']}/slots", json=placed((2, ABADDON), (2, RIFTER))
    )

    assert response.status_code == 422
    assert client.get(f"/api/v1/comps/{comp['id']}").json()["slots"] == []


def test_a_row_number_past_the_ceiling_is_refused(client, sign_in, publish):
    """The same bound the list length has. A row is a place in a scaffold, not an integer."""
    publish()
    sign_in(OWNER)
    comp = make_comp(client, make_team(client))

    assert (
        client.put(f"/api/v1/comps/{comp['id']}/slots", json=placed((100, ABADDON))).status_code
        == 422
    )
    assert (
        client.put(f"/api/v1/comps/{comp['id']}/slots", json=placed((-1, ABADDON))).status_code
        == 422
    )


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


def test_a_comps_slots_version_moves_when_its_hulls_do(client, sign_in, publish):
    publish()
    sign_in(OWNER)
    comp = make_comp(client, make_team(client))
    assert comp["slotsVersion"] == 0

    once = client.put(f"/api/v1/comps/{comp['id']}/slots", json=slots(ABADDON)).json()
    twice = client.put(f"/api/v1/comps/{comp['id']}/slots", json=slots(ABADDON, RIFTER)).json()

    assert once["slotsVersion"] == 1
    assert twice["slotsVersion"] == 2


def test_renaming_or_retagging_a_comp_leaves_its_slots_version_where_it_was(
    client, sign_in, publish
):
    """The reason this counter is not ``updated_at``, stated as a test.

    A rename and a hull change commute. If either bumped this, one person renaming a comp would
    refuse another person's hull edit — a conflict that does not exist, and whose only remedy is
    to throw away real work. Both of those routes *do* move ``updated_at``, which is exactly why
    that field could not be the precondition.
    """
    publish()
    sign_in(OWNER)
    comp = make_comp(client, make_team(client))
    based_on = client.put(f"/api/v1/comps/{comp['id']}/slots", json=slots(ABADDON)).json()

    renamed = client.patch(f"/api/v1/comps/{comp['id']}", json={"name": "Shield Kite"}).json()
    retagged = client.put(
        f"/api/v1/comps/{comp['id']}/tags", json={"archetype": "Kiter", "tags": ["angel"]}
    ).json()

    assert renamed["slotsVersion"] == based_on["slotsVersion"]
    assert retagged["slotsVersion"] == based_on["slotsVersion"]
    # Both moved the comp, though — so the two fields are saying different things rather than
    # one of them being broken.
    assert retagged["updatedAt"] > based_on["updatedAt"]


def test_a_save_based_on_the_current_version_is_accepted(client, sign_in, publish):
    publish()
    sign_in(OWNER)
    comp = make_comp(client, make_team(client))
    current = client.put(f"/api/v1/comps/{comp['id']}/slots", json=slots(ABADDON)).json()

    response = client.put(
        f"/api/v1/comps/{comp['id']}/slots",
        json=slots(ABADDON, RIFTER),
        headers={"If-Match": f'"{current["slotsVersion"]}"'},
    )

    assert response.status_code == 200
    assert [slot["typeId"] for slot in response.json()["slots"]] == [ABADDON, RIFTER]


def test_a_save_that_would_overwrite_somebody_elses_is_refused_and_changes_nothing(
    client, sign_in, publish, resolver
):
    """The whole point of the column, and the loss it exists to stop.

    412 rather than 409, and that is not cosmetic: this route already spends 409 on the archived
    team and on a second flagship, so a third meaning would be one no client could branch on.
    """
    publish()
    resolver.knows("Ayla", EDITOR)
    sign_in(OWNER)
    team = make_team(client)
    comp = make_comp(client, team)
    grant_to(client, team, "Ayla", "editor")
    stale = client.put(f"/api/v1/comps/{comp['id']}/slots", json=slots(ABADDON)).json()

    # Somebody else saves in the meantime. Same route, no precondition — they had no reason to
    # think anything was in flight.
    sign_in(EDITOR, "Ayla")
    client.put(f"/api/v1/comps/{comp['id']}/slots", json=slots(ABADDON, VINDICATOR))

    # And the first editor's debounce finally fires, based on the version they last saw.
    sign_in(OWNER)
    refused = client.put(
        f"/api/v1/comps/{comp['id']}/slots",
        json=slots(ABADDON, RIFTER),
        headers={"If-Match": f'"{stale["slotsVersion"]}"'},
    )

    assert refused.status_code == 412
    after = client.get(f"/api/v1/comps/{comp['id']}").json()
    assert [slot["typeId"] for slot in after["slots"]] == [ABADDON, VINDICATOR]
    assert after["slotsVersion"] == stale["slotsVersion"] + 1


def test_a_refusal_says_something_a_person_can_read(client, sign_in, publish, resolver):
    """``messageFor`` renders a string ``detail`` and nothing else, so this has to be one.

    The refusal deliberately carries no comp: the answer to it is somebody deciding to take the
    server's version, and the click that says so re-reads the comp anyway.
    """
    publish()
    resolver.knows("Ayla", EDITOR)
    sign_in(OWNER)
    team = make_team(client)
    comp = make_comp(client, team)
    grant_to(client, team, "Ayla", "editor")
    stale = client.put(f"/api/v1/comps/{comp['id']}/slots", json=slots(ABADDON)).json()

    sign_in(EDITOR, "Ayla")
    client.put(f"/api/v1/comps/{comp['id']}/slots", json=slots(VINDICATOR))

    sign_in(OWNER)
    refused = client.put(
        f"/api/v1/comps/{comp['id']}/slots",
        json=slots(RIFTER),
        headers={"If-Match": f'"{stale["slotsVersion"]}"'},
    )

    assert isinstance(refused.json()["detail"], str)
    assert "Reload" in refused.json()["detail"]


def test_a_save_that_names_no_version_is_still_unconditional(
    client, sign_in, publish, resolver
):
    """Every caller that is not the SPA is in this case, and keeps what it always had."""
    publish()
    resolver.knows("Ayla", EDITOR)
    sign_in(OWNER)
    team = make_team(client)
    comp = make_comp(client, team)
    grant_to(client, team, "Ayla", "editor")
    client.put(f"/api/v1/comps/{comp['id']}/slots", json=slots(ABADDON))

    sign_in(EDITOR, "Ayla")
    client.put(f"/api/v1/comps/{comp['id']}/slots", json=slots(ABADDON, VINDICATOR))

    sign_in(OWNER)
    response = client.put(f"/api/v1/comps/{comp['id']}/slots", json=slots(RIFTER))

    assert response.status_code == 200
    assert [slot["typeId"] for slot in response.json()["slots"]] == [RIFTER]


def test_a_star_means_any_version_the_way_http_says_it_does(client, sign_in, publish):
    publish()
    sign_in(OWNER)
    comp = make_comp(client, make_team(client))
    client.put(f"/api/v1/comps/{comp['id']}/slots", json=slots(ABADDON))

    response = client.put(
        f"/api/v1/comps/{comp['id']}/slots", json=slots(RIFTER), headers={"If-Match": "*"}
    )

    assert response.status_code == 200


def test_a_version_may_be_spelled_quoted_weak_or_bare(client, sign_in, publish):
    """Lenient on purpose: HTTP quotes an entity tag, and a hand-written request will not."""
    publish()
    sign_in(OWNER)
    comp = make_comp(client, make_team(client))
    path = f"/api/v1/comps/{comp['id']}/slots"

    # Ascending, because each accepted save bumps the version — so a spelling that failed to
    # parse would be read as a mismatch against the next number and answer 412 rather than 200.
    # That is what makes three 200s evidence about the parsing rather than about the numbers.
    for spelling in ('"0"', 'W/"1"', "2"):
        response = client.put(path, json=slots(ABADDON), headers={"If-Match": spelling})
        assert response.status_code == 200, spelling


def test_a_precondition_that_is_not_a_version_is_named_rather_than_absorbed(
    client, sign_in, publish
):
    """400, and deliberately not 412.

    412 says the precondition was well formed and false, which would send a client with a
    formatting bug off to reload a comp that has not moved.
    """
    publish()
    sign_in(OWNER)
    comp = make_comp(client, make_team(client))

    refused = client.put(
        f"/api/v1/comps/{comp['id']}/slots",
        json=slots(ABADDON),
        headers={"If-Match": '"deadbeef"'},
    )

    assert refused.status_code == 400
    assert client.get(f"/api/v1/comps/{comp['id']}").json()["slots"] == []


def test_the_two_meanings_409_already_carries_on_this_route_are_untouched(
    client, sign_in, publish
):
    """The reason the refusal above is 412. If either of these ever becomes 412, that broke."""
    publish()
    sign_in(OWNER)
    team = make_team(client)
    comp = make_comp(client, team)

    two_flagships = client.put(
        f"/api/v1/comps/{comp['id']}/slots",
        json={
            "slots": [
                {"typeId": ABADDON, "isFlagship": True},
                {"typeId": VINDICATOR, "isFlagship": True},
            ]
        },
    )
    assert two_flagships.status_code == 409

    client.post(f"/api/v1/teams/{team['id']}/archive")
    archived = client.put(f"/api/v1/comps/{comp['id']}/slots", json=slots(ABADDON))
    assert archived.status_code == 409


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
    # The id beside the name, and it is the one the delete rule reads: a client asking "is
    # this mine" cannot ask it of a name somebody could rename themselves into.
    assert after["createdByCharacterId"] == OWNER


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


def test_the_comp_listing_carries_each_comps_slots_so_the_rail_can_judge_them(
    client, sign_in, publish
):
    """Legality is computed in the browser, so a comp without its slots cannot be judged."""
    publish()
    sign_in(OWNER)
    team = make_team(client)
    built = make_comp(client, team, name="Angel Shield Kite")
    make_comp(client, team, name="Zenith Rush")
    client.put(f"/api/v1/comps/{built['id']}/slots", json=slots(ABADDON, VINDICATOR, flagship=1))

    listed = client.get(f"/api/v1/teams/{team['id']}/comps").json()

    assert [slot["typeId"] for slot in listed[0]["slots"]] == [ABADDON, VINDICATOR]
    assert listed[0]["slots"][1]["isFlagship"] is True
    assert [comp["shipCount"] for comp in listed] == [2, 0]
    assert listed[1]["slots"] == []


def test_the_listing_and_the_detail_agree_on_a_comp(client, sign_in, publish):
    """One comp shape. A lighter one would be a second thing to keep in step."""
    publish()
    sign_in(OWNER)
    team = make_team(client)
    comp = make_comp(client, team)
    client.put(f"/api/v1/comps/{comp['id']}/slots", json=slots(RIFTER))

    listed = client.get(f"/api/v1/teams/{team['id']}/comps").json()
    fetched = client.get(f"/api/v1/comps/{comp['id']}").json()

    assert listed == [fetched]


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


def test_an_editor_may_not_delete_a_comp_somebody_else_made(client, sign_in, publish, resolver):
    """Editing someone else's draft is collaboration. Discarding it is not.

    A 403 rather than the 404 the other refusals give, and that is the point: this comp is
    plainly visible in the rail to the character being refused, so answering "no such comp"
    would be a lie they could see through. What they are being told is whose it is.
    """
    publish()
    resolver.knows("Salvos", EDITOR)
    sign_in(OWNER, "Kadir")
    team = make_team(client)
    grant_to(client, team, "Salvos", "editor")
    comp = make_comp(client, team)

    sign_in(EDITOR, "Salvos")
    refused = client.delete(f"/api/v1/comps/{comp['id']}")
    # Still an editor in every other respect — the refusal is about authorship, not level.
    built = client.put(f"/api/v1/comps/{comp['id']}/slots", json=slots(ABADDON))

    assert refused.status_code == 403
    assert built.status_code == 200


def test_an_editor_may_delete_the_comp_they_made_themselves(client, sign_in, publish, resolver):
    publish()
    resolver.knows("Salvos", EDITOR)
    sign_in(OWNER)
    team = make_team(client)
    grant_to(client, team, "Salvos", "editor")

    sign_in(EDITOR, "Salvos")
    mine = make_comp(client, team, name="Salvos' draft")
    removed = client.delete(f"/api/v1/comps/{mine['id']}")

    assert removed.status_code == 204


def test_a_team_owner_may_delete_a_comp_they_did_not_make(client, sign_in, publish, resolver):
    """Without this, a comp outlives its author's membership and nobody can remove it.

    There is no way to hand a comp to a new author, so the owner clause is what keeps a
    departed member's drafts from becoming permanent fixtures in the team's library.
    """
    publish()
    resolver.knows("Salvos", EDITOR)
    sign_in(OWNER)
    team = make_team(client)
    grant_to(client, team, "Salvos", "editor")

    sign_in(EDITOR, "Salvos")
    theirs = make_comp(client, team, name="Salvos' draft")

    sign_in(OWNER)
    removed = client.delete(f"/api/v1/comps/{theirs['id']}")

    assert removed.status_code == 204
    assert client.get(f"/api/v1/comps/{theirs['id']}").status_code == 404


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
        client.put(f"/api/v1/comps/{comp_id}/tags", json={"archetype": "Kite", "tags": []}),
        client.post(f"/api/v1/comps/{comp_id}/fork", json={"name": "x"}),
        client.delete(f"/api/v1/comps/{comp_id}"),
    ]

    assert [answer.status_code for answer in answers] == [401] * 8


# --- Forking, and the version a fork lands on ----------------------------------------------


def fork(client, comp: dict, name: str = "Angel Shield Kite (fork)", **body) -> dict:
    response = client.post(f"/api/v1/comps/{comp['id']}/fork", json={"name": name, **body})
    assert response.status_code == 201, response.text
    return response.json()


def test_a_fork_stays_on_the_ruleset_version_its_parent_was_priced_by(client, sign_in, publish):
    """The decision this route exists to hold.

    A fork is taken to be compared against its parent. Landing it on whatever version has
    published since would mean the two comps on screen are priced by different point tables,
    and the difference a captain reads as "this variant costs three more" would partly be the
    ruleset moving underneath them.
    """
    publish("2026-07-23")
    sign_in(OWNER)
    parent = make_comp(client, make_team(client))
    client.put(f"/api/v1/comps/{parent['id']}/slots", json=slots(ABADDON, RIFTER))
    # A newer version publishes between the parent being built and the fork being taken.
    publish("2026-08-01")

    forked = fork(client, parent)

    assert forked["rulesetVersionLabel"] == "2026-07-23"
    assert forked["rulesetVersionLabel"] == parent["rulesetVersionLabel"]
    # And a brand new comp still lands on the newest, so nothing about the fork route changed
    # what creating a comp means.
    assert make_comp(client, {"id": parent["teamId"]}, "Fresh")["rulesetVersionLabel"] == (
        "2026-08-01"
    )


def test_a_fork_is_a_full_copy_that_records_where_it_came_from(client, sign_in, publish):
    publish()
    sign_in(OWNER)
    parent = make_comp(client, make_team(client))
    client.put(f"/api/v1/comps/{parent['id']}/slots", json=slots(ABADDON, VINDICATOR, RIFTER))

    forked = fork(client, parent)

    assert forked["id"] != parent["id"]
    assert [slot["typeId"] for slot in forked["slots"]] == [ABADDON, VINDICATOR, RIFTER]
    assert forked["forkedFromCompId"] == parent["id"]
    assert forked["forkedFromName"] == parent["name"]
    assert forked["forkKind"] == "full"
    # The parent is untouched, which is what makes the fork independent — and it is nobody's
    # fork itself, so nothing wrote lineage backwards.
    after = client.get(f"/api/v1/comps/{parent['id']}").json()
    assert [slot["typeId"] for slot in after["slots"]] == [ABADDON, VINDICATOR, RIFTER]
    assert after["forkedFromCompId"] is None
    assert after["forkKind"] is None


def test_a_fork_of_chosen_rows_is_flagged_as_a_partial_derivation(client, sign_in, publish):
    """§4.1c's partial fork: the same mechanism, seeded from a subset."""
    publish()
    sign_in(OWNER)
    parent = make_comp(client, make_team(client))
    client.put(f"/api/v1/comps/{parent['id']}/slots", json=slots(ABADDON, VINDICATOR, RIFTER))

    forked = fork(client, parent, positions=[0, 2])

    assert [slot["typeId"] for slot in forked["slots"]] == [ABADDON, RIFTER]
    assert [slot["position"] for slot in forked["slots"]] == [0, 1]
    assert forked["forkKind"] == "partial"
    assert forked["forkedFromCompId"] == parent["id"]


def test_a_partial_fork_takes_the_rows_in_the_parents_order(client, sign_in, publish):
    """The caller's ordering of row numbers is not information; the comp's order is."""
    publish()
    sign_in(OWNER)
    parent = make_comp(client, make_team(client))
    client.put(f"/api/v1/comps/{parent['id']}/slots", json=slots(ABADDON, VINDICATOR, RIFTER))

    forked = fork(client, parent, positions=[2, 0])

    assert [slot["typeId"] for slot in forked["slots"]] == [ABADDON, RIFTER]


def test_a_full_fork_keeps_the_rows_its_parent_arranged(client, sign_in, publish):
    """A fork is taken to be compared against its parent, so it has to look like it."""
    publish()
    sign_in(OWNER)
    parent = make_comp(client, make_team(client))
    client.put(f"/api/v1/comps/{parent['id']}/slots", json=placed((0, ABADDON), (4, RIFTER)))

    forked = fork(client, parent)

    assert [slot["position"] for slot in forked["slots"]] == [0, 4]


def test_a_partial_fork_starts_at_row_zero(client, sign_in, publish):
    """These hulls in a comp of their own — not a copy of the comp they were lifted out of.

    The empty rows a partial fork would inherit are the shape of the rows somebody did *not*
    take, which is a fact about the parent and nothing about the new comp.
    """
    publish()
    sign_in(OWNER)
    parent = make_comp(client, make_team(client))
    client.put(
        f"/api/v1/comps/{parent['id']}/slots",
        json=placed((0, ABADDON), (4, RIFTER), (9, VINDICATOR)),
    )

    forked = fork(client, parent, positions=[4, 9])

    assert [slot["typeId"] for slot in forked["slots"]] == [RIFTER, VINDICATOR]
    assert [slot["position"] for slot in forked["slots"]] == [0, 1]


def test_a_fork_quietly_drops_a_row_number_the_comp_does_not_have(client, sign_in, publish):
    """A stale client, not an attack. Refusing the whole fork would lose the good rows too."""
    publish()
    sign_in(OWNER)
    parent = make_comp(client, make_team(client))
    client.put(f"/api/v1/comps/{parent['id']}/slots", json=slots(ABADDON, RIFTER))

    forked = fork(client, parent, positions=[0, 9])

    assert [slot["typeId"] for slot in forked["slots"]] == [ABADDON]


def test_a_fork_records_its_own_creator_rather_than_its_parents(
    client, sign_in, publish, resolver
):
    """§4.1a's one remaining clause: authorship is captured at creation, and a fork is created."""
    publish()
    resolver.knows("Sorren", EDITOR)
    sign_in(OWNER, "Vex")
    team = make_team(client)
    grant_to(client, team, "Sorren", "editor")
    parent = make_comp(client, team)

    sign_in(EDITOR, "Sorren")
    forked = fork(client, parent)

    assert parent["createdByName"] == "Vex"
    assert forked["createdByName"] == "Sorren"


def test_a_fork_carries_the_archetype_the_tags_and_the_flagship(client, sign_in, publish):
    """A fork starts as its parent — §4.1c — and every one of these is still valid in a copy.

    The flagship in particular: a comp holds at most one, so a whole comp brings at most one
    and so does any subset of it. §9.3's "flagship drops on copy" is about copying *into* an
    existing comp, where a second designation would collide.
    """
    publish()
    sign_in(OWNER)
    parent = make_comp(client, make_team(client))
    client.put(f"/api/v1/comps/{parent['id']}/slots", json=slots(ABADDON, VINDICATOR, flagship=1))
    client.put(
        f"/api/v1/comps/{parent['id']}/tags",
        json={"archetype": "Kite", "tags": ["Shield", "Angel"]},
    )

    forked = fork(client, parent)

    assert forked["archetype"] == "Kite"
    assert forked["tags"] == ["Angel", "Shield"]
    assert [slot["isFlagship"] for slot in forked["slots"]] == [False, True]


def test_a_fork_of_an_illegal_comp_lands(client, sign_in, publish):
    """Rules are reported, never enforced — a fork of an illegal comp is an illegal comp."""
    publish()
    sign_in(OWNER)
    parent = make_comp(client, make_team(client))
    client.put(f"/api/v1/comps/{parent['id']}/slots", json=slots(*([ABADDON] * 11)))

    forked = fork(client, parent)

    assert forked["shipCount"] == 11


def test_deleting_a_parent_leaves_the_fork_saying_where_it_came_from(client, sign_in, publish):
    """SET NULL, not RESTRICT: the link goes and the record stays.

    A parent nobody could delete because somebody forked it would make lineage a trap. A fork
    that forgot its origin the moment the original was tidied away would make it worthless.
    """
    publish()
    sign_in(OWNER)
    parent = make_comp(client, make_team(client), "Angel Shield Kite")
    forked = fork(client, parent)

    assert client.delete(f"/api/v1/comps/{parent['id']}").status_code == 204

    after = client.get(f"/api/v1/comps/{forked['id']}").json()
    assert after["forkedFromCompId"] is None
    assert after["forkedFromName"] == "Angel Shield Kite"
    assert after["forkKind"] == "full"


def test_a_team_holding_a_comp_and_its_fork_still_archives_and_restores(client, sign_in, publish):
    publish()
    sign_in(OWNER)
    team = make_team(client)
    parent = make_comp(client, team)
    fork(client, parent)

    client.post(f"/api/v1/teams/{team['id']}/archive")
    blocked = client.post(f"/api/v1/comps/{parent['id']}/fork", json={"name": "No"})
    client.post(f"/api/v1/teams/{team['id']}/restore")

    assert blocked.status_code == 409
    assert len(client.get(f"/api/v1/teams/{team['id']}/comps").json()) == 2


def test_a_viewer_may_not_fork_because_a_fork_is_a_new_comp_on_the_team(
    client, sign_in, publish, resolver
):
    publish()
    resolver.knows("Wren", VIEWER)
    sign_in(OWNER)
    team = make_team(client)
    grant_to(client, team, "Wren", "viewer")
    parent = make_comp(client, team)

    sign_in(VIEWER, "Wren")
    refused = client.post(f"/api/v1/comps/{parent['id']}/fork", json={"name": "Mine now"})

    assert refused.status_code == 404
    assert refused.json()["detail"].startswith("No comp ")


def test_a_comp_counts_the_forks_taken_from_it_and_the_comments_on_it(client, sign_in, publish):
    publish()
    sign_in(OWNER)
    comp = make_comp(client, make_team(client))
    fork(client, comp, "One")
    fork(client, comp, "Two")
    client.post(f"/api/v1/comps/{comp['id']}/comments", json={"body": "Needs more logi"})

    detail = client.get(f"/api/v1/comps/{comp['id']}").json()

    assert detail["forkCount"] == 2
    assert detail["commentCount"] == 1
    # And a fork of its own has neither yet.
    assert detail["forkKind"] is None
