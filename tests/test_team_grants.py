"""Granting access by character name.

The behaviour worth protecting is what happens when the name does *not* resolve: nothing
is written, and the owner is told which of the three things went wrong. This file used to
assert the opposite — that a miss was stored as a visibly pending invitation — on the
argument that a team should be assemblable while a third-party service was down. What that
actually produced was a row granting nobody anything, badged in a way its reader took to
mean "on the way". So the tests below check both halves of every refusal: the status, and
that the access list is still empty afterwards.
"""

from __future__ import annotations

import uuid

OWNER = 90_000_001
STRANGER = 90_000_002
GUEST = 90_000_003


def make_team(client, name: str = "Aurora Vanguard") -> dict:
    return client.post("/api/v1/teams", json={"name": name}).json()


def add_grant(client, team: dict, name: str, level: str = "viewer"):
    return client.post(
        f"/api/v1/teams/{team['id']}/grants", json={"characterName": name, "level": level}
    )


def grants_of(client, team: dict) -> list[dict]:
    return client.get(f"/api/v1/teams/{team['id']}/grants").json()


def test_a_grant_by_name_stores_the_resolved_id_and_the_name(client, sign_in, resolver):
    resolver.knows("Kadir", GUEST)
    sign_in(OWNER)
    team = make_team(client)

    grant = add_grant(client, team, "Kadir", "editor").json()

    assert grant["subjectKind"] == "character"
    assert grant["subjectId"] == GUEST
    assert grant["subjectName"] == "Kadir"
    assert grant["level"] == "editor"


def test_the_games_spelling_wins_over_what_was_typed(client, sign_in, resolver):
    resolver.knows("kadir", GUEST, spelled="Kadir")
    sign_in(OWNER)

    grant = add_grant(client, make_team(client), "kadir").json()

    assert grant["subjectName"] == "Kadir"


def test_a_resolved_grant_lets_the_named_character_read_the_team(client, sign_in, resolver):
    resolver.knows("Kadir", GUEST)
    sign_in(OWNER)
    team = make_team(client)
    add_grant(client, team, "Kadir")

    sign_in(GUEST)

    assert client.get(f"/api/v1/teams/{team['id']}").status_code == 200


def test_a_name_the_game_does_not_know_is_refused_and_stores_nothing(client, sign_in, resolver):
    sign_in(OWNER)
    team = make_team(client)

    response = add_grant(client, team, "Kadrri")

    assert response.status_code == 400
    # The name is quoted back, because the operator's next move is to look at their typing.
    assert "Kadrri" in response.json()["detail"]
    assert grants_of(client, team) == []


def test_a_lookup_that_is_down_is_a_503_and_stores_nothing(client, sign_in, resolver):
    # 503 rather than 400: the request was fine, the world was not, and the two ask the
    # operator for different things.
    resolver.is_unreachable("Kadir")
    sign_in(OWNER)
    team = make_team(client)

    response = add_grant(client, team, "Kadir")

    assert response.status_code == 503
    assert "again" in response.json()["detail"]
    assert grants_of(client, team) == []


def test_retrying_after_an_outage_is_simply_adding_again(client, sign_in, resolver):
    # What replaces the retry endpoint. The name never left the operator's box, so a
    # recovered service costs one more press of Add.
    resolver.is_unreachable("Kadir")
    sign_in(OWNER)
    team = make_team(client)
    assert add_grant(client, team, "Kadir").status_code == 503

    resolver.knows("Kadir", GUEST)

    assert add_grant(client, team, "Kadir").status_code == 201
    sign_in(GUEST)
    assert client.get(f"/api/v1/teams/{team['id']}").status_code == 200


def test_an_ambiguous_name_is_refused_rather_than_guessed(client, sign_in, resolver):
    resolver.finds_several("Kadir")
    sign_in(OWNER)
    team = make_team(client)

    response = add_grant(client, team, "Kadir")

    assert response.status_code == 400
    assert "More than one" in response.json()["detail"]
    assert grants_of(client, team) == []


def test_a_refusal_is_a_sentence_rather_than_a_field_list(client, sign_in, resolver):
    # The SPA renders a string ``detail`` as the message and anything else as the bare
    # status line, so the shape here is the difference between a readable failure and
    # "400 Bad Request" on screen.
    sign_in(OWNER)

    detail = add_grant(client, make_team(client), "Kadrri").json()["detail"]

    assert isinstance(detail, str)


def test_granting_the_same_character_twice_is_refused(client, sign_in, resolver):
    resolver.knows("Kadir", GUEST)
    resolver.knows("Kadir Renamed", GUEST)
    sign_in(OWNER)
    team = make_team(client)
    add_grant(client, team, "Kadir")

    # Same character, different name: caught on the id, which is the thing that matters.
    assert add_grant(client, team, "Kadir Renamed").status_code == 409


def test_the_same_character_typed_in_another_case_is_refused(client, sign_in, resolver):
    # Nothing here compares names. Both spellings resolve to one id, and the id is what
    # the duplicate check reads — which is why case-insensitivity needs no rule of its own.
    resolver.knows("Kadir", GUEST)
    resolver.knows("kadir", GUEST, spelled="Kadir")
    sign_in(OWNER)
    team = make_team(client)
    add_grant(client, team, "Kadir")

    again = add_grant(client, team, "kadir")

    assert again.status_code == 409
    assert "already has access" in again.json()["detail"]


def test_the_owner_cannot_be_granted_access_to_their_own_team(client, sign_in, resolver):
    # It would resolve to a grant the ladder ignores, leaving a row that appears to set a
    # role and does nothing.
    resolver.knows("Kadir", OWNER)
    sign_in(OWNER)

    response = add_grant(client, make_team(client), "Kadir", "viewer")

    assert response.status_code == 409
    assert "already owns this team" in response.json()["detail"]


def test_the_same_character_can_be_granted_by_two_different_teams(client, sign_in, resolver):
    resolver.knows("Kadir", GUEST)
    sign_in(OWNER)
    first = make_team(client, "Aurora Vanguard")
    second = make_team(client, "Nightfall Syndicate")

    assert add_grant(client, first, "Kadir").status_code == 201
    assert add_grant(client, second, "Kadir").status_code == 201


def test_a_viewer_can_see_who_is_on_the_team(client, sign_in, resolver):
    resolver.knows("Kadir", GUEST)
    sign_in(OWNER)
    team = make_team(client)
    add_grant(client, team, "Kadir")

    sign_in(GUEST)

    assert [grant["subjectName"] for grant in grants_of(client, team)] == ["Kadir"]


def test_every_listed_grant_carries_an_id(client, sign_in, resolver):
    # The shape the SPA now relies on: no row anywhere is waiting to become real, so the
    # client has no null branch and no placeholder portrait.
    resolver.knows("Kadir", GUEST)
    resolver.knows("Renn", 90_000_004)
    sign_in(OWNER)
    team = make_team(client)
    add_grant(client, team, "Kadir")
    add_grant(client, team, "Renn")

    assert [grant["subjectId"] for grant in grants_of(client, team)] == [GUEST, 90_000_004]


def test_an_editor_cannot_change_the_access_list(client, sign_in, resolver):
    resolver.knows("Kadir", GUEST)
    sign_in(OWNER)
    team = make_team(client)
    grant = add_grant(client, team, "Kadir", "editor").json()

    sign_in(GUEST)

    # 404 rather than a refusal about the name: permission is answered before the lookup,
    # so a stranger cannot use this route to ask whether a character exists.
    assert add_grant(client, team, "Somebody Else").status_code == 404
    assert client.delete(f"/api/v1/teams/{team['id']}/grants/{grant['id']}").status_code == 404


def test_the_access_list_of_a_team_i_cannot_see_is_a_404(client, sign_in):
    sign_in(OWNER)
    team = make_team(client)

    sign_in(STRANGER)

    assert client.get(f"/api/v1/teams/{team['id']}/grants").status_code == 404


def test_changing_a_grants_level_takes_effect(client, sign_in, resolver):
    resolver.knows("Kadir", GUEST)
    sign_in(OWNER)
    team = make_team(client)
    grant = add_grant(client, team, "Kadir", "viewer").json()

    changed = client.patch(
        f"/api/v1/teams/{team['id']}/grants/{grant['id']}", json={"level": "editor"}
    )

    assert changed.json()["level"] == "editor"
    sign_in(GUEST)
    assert client.get(f"/api/v1/teams/{team['id']}").json()["yourLevel"] == "editor"


def test_removing_a_grant_removes_the_access(client, sign_in, resolver):
    resolver.knows("Kadir", GUEST)
    sign_in(OWNER)
    team = make_team(client)
    grant = add_grant(client, team, "Kadir").json()

    assert client.delete(f"/api/v1/teams/{team['id']}/grants/{grant['id']}").status_code == 204

    sign_in(GUEST)
    assert client.get(f"/api/v1/teams/{team['id']}").status_code == 404


def test_a_grant_belonging_to_another_team_is_not_reachable(client, sign_in, resolver):
    resolver.knows("Kadir", GUEST)
    sign_in(OWNER)
    mine = make_team(client, "Aurora Vanguard")
    other = make_team(client, "Nightfall Syndicate")
    grant = add_grant(client, other, "Kadir").json()

    stolen = client.delete(f"/api/v1/teams/{mine['id']}/grants/{grant['id']}")

    assert stolen.status_code == 404
    assert len(grants_of(client, other)) == 1


def test_an_unknown_grant_is_a_404(client, sign_in):
    sign_in(OWNER)
    team = make_team(client)

    assert client.delete(f"/api/v1/teams/{team['id']}/grants/{uuid.uuid4()}").status_code == 404


def test_there_is_no_way_to_re_resolve_a_grant(client, sign_in, resolver):
    """The retry endpoint is gone, and its absence is the point.

    It existed to fill in a pending row's id later, and a route that repoints an existing
    grant at whoever holds a name *now* is a liability once nothing needs it. Asserted
    rather than assumed, because deleting a route is exactly the kind of change a merge
    can quietly bring back.
    """
    resolver.knows("Kadir", GUEST)
    sign_in(OWNER)
    team = make_team(client)
    grant = add_grant(client, team, "Kadir").json()

    retried = client.post(f"/api/v1/teams/{team['id']}/grants/{grant['id']}/resolve")

    # 405, not 404: the SPA catch-all matches the path and answers about the method, which
    # is the same thing every unregistered /api path does here.
    assert retried.status_code in (404, 405)


def test_owner_is_not_a_grantable_role(client, sign_in, resolver):
    # A second owner has powers nobody has specified, so the wire vocabulary omits it.
    resolver.knows("Kadir", GUEST)
    sign_in(OWNER)
    team = make_team(client)

    assert add_grant(client, team, "Kadir", "owner").status_code == 422


def test_an_archived_team_refuses_new_grants_until_it_is_restored(client, sign_in, resolver):
    resolver.knows("Kadir", GUEST)
    sign_in(OWNER)
    team = make_team(client)
    client.post(f"/api/v1/teams/{team['id']}/archive")

    assert add_grant(client, team, "Kadir").status_code == 409

    client.post(f"/api/v1/teams/{team['id']}/restore")
    assert add_grant(client, team, "Kadir").status_code == 201
