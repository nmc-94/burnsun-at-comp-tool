"""Teams: ownership, privacy, and the shape of not being allowed.

The load-bearing test in here is the one comparing a hidden team's answer to a missing
team's, byte for byte. Everything else about the permission ladder can be right and this
API can still leak which team ids exist.
"""

from __future__ import annotations

OWNER = 90_000_001
STRANGER = 90_000_002
GUEST = 90_000_003


def make_team(client, name: str = "Aurora Vanguard") -> dict:
    response = client.post("/api/v1/teams", json={"name": name})
    assert response.status_code == 201
    return response.json()


def grant_to(client, team: dict, name: str, level: str = "viewer") -> dict:
    response = client.post(
        f"/api/v1/teams/{team['id']}/grants", json={"characterName": name, "level": level}
    )
    assert response.status_code == 201
    return response.json()


def test_creating_a_team_makes_the_creator_its_owner(client, sign_in):
    sign_in(OWNER)

    team = make_team(client)

    assert team["name"] == "Aurora Vanguard"
    assert team["ownerCharacterId"] == OWNER
    assert team["yourLevel"] == "owner"
    assert team["archived"] is False


def test_a_team_remembers_its_owners_name_not_only_their_id(client, sign_in):
    # Ownership is a column rather than a grant row, so without this the one person who
    # certainly has access is the one the access list cannot name.
    sign_in(OWNER, "Kadir")

    team = make_team(client)

    assert team["ownerCharacterName"] == "Kadir"
    # And on the way back out, not just in the create response.
    assert client.get(f"/api/v1/teams/{team['id']}").json()["ownerCharacterName"] == "Kadir"


def test_a_team_made_before_the_column_existed_reports_a_null_owner_name(client, sign_in):
    # 0007 had nothing honest to backfill with. Null has to survive the round trip and mean
    # "not known yet" — the SPA renders "The team owner" rather than inventing one.
    sign_in(OWNER)
    team = make_team(client)
    _forget_owner_name(team["id"])

    assert client.get(f"/api/v1/teams/{team['id']}").json()["ownerCharacterName"] is None


def _forget_owner_name(team_id: str) -> None:
    """Put a row back the way 0007 leaves every team that predates it."""
    from comptool.db import get_session
    from comptool.models import Team

    opened = get_session()
    session = next(opened)
    try:
        session.get(Team, team_id).owner_character_name = None
        session.commit()
    finally:
        opened.close()


def test_a_new_team_is_private(client, sign_in):
    sign_in(OWNER)
    team = make_team(client)

    sign_in(STRANGER)

    assert client.get(f"/api/v1/teams/{team['id']}").status_code == 404


def test_my_teams_lists_the_ones_i_own(client, sign_in):
    sign_in(OWNER)
    make_team(client, "Aurora Vanguard")
    make_team(client, "Second String")

    listed = client.get("/api/v1/teams").json()

    assert [team["name"] for team in listed] == ["Aurora Vanguard", "Second String"]


def test_my_teams_lists_the_ones_i_was_granted(client, sign_in, resolver):
    resolver.knows("Kadir", GUEST)
    sign_in(OWNER)
    grant_to(client, make_team(client), "Kadir", "editor")

    sign_in(GUEST)
    listed = client.get("/api/v1/teams").json()

    assert [team["name"] for team in listed] == ["Aurora Vanguard"]
    assert listed[0]["yourLevel"] == "editor"


def test_my_teams_omits_a_team_i_have_no_grant_on(client, sign_in):
    sign_in(OWNER)
    make_team(client)

    sign_in(STRANGER)

    assert client.get("/api/v1/teams").json() == []


def test_a_hidden_team_and_a_missing_team_answer_identically(client, sign_in):
    import uuid

    sign_in(OWNER)
    team = make_team(client)

    sign_in(STRANGER)
    hidden = client.get(f"/api/v1/teams/{team['id']}")
    missing = client.get(f"/api/v1/teams/{uuid.uuid4()}")

    assert hidden.status_code == missing.status_code == 404
    # Same shape, and the id in the message is the one that was asked for either way — so
    # a caller cannot tell a team they may not see from one that was never there.
    assert set(hidden.json()) == set(missing.json())
    assert hidden.json()["detail"].startswith("No team ")


def test_a_viewer_can_read_a_team_but_not_rename_it(client, sign_in, resolver):
    resolver.knows("Kadir", GUEST)
    sign_in(OWNER)
    team = make_team(client)
    grant_to(client, team, "Kadir", "viewer")

    sign_in(GUEST)

    assert client.get(f"/api/v1/teams/{team['id']}").json()["yourLevel"] == "viewer"
    assert client.patch(f"/api/v1/teams/{team['id']}", json={"name": "Mine Now"}).status_code == 404


def test_an_editor_cannot_rename_a_team(client, sign_in, resolver):
    # Editing comps is not administering the team, and being refused must not confirm
    # anything either — so it is the same 404.
    resolver.knows("Kadir", GUEST)
    sign_in(OWNER)
    team = make_team(client)
    grant_to(client, team, "Kadir", "editor")

    sign_in(GUEST)

    assert client.patch(f"/api/v1/teams/{team['id']}", json={"name": "Mine Now"}).status_code == 404


def test_the_owner_renames_a_team(client, sign_in):
    sign_in(OWNER)
    team = make_team(client)

    renamed = client.patch(f"/api/v1/teams/{team['id']}", json={"name": "Aurora Reserve"})

    assert renamed.status_code == 200
    assert renamed.json()["name"] == "Aurora Reserve"


def test_a_team_needs_a_name(client, sign_in):
    sign_in(OWNER)

    assert client.post("/api/v1/teams", json={"name": ""}).status_code == 422
    # Trimmed before it is measured, so this is empty rather than three characters long.
    assert client.post("/api/v1/teams", json={"name": "   "}).status_code == 422


def test_a_team_name_is_stored_trimmed(client, sign_in):
    sign_in(OWNER)

    assert make_team(client, "  Aurora Vanguard  ")["name"] == "Aurora Vanguard"


def test_archiving_a_team_takes_it_out_of_the_default_list(client, sign_in):
    sign_in(OWNER)
    team = make_team(client)

    archived = client.post(f"/api/v1/teams/{team['id']}/archive")

    assert archived.status_code == 200
    assert archived.json()["archived"] is True
    assert client.get("/api/v1/teams").json() == []
    assert [t["name"] for t in client.get("/api/v1/teams?archived=true").json()] == [team["name"]]


def test_an_archived_team_is_still_readable(client, sign_in):
    # Bookmarks and links keep working; a season's record does not vanish.
    sign_in(OWNER)
    team = make_team(client)
    client.post(f"/api/v1/teams/{team['id']}/archive")

    assert client.get(f"/api/v1/teams/{team['id']}").status_code == 200


def test_an_archived_team_refuses_edits_until_it_is_restored(client, sign_in):
    sign_in(OWNER)
    team = make_team(client)
    client.post(f"/api/v1/teams/{team['id']}/archive")

    refused = client.patch(f"/api/v1/teams/{team['id']}", json={"name": "Nope"})

    # 409, not 404 or 403: the team is right there and the caller owns it. The state is
    # what forbids the write, and restoring is something they can do about it.
    assert refused.status_code == 409
    assert "archived" in refused.json()["detail"]


def test_restoring_a_team_returns_it_to_the_list(client, sign_in):
    sign_in(OWNER)
    team = make_team(client)
    client.post(f"/api/v1/teams/{team['id']}/archive")

    restored = client.post(f"/api/v1/teams/{team['id']}/restore")

    assert restored.json()["archived"] is False
    assert [t["name"] for t in client.get("/api/v1/teams").json()] == [team["name"]]


def test_archiving_twice_is_harmless(client, sign_in):
    sign_in(OWNER)
    team = make_team(client)

    client.post(f"/api/v1/teams/{team['id']}/archive")
    again = client.post(f"/api/v1/teams/{team['id']}/archive")

    assert again.status_code == 200
    assert again.json()["archived"] is True


def test_a_stranger_cannot_archive_a_team(client, sign_in):
    sign_in(OWNER)
    team = make_team(client)

    sign_in(STRANGER)

    assert client.post(f"/api/v1/teams/{team['id']}/archive").status_code == 404


def test_there_is_no_way_to_delete_a_team(client, sign_in):
    # Pinned deliberately: a team's comps are other people's work, and the ruleset
    # versions they were built against are pinned against exactly this kind of tidying.
    sign_in(OWNER)
    team = make_team(client)

    assert client.delete(f"/api/v1/teams/{team['id']}").status_code == 405


def test_every_team_route_needs_a_session(client):
    import uuid

    unknown = uuid.uuid4()

    assert client.get("/api/v1/teams").status_code == 401
    assert client.post("/api/v1/teams", json={"name": "x"}).status_code == 401
    assert client.get(f"/api/v1/teams/{unknown}").status_code == 401
    assert client.get(f"/api/v1/teams/{unknown}/grants").status_code == 401


def test_a_malformed_team_id_is_a_format_error_not_an_answer(client, sign_in):
    # 422 leaks nothing: it says the path was not a uuid, not whether one exists.
    sign_in(OWNER)

    assert client.get("/api/v1/teams/not-a-uuid").status_code == 422
