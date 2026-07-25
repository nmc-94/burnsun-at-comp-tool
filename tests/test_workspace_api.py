"""The saved workspace: boards, the comps open in each, and the order they sit in.

Two invariants carry this file, and they are one invariant seen from both ends.

**A layout never hands back a comp id its holder could not have listed.** A document is ids
somebody wrote down earlier, and a comp can be deleted between one visit and the next, so a
stale tile has to disappear rather than surface an id.

**A layout is not an oracle.** Saving a document naming a comp in somebody else's team
answers exactly as saving one naming a random uuid — the id is dropped and the response says
nothing about which it was. A refusal of any shape would turn this route into the probe
``comps.py`` spends a whole helper preventing.

Everything else here is bookkeeping: it is per character, it round-trips, it is not a team
write, and it is bounded.
"""

from __future__ import annotations

import uuid

from conftest import RULESET_SLUG

OWNER = 90_000_101
EDITOR = 90_000_102
VIEWER = 90_000_103
STRANGER = 90_000_104


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


def board(name: str, *comp_ids: str, board_id: str | None = None) -> dict:
    return {
        "id": board_id or str(uuid.uuid4()),
        "name": name,
        "tiles": [{"compId": comp_id} for comp_id in comp_ids],
    }


def save(client, team: dict, *boards: dict, active: str | None = None):
    body: dict = {"boards": list(boards)}
    if active is not None:
        body["activeBoardId"] = active
    return client.put(f"/api/v1/teams/{team['id']}/workspace", json=body)


def load(client, team: dict):
    return client.get(f"/api/v1/teams/{team['id']}/workspace")


def comp_ids(payload: dict, index: int = 0) -> list[str]:
    return [tile["compId"] for tile in payload["boards"][index]["tiles"]]


def test_a_team_never_opened_has_an_empty_workspace_rather_than_a_missing_one(
    client, sign_in, publish
):
    """Absence is not an error, and a 404 here would be the team's answer, not this one."""
    publish()
    sign_in(OWNER)
    team = make_team(client)

    response = load(client, team)

    assert response.status_code == 200
    assert response.json() == {"boards": [], "activeBoardId": None, "updatedAt": None}


def test_boards_their_comps_and_their_order_survive_a_round_trip(client, sign_in, publish):
    """The definition of done: close the app, come back, find the workspace as it was."""
    publish()
    sign_in(OWNER)
    team = make_team(client)
    first = make_comp(client, team, name="Alpha")
    second = make_comp(client, team, name="Beta")
    third = make_comp(client, team, name="Gamma")
    drafts = board("Kite drafts", third["id"], first["id"], second["id"])

    saved = save(client, team, board("Angel doctrines"), drafts, active=drafts["id"])
    reloaded = load(client, team).json()

    assert saved.status_code == 200
    assert [b["name"] for b in reloaded["boards"]] == ["Angel doctrines", "Kite drafts"]
    assert comp_ids(reloaded, 1) == [third["id"], first["id"], second["id"]]
    assert reloaded["activeBoardId"] == drafts["id"]


def test_reordering_tiles_is_just_another_save(client, sign_in, publish):
    publish()
    sign_in(OWNER)
    team = make_team(client)
    first = make_comp(client, team, name="Alpha")
    second = make_comp(client, team, name="Beta")
    only = str(uuid.uuid4())

    save(client, team, board("Drafts", first["id"], second["id"], board_id=only))
    save(client, team, board("Drafts", second["id"], first["id"], board_id=only))

    assert comp_ids(load(client, team).json()) == [second["id"], first["id"]]


def test_a_workspace_is_one_characters_and_not_the_teams(client, sign_in, publish, resolver):
    publish()
    resolver.knows("Salvos", EDITOR)
    sign_in(OWNER)
    team = make_team(client)
    comp = make_comp(client, team)
    grant_to(client, team, "Salvos", "editor")
    save(client, team, board("Mine", comp["id"]))

    sign_in(EDITOR, "Salvos")
    theirs = load(client, team).json()
    save(client, team, board("Theirs", comp["id"]))

    sign_in(OWNER)
    assert theirs["boards"] == []
    assert [b["name"] for b in load(client, team).json()["boards"]] == ["Mine"]


def test_a_comp_deleted_since_the_layout_was_saved_stops_coming_back(client, sign_in, publish):
    """The read side of the leak: a layout must not outlive the comps it names."""
    publish()
    sign_in(OWNER)
    team = make_team(client)
    kept = make_comp(client, team, name="Alpha")
    doomed = make_comp(client, team, name="Beta")
    save(client, team, board("Drafts", kept["id"], doomed["id"]))

    client.delete(f"/api/v1/comps/{doomed['id']}")
    response = load(client, team)

    assert comp_ids(response.json()) == [kept["id"]]
    assert doomed["id"] not in response.text


def test_a_layout_never_returns_a_comp_id_belonging_to_another_team(client, sign_in, publish):
    publish()
    sign_in(OWNER)
    mine = make_team(client)
    other = make_team(client, name="Nova Collective")
    here = make_comp(client, mine, name="Alpha")
    elsewhere = make_comp(client, other, name="Somewhere else")

    saved = save(client, mine, board("Drafts", here["id"], elsewhere["id"]))

    assert comp_ids(saved.json()) == [here["id"]]
    assert comp_ids(load(client, mine).json()) == [here["id"]]
    assert elsewhere["id"] not in saved.text


def test_saving_a_comp_you_cannot_see_answers_exactly_as_saving_one_that_never_existed(
    client, sign_in, publish
):
    """The load-bearing one. A dropped id says nothing about which kind of id it was."""
    publish()
    sign_in(OWNER)
    team = make_team(client)
    hidden = make_comp(client, team)

    sign_in(STRANGER)
    theirs = make_team(client, name="Strangers")
    # One board id across both saves, so the only difference between the two requests is
    # which unreachable comp id they name.
    only = str(uuid.uuid4())
    real = save(client, theirs, board("Drafts", hidden["id"], board_id=only))
    invented = save(client, theirs, board("Drafts", str(uuid.uuid4()), board_id=only))

    assert real.status_code == invented.status_code == 200
    assert real.json()["boards"] == invented.json()["boards"]


def test_a_viewer_may_arrange_their_own_board(client, sign_in, publish, resolver):
    """Arranging your own screen is not editing the team's content."""
    publish()
    resolver.knows("Ruzan", VIEWER)
    sign_in(OWNER)
    team = make_team(client)
    comp = make_comp(client, team)
    grant_to(client, team, "Ruzan", "viewer")

    sign_in(VIEWER, "Ruzan")
    response = save(client, team, board("Reading", comp["id"]))

    assert response.status_code == 200
    assert comp_ids(response.json()) == [comp["id"]]


def test_an_archived_team_still_remembers_a_workspace(client, sign_in, publish):
    """The one write that is not a team write.

    Contrast ``test_an_archived_team_refuses_comp_edits_until_it_is_restored``: an archived
    team stays readable, and reading it means having tiles on a board.
    """
    publish()
    sign_in(OWNER)
    team = make_team(client)
    comp = make_comp(client, team)
    client.post(f"/api/v1/teams/{team['id']}/archive")

    saved = save(client, team, board("Drafts", comp["id"]))

    assert saved.status_code == 200
    assert load(client, team).status_code == 200


def test_a_workspace_on_a_team_you_cannot_see_answers_in_the_teams_own_words(
    client, sign_in, publish
):
    """A team-shaped 404, unlike a comp's.

    The team id is in the path here, so answering in the team's words says nothing that
    ``GET /api/v1/teams/{id}`` does not already say.
    """
    publish()
    sign_in(OWNER)
    team = make_team(client)

    sign_in(STRANGER)
    hidden = load(client, team)
    missing = client.get(f"/api/v1/teams/{uuid.uuid4()}/workspace")
    writing = save(client, team, board("Drafts"))

    assert hidden.status_code == missing.status_code == writing.status_code == 404
    assert hidden.json()["detail"].startswith("No team ")
    assert set(hidden.json()) == set(missing.json())


def test_saving_the_same_arrangement_twice_does_not_move_its_timestamp(client, sign_in, publish):
    publish()
    sign_in(OWNER)
    team = make_team(client)
    comp = make_comp(client, team)
    only = str(uuid.uuid4())

    first = save(client, team, board("Drafts", comp["id"], board_id=only)).json()
    again = save(client, team, board("Drafts", comp["id"], board_id=only)).json()
    changed = save(client, team, board("Drafts", board_id=only)).json()

    assert again["updatedAt"] == first["updatedAt"]
    assert changed["updatedAt"] != first["updatedAt"]


def test_a_board_name_is_stored_trimmed_and_may_not_be_blank(client, sign_in, publish):
    publish()
    sign_in(OWNER)
    team = make_team(client)

    blank = save(client, team, board("   "))
    padded = save(client, team, board("  Kite drafts  "))

    assert blank.status_code == 422
    assert padded.json()["boards"][0]["name"] == "Kite drafts"


def test_two_boards_may_not_share_an_id(client, sign_in, publish):
    """The grid keys its tiles on it, and so does the URL."""
    publish()
    sign_in(OWNER)
    team = make_team(client)
    shared = str(uuid.uuid4())

    response = save(client, team, board("One", board_id=shared), board("Two", board_id=shared))

    assert response.status_code == 422


def test_a_workspace_and_a_board_are_both_bounded(client, sign_in, publish):
    """Request-size ceilings, not statements about how anyone should work."""
    publish()
    sign_in(OWNER)
    team = make_team(client)
    comp = make_comp(client, team)

    too_many_boards = save(client, team, *[board(f"Board {n}") for n in range(21)])
    too_many_tiles = save(client, team, board("Drafts", *[comp["id"]] * 51))

    assert too_many_boards.status_code == too_many_tiles.status_code == 422


def test_one_comp_does_not_open_twice_on_the_same_board(client, sign_in, publish):
    """Two tiles editing one comp would autosave over each other."""
    publish()
    sign_in(OWNER)
    team = make_team(client)
    comp = make_comp(client, team)

    saved = save(client, team, board("Drafts", comp["id"], comp["id"]))

    assert comp_ids(saved.json()) == [comp["id"]]


def test_one_comp_may_be_open_on_two_boards_at_once(client, sign_in, publish):
    """A tile is a view, and looking at one comp from two boards is the point."""
    publish()
    sign_in(OWNER)
    team = make_team(client)
    comp = make_comp(client, team)

    saved = save(client, team, board("One", comp["id"]), board("Two", comp["id"]))

    assert comp_ids(saved.json(), 0) == comp_ids(saved.json(), 1) == [comp["id"]]


def test_a_board_whose_comps_were_all_deleted_is_still_a_board(client, sign_in, publish):
    """Removing it would be the server deciding what the user meant."""
    publish()
    sign_in(OWNER)
    team = make_team(client)
    comp = make_comp(client, team)
    save(client, team, board("Drafts", comp["id"]))

    client.delete(f"/api/v1/comps/{comp['id']}")
    reloaded = load(client, team).json()

    assert [b["name"] for b in reloaded["boards"]] == ["Drafts"]
    assert reloaded["boards"][0]["tiles"] == []


def test_an_active_board_that_is_no_longer_open_falls_back_to_the_first(client, sign_in, publish):
    """Resolved rather than echoed, so the client is never sent to a board it was not given."""
    publish()
    sign_in(OWNER)
    team = make_team(client)
    first = board("One")

    saved = save(client, team, first, board("Two"), active=str(uuid.uuid4()))

    assert saved.json()["activeBoardId"] == first["id"]


def test_clearing_the_workspace_is_a_save_with_no_boards(client, sign_in, publish):
    """Which is why there is no DELETE."""
    publish()
    sign_in(OWNER)
    team = make_team(client)
    comp = make_comp(client, team)
    save(client, team, board("Drafts", comp["id"]))

    cleared = save(client, team)

    assert cleared.json()["boards"] == []
    assert load(client, team).json()["boards"] == []


def test_every_workspace_route_needs_a_session(client, publish):
    publish()
    team_id = uuid.uuid4()

    answers = [
        client.get(f"/api/v1/teams/{team_id}/workspace"),
        client.put(f"/api/v1/teams/{team_id}/workspace", json={"boards": []}),
    ]

    assert [answer.status_code for answer in answers] == [401, 401]


def test_a_malformed_team_id_is_a_format_error_not_an_answer(client, sign_in, publish):
    publish()
    sign_in(OWNER)

    response = client.get("/api/v1/teams/not-a-uuid/workspace")

    assert response.status_code == 422
