"""Archetype and tags: the two namespaces, and the one place a value is spelled.

Two invariants carry this file.

**The namespaces never mix.** An archetype is a column and a tag is a row, so there is no
query that could accidentally offer one as the other. The tests below assert the behaviour
that structure buys, because a later refactor that merged them would still have to pass.

**A value has one spelling per team.** §3.3's rule is that "Kiter" and "kiter " must not
diverge, and the honest reading of that is not "fold everything to lower case" — a chip
reading "kiter" because somebody typed in a hurry is a worse answer than the problem. The
first person to use a value chooses how it is written; everyone after them matches.
"""

from __future__ import annotations

from conftest import RULESET_SLUG

OWNER = 90_000_101
EDITOR = 90_000_102
VIEWER = 90_000_103
STRANGER = 90_000_104

ABADDON = 24_692


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


def set_tags(client, comp: dict, archetype=None, tags=None) -> dict:
    response = client.put(
        f"/api/v1/comps/{comp['id']}/tags", json={"archetype": archetype, "tags": tags or []}
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_a_comp_carries_one_archetype_and_any_number_of_tags(client, sign_in, publish):
    publish()
    sign_in(OWNER)
    comp = make_comp(client, make_team(client))

    body = set_tags(client, comp, archetype="Kite", tags=["Shield", "Angel"])

    assert body["archetype"] == "Kite"
    # Sorted on the way out, so no client has to.
    assert body["tags"] == ["Angel", "Shield"]


def test_a_new_comp_starts_with_neither(client, sign_in, publish):
    publish()
    sign_in(OWNER)

    comp = make_comp(client, make_team(client))

    assert comp["archetype"] is None
    assert comp["tags"] == []


def test_setting_an_archetype_never_adds_a_tag_and_the_reverse(client, sign_in, publish):
    """The two namespaces are separate sets, per §3.3, and never cross."""
    publish()
    sign_in(OWNER)
    comp = make_comp(client, make_team(client))

    only_archetype = set_tags(client, comp, archetype="Brawl")
    only_tags = set_tags(client, comp, tags=["Armor"])

    assert only_archetype["archetype"] == "Brawl"
    assert only_archetype["tags"] == []
    assert only_tags["archetype"] is None
    assert only_tags["tags"] == ["Armor"]


def test_a_value_adopts_the_spelling_the_team_already_uses(client, sign_in, publish):
    """§3.3's normalization, and the reason it is not a case fold.

    The second comp is tagged ``"kiter "`` — wrong case, trailing space. It comes back spelled
    the way the first comp spelled it, so the rail groups them together and the chip still
    reads like something a person wrote.
    """
    publish()
    sign_in(OWNER)
    team = make_team(client)
    first = make_comp(client, team, "First")
    second = make_comp(client, team, "Second")
    set_tags(client, first, archetype="Kiter", tags=["Shield Buffer"])

    body = set_tags(client, second, archetype="kiter ", tags=["  shield   buffer "])

    assert body["archetype"] == "Kiter"
    assert body["tags"] == ["Shield Buffer"]


def test_two_spellings_of_one_tag_in_one_request_collapse_into_one(client, sign_in, publish):
    """Otherwise they would reach the unique index as two rows and collide there."""
    publish()
    sign_in(OWNER)
    comp = make_comp(client, make_team(client))

    body = set_tags(client, comp, tags=["Kiter", "kiter", "KITER"])

    assert body["tags"] == ["Kiter"]


def test_one_teams_vocabulary_does_not_reach_another(client, sign_in, publish):
    """The spelling rule is team-scoped, so a name in use elsewhere is not in use here."""
    publish()
    sign_in(OWNER)
    theirs = make_comp(client, make_team(client, "Aurora Vanguard"), "Theirs")
    set_tags(client, theirs, archetype="Kiter")
    mine = make_comp(client, make_team(client, "Nova Wardens"), "Mine")

    body = set_tags(client, mine, archetype="kiter")

    assert body["archetype"] == "kiter"


def test_tags_are_replaced_wholesale_so_an_absent_one_is_removed(client, sign_in, publish):
    publish()
    sign_in(OWNER)
    comp = make_comp(client, make_team(client))
    set_tags(client, comp, archetype="Kite", tags=["Shield", "Angel", "Cheap"])

    body = set_tags(client, comp, archetype=None, tags=["Shield"])

    assert body["archetype"] is None
    assert body["tags"] == ["Shield"]


def test_resending_the_same_tags_is_not_a_collision(client, sign_in, publish):
    """The clear-then-append needs its flush, the way ``_apply_slots`` does."""
    publish()
    sign_in(OWNER)
    comp = make_comp(client, make_team(client))
    set_tags(client, comp, tags=["Shield", "Angel"])

    body = set_tags(client, comp, tags=["Shield", "Angel"])

    assert body["tags"] == ["Angel", "Shield"]


def test_a_blank_value_is_refused_rather_than_stored_as_an_empty_chip(client, sign_in, publish):
    publish()
    sign_in(OWNER)
    comp = make_comp(client, make_team(client))

    archetype = client.put(
        f"/api/v1/comps/{comp['id']}/tags", json={"archetype": "   ", "tags": []}
    )
    tag = client.put(f"/api/v1/comps/{comp['id']}/tags", json={"tags": ["  "]})

    assert archetype.status_code == tag.status_code == 422


def test_a_comp_may_not_carry_more_tags_than_one_request_allows(client, sign_in, publish):
    """A payload bound, not a statement about how anyone should organize a library."""
    publish()
    sign_in(OWNER)
    comp = make_comp(client, make_team(client))

    response = client.put(
        f"/api/v1/comps/{comp['id']}/tags", json={"tags": [f"Tag {n}" for n in range(21)]}
    )

    assert response.status_code == 422


def test_tags_are_content_so_an_illegal_comp_takes_them_like_any_other(client, sign_in, publish):
    """Nothing about a label reaches the engine. There is no such thing as an illegal tag."""
    publish()
    sign_in(OWNER)
    comp = make_comp(client, make_team(client))
    client.put(
        f"/api/v1/comps/{comp['id']}/slots",
        json={"slots": [{"typeId": ABADDON, "isFlagship": False} for _ in range(11)]},
    )

    body = set_tags(client, comp, archetype="Triple BS", tags=["Idea"])

    assert body["archetype"] == "Triple BS"
    assert body["shipCount"] == 11


def test_a_viewer_may_not_tag_a_comp(client, sign_in, publish, resolver):
    """Tagging is editing what the comp says about itself, so it is an editor's."""
    publish()
    resolver.knows("Ruzan", VIEWER)
    sign_in(OWNER)
    team = make_team(client)
    grant_to(client, team, "Ruzan", "viewer")
    comp = make_comp(client, team)

    sign_in(VIEWER)
    refused = client.put(f"/api/v1/comps/{comp['id']}/tags", json={"archetype": "Mine now"})

    assert refused.status_code == 404
    assert refused.json()["detail"].startswith("No comp ")


def test_tagging_a_comp_in_a_team_you_cannot_see_is_a_404(client, sign_in, publish):
    publish()
    sign_in(OWNER)
    comp = make_comp(client, make_team(client))

    sign_in(STRANGER)
    refused = client.put(f"/api/v1/comps/{comp['id']}/tags", json={"archetype": "Kite"})

    assert refused.status_code == 404


def test_an_archived_team_refuses_tag_edits_until_it_is_restored(client, sign_in, publish):
    publish()
    sign_in(OWNER)
    team = make_team(client)
    comp = make_comp(client, team)
    client.post(f"/api/v1/teams/{team['id']}/archive")

    blocked = client.put(f"/api/v1/comps/{comp['id']}/tags", json={"archetype": "Kite"})
    client.post(f"/api/v1/teams/{team['id']}/restore")

    assert blocked.status_code == 409
    assert set_tags(client, comp, archetype="Kite")["archetype"] == "Kite"


def test_the_listing_and_the_detail_still_agree_once_a_comp_is_tagged(client, sign_in, publish):
    """The new fields land in both paths because ``_detail`` is the only builder."""
    publish()
    sign_in(OWNER)
    team = make_team(client)
    comp = make_comp(client, team)
    set_tags(client, comp, archetype="Kite", tags=["Shield"])

    listed = client.get(f"/api/v1/teams/{team['id']}/comps").json()
    fetched = client.get(f"/api/v1/comps/{comp['id']}").json()

    assert listed == [fetched]


def test_deleting_a_comp_takes_its_tags_with_it(client, sign_in, publish):
    """The cascade, and the reason a tag is not a shared vocabulary row: it belongs to a comp.

    The team's suggestion set is "values in use", so a value stops being suggested when the
    last comp using it goes — which is the behaviour §3.3 describes and the one a stored
    vocabulary table would have quietly broken.
    """
    publish()
    sign_in(OWNER)
    team = make_team(client)
    comp = make_comp(client, team)
    set_tags(client, comp, archetype="Kite", tags=["Shield"])

    assert client.delete(f"/api/v1/comps/{comp['id']}").status_code == 204

    assert client.get(f"/api/v1/teams/{team['id']}/comps").json() == []
