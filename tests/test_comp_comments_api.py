"""The comment thread on a comp.

Three invariants carry this file.

**A comment on a comp you may not see does not exist.** Same 404, same words, whichever way
reaching it fails — the thread is behind the same gate the comp is.

**A thread is honest about itself.** ``created_at`` is when something was said and never
moves; ``updated_at`` appears only when the body was rewritten. A comment showing its
original timestamp after an edit would be a comment lying about itself.

**Editing and moderating are different powers.** An author rewrites their own words and
nobody else's — an owner who could edit could put words in somebody's mouth — while an owner
can remove anyone's, which is what moderation means.
"""

from __future__ import annotations

import uuid

from conftest import RULESET_SLUG

OWNER = 90_000_201
EDITOR = 90_000_202
VIEWER = 90_000_203
STRANGER = 90_000_204


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


def post(client, comp: dict, body: str) -> dict:
    response = client.post(f"/api/v1/comps/{comp['id']}/comments", json={"body": body})
    assert response.status_code == 201, response.text
    return response.json()


def thread(client, comp: dict) -> list[dict]:
    response = client.get(f"/api/v1/comps/{comp['id']}/comments")
    assert response.status_code == 200
    return response.json()


def test_a_comment_carries_its_author_its_body_and_when_it_was_said(client, sign_in, publish):
    publish()
    sign_in(OWNER, "Vex")
    comp = make_comp(client, make_team(client))

    comment = post(client, comp, "This wants a third logi.")

    assert comment["authorName"] == "Vex"
    assert comment["body"] == "This wants a third logi."
    assert comment["createdAt"]
    assert comment["updatedAt"] is None
    assert comment["yours"] is True


def test_a_thread_reads_in_the_order_it_happened(client, sign_in, publish):
    publish()
    sign_in(OWNER)
    comp = make_comp(client, make_team(client))
    post(client, comp, "First")
    post(client, comp, "Second")
    post(client, comp, "Third")

    assert [comment["body"] for comment in thread(client, comp)] == ["First", "Second", "Third"]


def test_a_new_comp_has_an_empty_thread_rather_than_no_thread(client, sign_in, publish):
    publish()
    sign_in(OWNER)

    comp = make_comp(client, make_team(client))

    assert thread(client, comp) == []
    assert comp["commentCount"] == 0


def test_a_viewer_may_comment_because_reviewing_is_the_point(client, sign_in, publish, resolver):
    """§4.1b: any team member with access. The one write path open below editor."""
    publish()
    resolver.knows("Ruzan", VIEWER)
    sign_in(OWNER)
    team = make_team(client)
    grant_to(client, team, "Ruzan", "viewer")
    comp = make_comp(client, team)

    sign_in(VIEWER, "Ruzan")
    commented = client.post(
        f"/api/v1/comps/{comp['id']}/comments", json={"body": "Over budget by three."}
    )
    # Still no way to change the comp itself, which is what the level means.
    edited = client.put(f"/api/v1/comps/{comp['id']}/slots", json={"slots": []})

    assert commented.status_code == 201
    assert edited.status_code == 404


def test_an_author_rewrites_their_own_comment_and_the_thread_says_so(client, sign_in, publish):
    publish()
    sign_in(OWNER)
    comp = make_comp(client, make_team(client))
    comment = post(client, comp, "Needs more logi")

    response = client.patch(
        f"/api/v1/comps/{comp['id']}/comments/{comment['id']}", json={"body": "Needs one more logi"}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["body"] == "Needs one more logi"
    assert body["updatedAt"] is not None
    # When it was said is a fact about the conversation and does not move.
    assert body["createdAt"] == comment["createdAt"]


def test_an_author_deletes_their_own_comment(client, sign_in, publish):
    publish()
    sign_in(OWNER)
    comp = make_comp(client, make_team(client))
    comment = post(client, comp, "Never mind")

    removed = client.delete(f"/api/v1/comps/{comp['id']}/comments/{comment['id']}")

    assert removed.status_code == 204
    assert thread(client, comp) == []


def test_an_owner_moderates_a_comment_they_did_not_write(client, sign_in, publish, resolver):
    publish()
    resolver.knows("Salvos", EDITOR)
    sign_in(OWNER, "Kadir")
    team = make_team(client)
    grant_to(client, team, "Salvos", "editor")
    comp = make_comp(client, team)

    sign_in(EDITOR, "Salvos")
    theirs = post(client, comp, "Something regrettable")

    sign_in(OWNER, "Kadir")
    moderated = client.delete(f"/api/v1/comps/{comp['id']}/comments/{theirs['id']}")

    assert moderated.status_code == 204
    assert thread(client, comp) == []


def test_an_owner_may_remove_a_comment_but_not_rewrite_it(client, sign_in, publish, resolver):
    """Moderating is taking something out, not putting different words in somebody's mouth."""
    publish()
    resolver.knows("Salvos", EDITOR)
    sign_in(OWNER, "Kadir")
    team = make_team(client)
    grant_to(client, team, "Salvos", "editor")
    comp = make_comp(client, team)

    sign_in(EDITOR, "Salvos")
    theirs = post(client, comp, "I still think this is fine")

    sign_in(OWNER, "Kadir")
    refused = client.patch(
        f"/api/v1/comps/{comp['id']}/comments/{theirs['id']}", json={"body": "I was wrong"}
    )

    assert refused.status_code == 403
    assert thread(client, comp)[0]["body"] == "I still think this is fine"


def test_an_editor_may_not_touch_somebody_elses_comment(client, sign_in, publish, resolver):
    """403, not 404: the comment is right there in a thread they can read.

    The 404 rule exists so a comp id cannot tell you which teams there are. Nothing here
    does — they are already on the team and already looking at the comment.
    """
    publish()
    resolver.knows("Salvos", EDITOR)
    sign_in(OWNER, "Kadir")
    team = make_team(client)
    grant_to(client, team, "Salvos", "editor")
    comp = make_comp(client, team)
    mine = post(client, comp, "Mine")

    sign_in(EDITOR, "Salvos")
    edited = client.patch(
        f"/api/v1/comps/{comp['id']}/comments/{mine['id']}", json={"body": "Not yours"}
    )
    deleted = client.delete(f"/api/v1/comps/{comp['id']}/comments/{mine['id']}")

    assert edited.status_code == deleted.status_code == 403
    assert thread(client, comp)[0]["body"] == "Mine"


def test_a_thread_says_which_comments_are_yours(client, sign_in, publish, resolver):
    """Computed on the server, so the SPA gates its controls rather than guessing."""
    publish()
    resolver.knows("Salvos", EDITOR)
    sign_in(OWNER, "Kadir")
    team = make_team(client)
    grant_to(client, team, "Salvos", "editor")
    comp = make_comp(client, team)
    post(client, comp, "Kadir's")

    sign_in(EDITOR, "Salvos")
    post(client, comp, "Salvos'")

    assert [comment["yours"] for comment in thread(client, comp)] == [False, True]


def test_a_comment_with_no_recorded_author_is_nobodys_to_edit(client, session, sign_in, publish):
    """A null author is nobody, not everybody.

    ``author_character_id`` is nullable — the column predates sign-in being required — so this
    is reachable, and the answer has to be that no one inherits it. An owner can still
    moderate it away, which is the only power that makes sense over an unattributed note.
    """
    from comptool.models import CompComment

    publish()
    sign_in(OWNER)
    comp = make_comp(client, make_team(client))
    orphan = CompComment(comp_id=uuid.UUID(comp["id"]), body="Left by nobody")
    session.add(orphan)
    session.commit()
    orphan_id = orphan.id

    listed = thread(client, comp)
    edited = client.patch(
        f"/api/v1/comps/{comp['id']}/comments/{orphan_id}", json={"body": "Mine now"}
    )
    moderated = client.delete(f"/api/v1/comps/{comp['id']}/comments/{orphan_id}")

    assert listed[0]["authorName"] is None
    assert listed[0]["yours"] is False
    assert edited.status_code == 403
    assert moderated.status_code == 204


def test_a_comment_id_from_another_comp_is_not_reachable_through_this_one(
    client, sign_in, publish
):
    """Scoped to its thread, the way a grant is scoped to its team."""
    publish()
    sign_in(OWNER)
    team = make_team(client)
    mine = make_comp(client, team, "Mine")
    other = make_comp(client, team, "Other")
    elsewhere = post(client, other, "Over there")

    response = client.patch(
        f"/api/v1/comps/{mine['id']}/comments/{elsewhere['id']}", json={"body": "Moved"}
    )

    assert response.status_code == 404
    assert response.json()["detail"].startswith("No comment ")


def test_a_thread_on_a_hidden_comp_answers_like_a_thread_on_a_missing_one(
    client, sign_in, publish
):
    publish()
    sign_in(OWNER)
    comp = make_comp(client, make_team(client))
    post(client, comp, "Private thoughts")

    sign_in(STRANGER)
    hidden = client.get(f"/api/v1/comps/{comp['id']}/comments")
    missing = client.get(f"/api/v1/comps/{uuid.uuid4()}/comments")

    assert hidden.status_code == missing.status_code == 404
    assert hidden.json()["detail"].startswith("No comp ")
    assert set(hidden.json()) == set(missing.json())


def test_an_archived_team_refuses_new_comments_but_still_shows_the_thread(
    client, sign_in, publish
):
    """Archiving puts a season away; it does not open it up for annotation.

    Reading stays open, because archiving is not a loss of permission — the same split every
    other write on an archived team already makes.
    """
    publish()
    sign_in(OWNER)
    team = make_team(client)
    comp = make_comp(client, team)
    said = post(client, comp, "Said before the archive")
    client.post(f"/api/v1/teams/{team['id']}/archive")

    blocked = client.post(f"/api/v1/comps/{comp['id']}/comments", json={"body": "After"})
    edited = client.patch(
        f"/api/v1/comps/{comp['id']}/comments/{said['id']}", json={"body": "Changed"}
    )
    readable = client.get(f"/api/v1/comps/{comp['id']}/comments")

    assert blocked.status_code == edited.status_code == 409
    assert readable.status_code == 200
    assert [comment["body"] for comment in readable.json()] == ["Said before the archive"]


def test_a_blank_comment_is_refused_rather_than_posted_as_an_empty_line(client, sign_in, publish):
    publish()
    sign_in(OWNER)
    comp = make_comp(client, make_team(client))

    response = client.post(f"/api/v1/comps/{comp['id']}/comments", json={"body": "   "})

    assert response.status_code == 422


def test_a_comment_may_not_be_longer_than_one_request_allows(client, sign_in, publish):
    publish()
    sign_in(OWNER)
    comp = make_comp(client, make_team(client))

    response = client.post(f"/api/v1/comps/{comp['id']}/comments", json={"body": "x" * 4001})

    assert response.status_code == 422


def test_deleting_a_comp_takes_its_thread_with_it(client, sign_in, publish):
    publish()
    sign_in(OWNER)
    comp = make_comp(client, make_team(client))
    post(client, comp, "Goes with it")

    assert client.delete(f"/api/v1/comps/{comp['id']}").status_code == 204

    assert client.get(f"/api/v1/comps/{comp['id']}/comments").status_code == 404


def test_a_fork_starts_with_its_own_empty_thread(client, sign_in, publish):
    """§4.1c: a fork gets its own conversation, not a copy of its parent's."""
    publish()
    sign_in(OWNER)
    parent = make_comp(client, make_team(client))
    post(client, parent, "About the original")

    forked = client.post(f"/api/v1/comps/{parent['id']}/fork", json={"name": "Variant"}).json()

    assert thread(client, forked) == []
    assert forked["commentCount"] == 0
    assert len(thread(client, parent)) == 1


def test_every_comment_route_needs_a_session(client, publish):
    publish()
    comp_id = uuid.uuid4()
    comment_id = uuid.uuid4()

    answers = [
        client.get(f"/api/v1/comps/{comp_id}/comments"),
        client.post(f"/api/v1/comps/{comp_id}/comments", json={"body": "x"}),
        client.patch(f"/api/v1/comps/{comp_id}/comments/{comment_id}", json={"body": "x"}),
        client.delete(f"/api/v1/comps/{comp_id}/comments/{comment_id}"),
    ]

    assert [answer.status_code for answer in answers] == [401] * 4
