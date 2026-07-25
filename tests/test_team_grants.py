"""Granting access by character name.

The behaviour worth protecting is what happens when the name does *not* resolve. A grant
is still created, it is visibly pending, and it grants nothing — so an owner sees their
typo instead of wondering why someone cannot get in, and an outage in a service this app
does not run cannot stop a team being put together.
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


def test_a_grant_by_name_stores_the_resolved_id_and_the_name(client, sign_in, resolver):
    resolver.knows("Kadir", GUEST)
    sign_in(OWNER)
    team = make_team(client)

    grant = add_grant(client, team, "Kadir", "editor").json()

    assert grant["subjectKind"] == "character"
    assert grant["subjectId"] == GUEST
    assert grant["subjectName"] == "Kadir"
    assert grant["level"] == "editor"
    assert grant["pending"] is False
    assert grant["resolution"] == "resolved"


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


def test_a_name_that_does_not_resolve_is_stored_as_a_pending_invitation(client, sign_in, resolver):
    sign_in(OWNER)

    response = add_grant(client, make_team(client), "Kadrri")

    # Created, not rejected: the owner needs to see their typo written down.
    assert response.status_code == 201
    grant = response.json()
    assert grant["subjectId"] is None
    assert grant["subjectName"] == "Kadrri"
    assert grant["pending"] is True
    assert grant["resolution"] == "not_found"


def test_a_pending_grant_gives_nobody_access(client, sign_in, resolver):
    sign_in(OWNER)
    team = make_team(client)
    add_grant(client, team, "Kadir")

    sign_in(GUEST)

    assert client.get(f"/api/v1/teams/{team['id']}").status_code == 404


def test_a_grant_entered_while_the_lookup_is_down_is_still_created(client, sign_in, resolver):
    # Putting a team together must not depend on a third party being reachable.
    resolver.is_unreachable("Kadir")
    sign_in(OWNER)

    response = add_grant(client, make_team(client), "Kadir")

    assert response.status_code == 201
    assert response.json()["pending"] is True
    assert response.json()["resolution"] == "unavailable"


def test_an_ambiguous_name_is_pending_rather_than_a_guess(client, sign_in, resolver):
    resolver.finds_several("Kadir")
    sign_in(OWNER)

    grant = add_grant(client, make_team(client), "Kadir").json()

    assert grant["pending"] is True
    assert grant["resolution"] == "ambiguous"
    assert grant["subjectId"] is None


def test_a_listed_grant_reports_no_stale_reason(client, sign_in, resolver):
    # The reason belongs to the lookup that produced it, not to the row.
    sign_in(OWNER)
    team = make_team(client)
    add_grant(client, team, "Kadrri")

    listed = client.get(f"/api/v1/teams/{team['id']}/grants").json()

    assert listed[0]["pending"] is True
    assert listed[0]["resolution"] is None


def test_the_same_pending_name_cannot_be_invited_twice(client, sign_in, resolver):
    sign_in(OWNER)
    team = make_team(client)
    add_grant(client, team, "Kadrri")

    again = add_grant(client, team, "Kadrri")

    assert again.status_code == 409
    assert "already has access" in again.json()["detail"]


def test_the_same_pending_name_differing_only_in_case_is_refused(client, sign_in, resolver):
    sign_in(OWNER)
    team = make_team(client)
    add_grant(client, team, "Kadrri")

    assert add_grant(client, team, "kadrri").status_code == 409


def test_granting_the_same_character_twice_is_refused(client, sign_in, resolver):
    resolver.knows("Kadir", GUEST)
    resolver.knows("Kadir Renamed", GUEST)
    sign_in(OWNER)
    team = make_team(client)
    add_grant(client, team, "Kadir")

    # Same character, different name: caught on the id, which is the thing that matters.
    assert add_grant(client, team, "Kadir Renamed").status_code == 409


def test_the_owner_cannot_be_granted_access_to_their_own_team(client, sign_in, resolver):
    # It would resolve to a grant the ladder ignores, leaving a row that appears to set a
    # role and does nothing.
    resolver.knows("Kadir", OWNER)
    sign_in(OWNER)

    response = add_grant(client, make_team(client), "Kadir", "viewer")

    assert response.status_code == 409
    assert "already owns this team" in response.json()["detail"]


def test_the_same_name_can_be_invited_by_two_different_teams(client, sign_in, resolver):
    sign_in(OWNER)
    first = make_team(client, "Aurora Vanguard")
    second = make_team(client, "Nightfall Syndicate")

    assert add_grant(client, first, "Kadrri").status_code == 201
    assert add_grant(client, second, "Kadrri").status_code == 201


def test_re_resolving_a_pending_grant_fills_in_the_id(client, sign_in, resolver):
    sign_in(OWNER)
    team = make_team(client)
    grant = add_grant(client, team, "Kadir").json()
    resolver.knows("Kadir", GUEST)

    retried = client.post(f"/api/v1/teams/{team['id']}/grants/{grant['id']}/resolve").json()

    assert retried["pending"] is False
    assert retried["subjectId"] == GUEST

    sign_in(GUEST)
    assert client.get(f"/api/v1/teams/{team['id']}").status_code == 200


def test_re_resolving_a_name_that_still_does_not_resolve_reports_why(client, sign_in, resolver):
    sign_in(OWNER)
    team = make_team(client)
    grant = add_grant(client, team, "Kadrri").json()
    resolver.is_unreachable("Kadrri")

    retried = client.post(f"/api/v1/teams/{team['id']}/grants/{grant['id']}/resolve").json()

    assert retried["pending"] is True
    assert retried["resolution"] == "unavailable"


def test_re_resolving_an_already_resolved_grant_changes_nothing(client, sign_in, resolver):
    # Idempotent on purpose: a stray retry must not repoint an existing grant at whoever
    # happens to hold that name now.
    resolver.knows("Kadir", GUEST)
    sign_in(OWNER)
    team = make_team(client)
    grant = add_grant(client, team, "Kadir").json()
    resolver.knows("Kadir", 90_000_777)

    retried = client.post(f"/api/v1/teams/{team['id']}/grants/{grant['id']}/resolve").json()

    assert retried["subjectId"] == GUEST
    assert retried["resolution"] == "resolved"


def test_a_viewer_can_see_who_is_on_the_team(client, sign_in, resolver):
    resolver.knows("Kadir", GUEST)
    sign_in(OWNER)
    team = make_team(client)
    add_grant(client, team, "Kadir")

    sign_in(GUEST)
    listed = client.get(f"/api/v1/teams/{team['id']}/grants").json()

    assert [grant["subjectName"] for grant in listed] == ["Kadir"]


def test_an_editor_cannot_change_the_access_list(client, sign_in, resolver):
    resolver.knows("Kadir", GUEST)
    sign_in(OWNER)
    team = make_team(client)
    grant = add_grant(client, team, "Kadir", "editor").json()

    sign_in(GUEST)

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
    sign_in(OWNER)
    mine = make_team(client, "Aurora Vanguard")
    other = make_team(client, "Nightfall Syndicate")
    grant = add_grant(client, other, "Kadrri").json()

    stolen = client.delete(f"/api/v1/teams/{mine['id']}/grants/{grant['id']}")

    assert stolen.status_code == 404
    assert len(client.get(f"/api/v1/teams/{other['id']}/grants").json()) == 1


def test_an_unknown_grant_is_a_404(client, sign_in):
    sign_in(OWNER)
    team = make_team(client)

    assert client.delete(f"/api/v1/teams/{team['id']}/grants/{uuid.uuid4()}").status_code == 404


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
