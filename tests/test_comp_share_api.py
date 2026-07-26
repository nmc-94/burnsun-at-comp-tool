"""The share API — the one route in this application that answers without a session.

Three invariants carry this file, and they are the reasons the route exists outside the gate
rather than beside it.

**A link reveals exactly what it promises, and the assertion is a key *set*.** A list of
absences would pass happily for the field somebody adds tomorrow; an exact set fails the moment
the shape grows. This is the test that stops a team's tags, its comment count or its id being
published by accident.

**A miss is a miss.** Unknown, withdrawn, and malformed answer identically, down to the body.
Anything else is an oracle, and a slug is short enough that an oracle matters.

**Nothing about the caller changes the answer.** A signed-in reader and an anonymous one get
the same bytes, because a public route that varied with a session would be a second
authorization path in the one place that must not have one.
"""

from __future__ import annotations

import pytest

from comptool import share
from comptool.db import get_session
from comptool.models import CompShare
from conftest import RULESET_SLUG, VERSION_LABEL

OWNER = 91_000_001
EDITOR = 91_000_002
VIEWER = 91_000_003
STRANGER = 91_000_004

ABADDON = 24_692
RIFTER = 587

SHARED_FIELDS = {
    "name",
    "rulesetSlug",
    "rulesetVersionLabel",
    "shipCount",
    "capturedAt",
    "slots",
}


@pytest.fixture(autouse=True)
def _fresh_rate_limit():
    """Every test here shares one client host, so the window would otherwise leak between them."""
    share.reset_rate_limit()
    yield
    share.reset_rate_limit()


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


def slots(*type_ids: int) -> dict:
    return {"slots": [{"typeId": type_id, "isFlagship": False} for type_id in type_ids]}


def share_comp(client, comp: dict) -> dict:
    response = client.post(f"/api/v1/comps/{comp['id']}/share")
    assert response.status_code == 201
    return response.json()


def a_shared_comp(client, sign_in, publish) -> tuple[dict, str]:
    """A comp with hulls in it, shared. Returns the comp and its slug."""
    publish()
    sign_in(OWNER)
    comp = make_comp(client, make_team(client))
    client.put(f"/api/v1/comps/{comp['id']}/slots", json=slots(ABADDON, RIFTER))
    return comp, share_comp(client, comp)["slug"]


def test_minting_returns_a_human_readable_slug(client, sign_in, publish):
    publish()
    sign_in(OWNER)
    comp = make_comp(client, make_team(client))
    assert comp["shareSlug"] is None

    body = share_comp(client, comp)

    assert body["slug"].count("-") == 3
    assert body["slug"] == body["slug"].lower()
    assert client.get(f"/api/v1/comps/{comp['id']}").json()["shareSlug"] == body["slug"]


def test_asking_twice_returns_the_same_link(client, sign_in, publish):
    """A comp is shared or it is not. Asking again is a client that lost the first answer."""
    publish()
    sign_in(OWNER)
    comp = make_comp(client, make_team(client))
    first = share_comp(client, comp)

    again = client.post(f"/api/v1/comps/{comp['id']}/share")

    assert again.status_code == 200
    assert again.json()["slug"] == first["slug"]


def test_a_shared_comp_is_readable_with_no_session_at_all(client, sign_in, publish):
    # The inverse of the 401 sweep the authenticated modules carry, and modelled on
    # test_auth_routes.py's ruleset check. The ruleset routes are here too because a reader
    # needs them to price what they were shown, and a share that needed a login to make sense
    # of would not be a share.
    _, slug = a_shared_comp(client, sign_in, publish)
    client.cookies.clear()

    answers = [
        client.get(f"/api/v1/share/{slug}"),
        client.get("/api/v1/rulesets"),
        client.get(f"/api/v1/rulesets/{RULESET_SLUG}/versions/{VERSION_LABEL}"),
    ]

    assert [answer.status_code for answer in answers] == [200, 200, 200]


def test_the_share_reveals_only_what_it_promises(client, sign_in, publish):
    _, slug = a_shared_comp(client, sign_in, publish)
    client.cookies.clear()

    body = client.get(f"/api/v1/share/{slug}").json()

    assert set(body) == SHARED_FIELDS
    assert set(body["slots"][0]) == {"position", "typeId", "isFlagship"}
    assert body["name"] == "Angel Shield Kite"
    assert body["rulesetSlug"] == RULESET_SLUG
    assert body["rulesetVersionLabel"] == VERSION_LABEL
    assert body["shipCount"] == 2
    assert [slot["typeId"] for slot in body["slots"]] == [ABADDON, RIFTER]


def test_the_share_is_not_indexable(client, sign_in, publish):
    _, slug = a_shared_comp(client, sign_in, publish)
    client.cookies.clear()

    response = client.get(f"/api/v1/share/{slug}")

    assert "noindex" in response.headers["X-Robots-Tag"]


def test_a_session_changes_nothing_about_a_share(client, sign_in, publish):
    """The public route must not have a second personality for people who happen to be logged in."""
    _, slug = a_shared_comp(client, sign_in, publish)
    anonymous = client.get(f"/api/v1/share/{slug}")

    client.cookies.clear()
    sign_in(STRANGER)
    as_a_stranger = client.get(f"/api/v1/share/{slug}")

    assert anonymous.json() == as_a_stranger.json()


def test_holding_a_slug_is_not_holding_the_comp(client, sign_in, publish):
    comp, slug = a_shared_comp(client, sign_in, publish)
    client.cookies.clear()

    assert client.get(f"/api/v1/share/{slug}").status_code == 200
    # The share is a door onto one frozen comp, not onto the comp id behind it.
    assert client.get(f"/api/v1/comps/{comp['id']}").status_code == 401


def test_a_withdrawn_slug_is_indistinguishable_from_one_that_never_existed(
    client, sign_in, publish
):
    comp, slug = a_shared_comp(client, sign_in, publish)

    assert client.delete(f"/api/v1/comps/{comp['id']}/share").status_code == 204

    client.cookies.clear()
    withdrawn = client.get(f"/api/v1/share/{slug}")
    never = client.get("/api/v1/share/never-minted-this-slug")

    assert withdrawn.status_code == never.status_code == 404
    assert withdrawn.json() == never.json()
    # And the slug is not echoed back, so a near-miss cannot be confirmed from the answer.
    assert slug not in withdrawn.text


def test_a_malformed_slug_answers_like_any_other_miss(client, sign_in, publish):
    publish()
    client.cookies.clear()

    answers = [
        client.get(f"/api/v1/share/{'x' * 300}"),
        client.get("/api/v1/share/not%20a%20slug"),
        client.get("/api/v1/share/-"),
    ]

    # 404 and never 422: a validation error would confirm which shapes are worth guessing.
    assert [answer.status_code for answer in answers] == [404, 404, 404]


def test_a_slug_resolves_even_when_its_words_leave_the_lexicon(client, sign_in, publish):
    """§7's requirement, made executable.

    "Slug resolution stays decoupled from the lexicon, so the word list can change without
    migration." The way that breaks is somebody adding a helpful validity check to the reader,
    and the day a word is retired every link containing it stops working. This fails loudly
    if that ever happens.
    """
    comp, _ = a_shared_comp(client, sign_in, publish)
    opened = get_session()
    db = next(opened)
    try:
        record = db.query(CompShare).filter(CompShare.comp_id == comp["id"]).one()
        record.slug = "zzzz-yyyy-xxxx-wwww"
        db.commit()
    finally:
        opened.close()

    client.cookies.clear()
    assert client.get("/api/v1/share/zzzz-yyyy-xxxx-wwww").status_code == 200


def test_a_share_is_a_snapshot_and_does_not_follow_the_comp(client, sign_in, publish):
    comp, slug = a_shared_comp(client, sign_in, publish)

    client.put(f"/api/v1/comps/{comp['id']}/slots", json=slots(RIFTER))

    body = client.get(f"/api/v1/share/{slug}").json()
    assert body["shipCount"] == 2
    assert [slot["typeId"] for slot in body["slots"]] == [ABADDON, RIFTER]


def test_a_comp_that_has_moved_reports_its_link_as_stale(client, sign_in, publish):
    comp, _ = a_shared_comp(client, sign_in, publish)
    assert client.get(f"/api/v1/comps/{comp['id']}").json()["shareStale"] is False

    client.put(f"/api/v1/comps/{comp['id']}/slots", json=slots(RIFTER))

    assert client.get(f"/api/v1/comps/{comp['id']}").json()["shareStale"] is True


def test_updating_a_share_recaptures_it_under_the_same_slug(client, sign_in, publish):
    """A link already sent to a scrim partner must not stop working because a typo was fixed."""
    comp, slug = a_shared_comp(client, sign_in, publish)
    client.put(f"/api/v1/comps/{comp['id']}/slots", json=slots(RIFTER))

    updated = client.put(f"/api/v1/comps/{comp['id']}/share")

    assert updated.status_code == 200
    assert updated.json()["slug"] == slug
    body = client.get(f"/api/v1/share/{slug}").json()
    assert [slot["typeId"] for slot in body["slots"]] == [RIFTER]
    assert client.get(f"/api/v1/comps/{comp['id']}").json()["shareStale"] is False


def test_updating_or_revoking_an_unshared_comp_is_a_404(client, sign_in, publish):
    publish()
    sign_in(OWNER)
    comp = make_comp(client, make_team(client))

    assert client.put(f"/api/v1/comps/{comp['id']}/share").status_code == 404
    assert client.delete(f"/api/v1/comps/{comp['id']}/share").status_code == 404


def test_resharing_after_a_withdrawal_mints_a_different_slug(client, sign_in, publish):
    """The withdrawn row stays, so its slug can never be handed out again."""
    comp, first = a_shared_comp(client, sign_in, publish)
    client.delete(f"/api/v1/comps/{comp['id']}/share")

    second = share_comp(client, comp)["slug"]

    assert second != first
    client.cookies.clear()
    assert client.get(f"/api/v1/share/{first}").status_code == 404
    assert client.get(f"/api/v1/share/{second}").status_code == 200


def test_only_an_editor_may_mint_or_withdraw(client, sign_in, publish, resolver):
    # The ``resolver`` fixture is load-bearing and was missing. Without it the name did not
    # resolve, the grant was created pending, and it conferred nothing — so this test used
    # to assert that a character with *no* access gets a 404, twice, and called one of them
    # a viewer. Now the viewer is a viewer, which is the case that was meant to be covered.
    resolver.knows("Viewer", VIEWER)
    publish()
    sign_in(OWNER)
    team = make_team(client)
    comp = make_comp(client, team)
    grant_to(client, team, "Viewer", "viewer")

    sign_in(VIEWER, "Viewer")
    viewer_attempt = client.post(f"/api/v1/comps/{comp['id']}/share")
    sign_in(STRANGER, "Stranger")
    stranger_attempt = client.post(f"/api/v1/comps/{comp['id']}/share")

    # Both 404, not 403: a comp you may not write is not a comp whose existence is confirmed.
    assert [viewer_attempt.status_code, stranger_attempt.status_code] == [404, 404]


def test_an_archived_team_refuses_a_mint_but_keeps_serving_its_link(client, sign_in, publish):
    """Archiving puts a season away. It should not take the record of a match with it."""
    publish()
    sign_in(OWNER)
    team = make_team(client)
    comp = make_comp(client, team)
    slug = share_comp(client, comp)["slug"]
    assert client.post(f"/api/v1/teams/{team['id']}/archive").status_code == 200

    refused = client.post(f"/api/v1/comps/{comp['id']}/share")

    assert refused.status_code == 409
    client.cookies.clear()
    assert client.get(f"/api/v1/share/{slug}").status_code == 200


def test_deleting_the_comp_takes_its_share_with_it(client, sign_in, publish):
    comp, slug = a_shared_comp(client, sign_in, publish)

    assert client.delete(f"/api/v1/comps/{comp['id']}").status_code == 204

    client.cookies.clear()
    assert client.get(f"/api/v1/share/{slug}").status_code == 404


def test_the_public_read_is_rate_limited(client, sign_in, publish):
    """The slug is a four-word name, not a key. This is what makes that safe enough."""
    _, slug = a_shared_comp(client, sign_in, publish)
    client.cookies.clear()

    statuses = {client.get(f"/api/v1/share/{slug}").status_code for _ in range(share.RATE_LIMIT)}
    assert statuses == {200}

    over = client.get(f"/api/v1/share/{slug}")
    assert over.status_code == 429
    assert over.headers["Retry-After"]

    # A miss costs budget too, or a guesser would simply be refused for free.
    share.reset_rate_limit()
    for _ in range(share.RATE_LIMIT):
        client.get("/api/v1/share/no-such-link-at-all")
    assert client.get(f"/api/v1/share/{slug}").status_code == 429
