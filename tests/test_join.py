"""Getting into a team by link and password, and the controls its owner uses.

Three properties carry this feature, and each has a test that would fail loudly if it were
quietly given up:

- **A join writes an ordinary grant.** Which is why the access list, the resolver and every
  team route need no knowledge of joining at all.
- **Rotating the password evicts nobody.** The whole reason the credential moved off the
  environment: an owner can stop new joins without throwing out the people already in.
- **One refusal for four situations.** Unknown link, wrong password, closed team, archived
  team — same status, same sentence, so the route cannot be used to discover which links exist.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from comptool import join as join_module
from comptool.auth import local as local_auth
from comptool.models import Team, TeamGrant

CREATION_KEY = "a-creation-key-long-enough-here"
PASSWORD = "sun-reavers-2026"


@pytest.fixture()
def local_auth_on(configure):
    local_auth.reset_rate_limit()
    join_module.reset_rate_limit()
    yield configure(
        esi_enabled=False, local_auth_enabled=True, team_creation_key=CREATION_KEY
    )
    local_auth.reset_rate_limit()
    join_module.reset_rate_limit()


def claim_as(client, name: str):
    return client.post("/api/v1/auth/name", json={"displayName": name})


def make_team(client, name="Sun Reavers", password=PASSWORD, level="viewer"):
    return client.post(
        "/api/v1/teams",
        json={
            "name": name,
            "creationKey": CREATION_KEY,
            "password": password,
            "passwordLevel": level,
        },
    ).json()


def slug_of(client, team_id: str) -> str:
    return client.get(f"/api/v1/teams/{team_id}/join").json()["joinSlug"]


def grants_of(team_id) -> list[TeamGrant]:
    from comptool.db import get_session

    opened = get_session()
    session = next(opened)
    try:
        return list(session.scalars(select(TeamGrant).where(TeamGrant.team_id == team_id)))
    finally:
        opened.close()


def owner_with_team(client):
    """An owner, their team, and its link — the setup every test below starts from."""
    claim_as(client, "Sable Kaneko")
    team = make_team(client)
    return team, slug_of(client, team["id"])


# --- joining ---------------------------------------------------------------------------------


def test_a_link_names_its_team_before_anybody_proves_anything(client, local_auth_on):
    _team, slug = owner_with_team(client)
    client.cookies.clear()

    body = client.get(f"/api/v1/join/{slug}").json()

    # Enough to say what is being asked about, and deliberately nothing else. Under this
    # identity model a disclosed *person's* name is a disclosed identity, so this route must
    # never grow a member list.
    assert body == {"teamName": "Sun Reavers", "alreadyMember": False}


def test_joining_cold_claims_a_name_and_grants_access_in_one_request(client, local_auth_on):
    team, slug = owner_with_team(client)
    client.cookies.clear()

    joined = client.post(
        f"/api/v1/join/{slug}", json={"password": PASSWORD, "displayName": "Kadir"}
    )

    assert joined.status_code == 200
    assert joined.json()["teamName"] == "Sun Reavers"
    assert joined.json()["level"] == "viewer"
    # An invitee should never meet a sign-in screen and then a join screen. One link, one form.
    assert client.cookies.get("comptool_session")
    assert [t["id"] for t in client.get("/api/v1/teams").json()] == [team["id"]]


def test_joining_writes_an_ordinary_grant(client, local_auth_on):
    team, slug = owner_with_team(client)
    client.cookies.clear()
    client.post(f"/api/v1/join/{slug}", json={"password": PASSWORD, "displayName": "Kadir"})

    grants = grants_of(team["id"])

    # The property that makes this feature small: nothing downstream knows joining exists.
    assert len(grants) == 1
    assert grants[0].subject_name == "Kadir"
    assert grants[0].subject_id < 0


def test_the_owner_chooses_what_the_password_grants(client, local_auth_on):
    claim_as(client, "Sable Kaneko")
    team = make_team(client, level="editor")
    slug = slug_of(client, team["id"])
    client.cookies.clear()

    joined = client.post(
        f"/api/v1/join/{slug}", json={"password": PASSWORD, "displayName": "Kadir"}
    )

    assert joined.json()["level"] == "editor"


def test_joining_while_signed_in_needs_no_name(client, local_auth_on):
    team, slug = owner_with_team(client)
    client.cookies.clear()
    claim_as(client, "Kadir")

    joined = client.post(f"/api/v1/join/{slug}", json={"password": PASSWORD})

    assert joined.status_code == 200
    assert [t["id"] for t in client.get("/api/v1/teams").json()] == [team["id"]]


def test_joining_cold_without_a_name_says_so(client, local_auth_on):
    _team, slug = owner_with_team(client)
    client.cookies.clear()

    refused = client.post(f"/api/v1/join/{slug}", json={"password": PASSWORD})

    # A 422 rather than the blanket 401: the password was right, and refusing without saying
    # what is missing would leave somebody retyping a password that was never the problem.
    assert refused.status_code == 422
    assert "call you" in refused.json()["detail"]


def test_using_a_link_twice_is_not_an_error(client, local_auth_on):
    team, slug = owner_with_team(client)
    client.cookies.clear()
    client.post(f"/api/v1/join/{slug}", json={"password": PASSWORD, "displayName": "Kadir"})

    again = client.post(f"/api/v1/join/{slug}", json={"password": PASSWORD})

    # A bookmark is a thing people have. One membership, no second row, no complaint.
    assert again.status_code == 200
    assert len(grants_of(team["id"])) == 1


def test_a_rejoin_does_not_demote_somebody_who_was_promoted(client, local_auth_on):
    team, slug = owner_with_team(client)  # password grants viewer
    client.cookies.clear()
    client.post(f"/api/v1/join/{slug}", json={"password": PASSWORD, "displayName": "Kadir"})
    kadir = client.cookies.get("comptool_session")

    # The owner promotes them by hand.
    client.cookies.clear()
    claim_as(client, "Sable Kaneko")
    grant_id = client.get(f"/api/v1/teams/{team['id']}/grants").json()[0]["id"]
    client.patch(
        f"/api/v1/teams/{team['id']}/grants/{grant_id}", json={"level": "editor"}
    )

    # Then they follow the link again.
    client.cookies.clear()
    client.cookies.set("comptool_session", kadir)
    again = client.post(f"/api/v1/join/{slug}", json={"password": PASSWORD})

    # Re-applying the team's configured level would silently undo the promotion.
    assert again.json()["level"] == "editor"


def test_the_owner_following_their_own_link_gets_no_grant(client, local_auth_on):
    team, slug = owner_with_team(client)

    joined = client.post(f"/api/v1/join/{slug}", json={"password": PASSWORD})

    # Ownership is a column the resolver short-circuits on; a grant beside it would be a
    # weaker duplicate of something that cannot be revoked anyway.
    assert joined.json()["level"] == "owner"
    assert grants_of(team["id"]) == []


# --- refusals --------------------------------------------------------------------------------


def test_four_situations_give_one_answer(client, local_auth_on):
    team, slug = owner_with_team(client)
    client.cookies.clear()

    wrong = client.post(
        f"/api/v1/join/{slug}", json={"password": "not-it", "displayName": "Kadir"}
    )
    unknown = client.post(
        "/api/v1/join/brave-amber-tempest-harbour",
        json={"password": PASSWORD, "displayName": "Kadir"},
    )

    assert wrong.status_code == unknown.status_code == 401
    # Identical down to the sentence. Anything that told them apart would make this route a way
    # to find out which links are real without ever knowing a password.
    assert wrong.json() == unknown.json()

    # And the same for a team that has closed itself.
    claim_as(client, "Sable Kaneko")
    client.delete(f"/api/v1/teams/{team['id']}/join")
    client.cookies.clear()
    closed = client.post(
        f"/api/v1/join/{slug}", json={"password": PASSWORD, "displayName": "Kadir"}
    )
    assert closed.status_code == 401
    assert closed.json() == wrong.json()


def test_a_wrong_password_mints_nothing(client, local_auth_on):
    _team, slug = owner_with_team(client)
    client.cookies.clear()

    client.post(f"/api/v1/join/{slug}", json={"password": "not-it", "displayName": "Kadir"})

    # No session and no account. Otherwise a wrong password would still let anybody squat a
    # name, which is the one thing this mode cannot afford to hand out cheaply.
    assert client.cookies.get("comptool_session") is None
    assert client.get("/api/v1/auth/me").json()["character"] is None


def test_guessing_is_throttled_per_team(client, local_auth_on):
    _team, slug = owner_with_team(client)
    client.cookies.clear()

    for _ in range(join_module.PER_CALLER_LIMIT):
        client.post(f"/api/v1/join/{slug}", json={"password": "no", "displayName": "K"})

    blocked = client.post(
        f"/api/v1/join/{slug}", json={"password": PASSWORD, "displayName": "Kadir"}
    )

    assert blocked.status_code == 429
    assert int(blocked.headers["retry-after"]) > 0


def test_a_correct_password_clears_the_callers_failures(client, local_auth_on):
    _team, slug = owner_with_team(client)
    client.cookies.clear()
    for _ in range(join_module.PER_CALLER_LIMIT - 1):
        client.post(f"/api/v1/join/{slug}", json={"password": "no", "displayName": "K"})

    assert (
        client.post(
            f"/api/v1/join/{slug}", json={"password": PASSWORD, "displayName": "Kadir"}
        ).status_code
        == 200
    )
    # Fumbling forgiven, so a second person behind the same address is not locked out by the
    # first one's bad memory.
    assert (
        client.post(f"/api/v1/join/{slug}", json={"password": PASSWORD}).status_code == 200
    )


# --- the owner's controls --------------------------------------------------------------------


def test_rotating_the_password_evicts_nobody(client, local_auth_on):
    """The improvement over the environment variable, and the reason it moved."""
    team, slug = owner_with_team(client)
    client.cookies.clear()
    client.post(f"/api/v1/join/{slug}", json={"password": PASSWORD, "displayName": "Kadir"})
    kadir = client.cookies.get("comptool_session")

    client.cookies.clear()
    claim_as(client, "Sable Kaneko")
    changed = client.put(
        f"/api/v1/teams/{team['id']}/join", json={"password": "a-brand-new-one", "level": "viewer"}
    )
    assert changed.status_code == 200

    # Still in, still signed in, still sees the team. Rotating stops *new* joins; removing one
    # person is deleting their grant.
    client.cookies.clear()
    client.cookies.set("comptool_session", kadir)
    assert [t["id"] for t in client.get("/api/v1/teams").json()] == [team["id"]]

    # And the old password no longer opens the door.
    client.cookies.clear()
    stale = client.post(
        f"/api/v1/join/{slug}", json={"password": PASSWORD, "displayName": "Mirren"}
    )
    assert stale.status_code == 401


def test_re_rolling_the_link_kills_the_old_one(client, local_auth_on):
    team, slug = owner_with_team(client)

    fresh = client.post(f"/api/v1/teams/{team['id']}/join/link").json()["joinSlug"]

    assert fresh != slug
    client.cookies.clear()
    assert client.get(f"/api/v1/join/{slug}").status_code == 404
    assert client.get(f"/api/v1/join/{fresh}").status_code == 200


def test_a_short_password_is_refused_with_a_number(client, local_auth_on):
    team, _slug = owner_with_team(client)

    refused = client.put(
        f"/api/v1/teams/{team['id']}/join", json={"password": "short", "level": "viewer"}
    )

    assert refused.status_code == 422
    assert str(join_module.TEAM_PASSWORD_MIN_LENGTH) in refused.json()["detail"]


def test_only_the_owner_may_touch_any_of_it(client, local_auth_on):
    team, slug = owner_with_team(client)
    client.cookies.clear()
    client.post(f"/api/v1/join/{slug}", json={"password": PASSWORD, "displayName": "Kadir"})

    # A member, not the owner. 404 rather than 403, the same answer authorize gives for a team
    # you may not reach at this level — the settings of a team are not a thing to confirm the
    # existence of.
    assert client.get(f"/api/v1/teams/{team['id']}/join").status_code == 404
    assert (
        client.put(
            f"/api/v1/teams/{team['id']}/join",
            json={"password": "another-one-here", "level": "viewer"},
        ).status_code
        == 404
    )
    assert client.post(f"/api/v1/teams/{team['id']}/join/link").status_code == 404


def test_an_archived_team_cannot_be_joined(client, local_auth_on):
    team, slug = owner_with_team(client)
    client.post(f"/api/v1/teams/{team['id']}/archive")
    client.cookies.clear()

    assert client.get(f"/api/v1/join/{slug}").status_code == 404
    assert (
        client.post(
            f"/api/v1/join/{slug}", json={"password": PASSWORD, "displayName": "Kadir"}
        ).status_code
        == 401
    )


def test_the_whole_feature_is_absent_under_eve_sso(client, local_auth_on, configure):
    """The guard that stops the two identity kinds meeting through a side door.

    Every team carries a ``join_slug`` in both modes, because the column is NOT NULL. Without a
    mode check the routes would therefore answer on an EVE-SSO deployment, and a join by
    somebody with no session would mint a *negative* principal into a database whose every other
    identity is a positive EVE character — exactly the mixing the settings validator refuses to
    boot with, arriving sideways.
    """
    team, slug = owner_with_team(client)
    configure(esi_enabled=True, local_auth_enabled=False)

    # The owner's side first, while still holding the session that made the team — otherwise
    # `current_viewer` answers 401 before the mode guard is ever consulted, and the test would
    # pass for the wrong reason.
    assert client.get(f"/api/v1/teams/{team['id']}/join").status_code == 404

    client.cookies.clear()
    assert client.get(f"/api/v1/join/{slug}").status_code == 404
    assert (
        client.post(
            f"/api/v1/join/{slug}", json={"password": PASSWORD, "displayName": "Kadir"}
        ).status_code
        == 404
    )


def test_every_team_gets_a_link_even_without_local_accounts(client, sign_in, publish):
    """Under EVE SSO the column is still NOT NULL, and the feature is simply inert.

    One schema, one code path for creating a team, and a mode that does not use the link never
    has to know it exists — which is cheaper than making the column nullable and every read of
    it defensive.
    """
    sign_in(90_000_001, "Kadir")

    created = client.post("/api/v1/teams", json={"name": "Hydra Reloaded"})

    assert created.status_code == 201
    from comptool.db import get_session

    opened = get_session()
    session = next(opened)
    try:
        team = session.scalar(select(Team).where(Team.name == "Hydra Reloaded"))
        assert team is not None and team.join_slug
        # Inert, because nothing set a password: the link names a team nobody can join.
        assert team.access_password_hash is None
    finally:
        opened.close()
