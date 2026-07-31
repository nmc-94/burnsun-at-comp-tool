"""A board that belongs to the team, and the rules that keep it from becoming a probe.

Three invariants carry this file.

**A board id answers nothing.** A board from another team, a board that never existed, and a
board whose team the caller cannot see all give one 404 with one sentence. This matters more
here than anywhere else in the application, because a shared board's whole purpose is that its
URL gets pasted into a channel — it is the id most likely to be tried by somebody who should
not have it.

**A write is never an oracle either.** Adding a comp the team does not have answers exactly as
adding a uuid that was never a comp: the id is dropped, the board comes back, and nothing in
the response says which it was. The foreign key would happily accept another team's comp and
would raise for a stranger's uuid, so the two have to be settled in Python before either
reaches the database.

**Two people doing the same thing at once is ordinary, not an error.** Adding a comp already on
the board leaves it where it is; removing a tile somebody else has just removed answers the same
204; moving a tile that is gone answers with the board rather than a 404. Every one of those is
reachable in the middle of a gesture, and an error mid-drag is worse than a no-op.
"""

from __future__ import annotations

import uuid

from sqlalchemy import delete, select

from comptool.models import SharedBoard, SharedBoardTile, Team
from comptool.shared_boards import POSITION_GAP
from conftest import RULESET_SLUG

OWNER = 92_000_101
EDITOR = 92_000_102
VIEWER = 92_000_103
STRANGER = 92_000_104


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


def make_board(client, team: dict, name: str = "Round one", *comp_ids: str) -> dict:
    response = client.post(
        f"/api/v1/teams/{team['id']}/boards", json={"name": name, "tiles": list(comp_ids)}
    )
    assert response.status_code == 201, response.text
    return response.json()


def add_tile(client, board: dict, comp_id: str, before: str | None = None) -> dict:
    body: dict = {"compId": comp_id}
    if before is not None:
        body["beforeCompId"] = before
    response = client.post(f"/api/v1/boards/{board['id']}/tiles", json=body)
    assert response.status_code == 200, response.text
    return response.json()


def move_tile(client, board: dict, comp_id: str, before: str | None) -> dict:
    response = client.patch(
        f"/api/v1/boards/{board['id']}/tiles/{comp_id}", json={"beforeCompId": before}
    )
    assert response.status_code == 200, response.text
    return response.json()


def order(board: dict) -> list[str]:
    return [tile["compId"] for tile in board["tiles"]]


def read(client, board: dict) -> dict:
    response = client.get(f"/api/v1/boards/{board['id']}")
    assert response.status_code == 200
    return response.json()


# --- The gate ------------------------------------------------------------------------------


def test_a_board_from_another_team_answers_exactly_as_one_that_never_existed(
    client, sign_in, publish
):
    """The assertion the whole feature's discretion rests on.

    A shared board's address is meant to be pasted around, so this is the id most likely to be
    tried by somebody who should not have it. Down to the sentence, because a difference of one
    word is still a difference somebody can measure.
    """
    publish()
    sign_in(OWNER, "Kadir")
    mine = make_team(client)
    board = make_board(client, mine)

    sign_in(STRANGER, "Nobody")
    theirs = client.get(f"/api/v1/boards/{board['id']}")
    missing = client.get(f"/api/v1/boards/{uuid.uuid4()}")

    assert theirs.status_code == missing.status_code == 404
    assert theirs.json()["detail"][: len("No board")] == "No board"
    # Not "No team ...", which would confirm the team behind the link is real.
    assert theirs.json()["detail"] == f"No board {board['id']!r}"


def test_a_viewer_reads_the_board_and_cannot_move_anything(client, sign_in, publish, resolver):
    """Seeing what the team is working on is not editing it.

    ``save_workspace`` is a viewer's write because arranging your own screen is nobody else's
    business. A shared board negates every clause of that sentence, so every write here is an
    editor's — and a viewer's refusal is the same 404 the gate gives, learning nothing from the
    difference between "may not" and "is not there".
    """
    publish()
    sign_in(OWNER, "Kadir")
    team = make_team(client)
    comp = make_comp(client, team)
    resolver.knows("Ayla", VIEWER)
    grant_to(client, team, "Ayla", "viewer")
    board = make_board(client, team, "Round one", comp["id"])

    sign_in(VIEWER, "Ayla")
    assert order(read(client, board)) == [comp["id"]]
    for refused in (
        client.patch(f"/api/v1/boards/{board['id']}", json={"name": "Mine now"}),
        client.delete(f"/api/v1/boards/{board['id']}"),
        client.post(f"/api/v1/boards/{board['id']}/tiles", json={"compId": comp["id"]}),
        client.delete(f"/api/v1/boards/{board['id']}/tiles/{comp['id']}"),
    ):
        assert refused.status_code == 404, refused.text


def test_an_archived_team_still_serves_boards_and_refuses_every_write(client, sign_in, publish):
    """A shared board is part of the season's record, so archiving freezes it.

    ``save_workspace`` deliberately skips ``live()`` because a layout is nobody's work. A shared
    board is on the other side of that argument, so every write here answers 409 — and that is
    the *only* thing 409 means on these routes, which is what keeps the refusal readable.
    """
    publish()
    sign_in(OWNER, "Kadir")
    team = make_team(client)
    comp = make_comp(client, team)
    board = make_board(client, team, "Round one", comp["id"])
    assert client.post(f"/api/v1/teams/{team['id']}/archive").status_code in (200, 204)

    assert order(read(client, board)) == [comp["id"]]
    for response in (
        client.patch(f"/api/v1/boards/{board['id']}", json={"name": "Renamed"}),
        client.post(f"/api/v1/boards/{board['id']}/tiles", json={"compId": comp["id"]}),
        client.patch(
            f"/api/v1/boards/{board['id']}/tiles/{comp['id']}", json={"beforeCompId": None}
        ),
        client.delete(f"/api/v1/boards/{board['id']}/tiles/{comp['id']}"),
        client.delete(f"/api/v1/boards/{board['id']}"),
    ):
        assert response.status_code == 409, response.text


# --- What a board is not an oracle about ----------------------------------------------------


def test_adding_a_comp_the_team_does_not_have_answers_as_adding_one_that_never_existed(
    client, sign_in, publish
):
    """The foreign key would take one and raise for the other. Neither may be visible.

    ``shared_board_tile.comp_id`` is satisfied by *any* comp, including another team's, and
    raises ``IntegrityError`` for a uuid that was never a comp at all. If either reached the
    database the two would be distinguishable, and a board would become a way to ask which comps
    exist. So both are resolved away in Python and both are dropped.
    """
    publish()
    sign_in(STRANGER, "Nobody")
    elsewhere = make_team(client, "Somebody else")
    foreign = make_comp(client, elsewhere, "Not yours")

    sign_in(OWNER, "Kadir")
    team = make_team(client)
    board = make_board(client, team)

    theirs = client.post(f"/api/v1/boards/{board['id']}/tiles", json={"compId": foreign["id"]})
    invented = client.post(
        f"/api/v1/boards/{board['id']}/tiles", json={"compId": str(uuid.uuid4())}
    )

    assert theirs.status_code == invented.status_code == 200
    assert theirs.json() == invented.json()
    assert theirs.json()["tiles"] == []
    # And neither counted as a change, so nobody's screen was told to re-read nothing.
    assert theirs.json()["revision"] == invented.json()["revision"]


def test_creating_a_board_drops_the_ids_it_may_not_have(client, sign_in, publish):
    publish()
    sign_in(STRANGER, "Nobody")
    elsewhere = make_team(client, "Somebody else")
    foreign = make_comp(client, elsewhere, "Not yours")

    sign_in(OWNER, "Kadir")
    team = make_team(client)
    mine = make_comp(client, team)

    board = make_board(client, team, "Round one", foreign["id"], mine["id"], str(uuid.uuid4()))

    assert order(board) == [mine["id"]]


def test_adding_the_same_comp_twice_leaves_one_tile_and_does_not_move_it(
    client, sign_in, publish
):
    """Two people reaching for the same comp at once is ordinary, and an add is not a move."""
    publish()
    sign_in(OWNER, "Kadir")
    team = make_team(client)
    first = make_comp(client, team, "Alpha")
    second = make_comp(client, team, "Beta")
    board = make_board(client, team, "Round one", first["id"], second["id"])

    again = add_tile(client, board, first["id"])

    assert order(again) == [first["id"], second["id"]]
    assert again["revision"] == board["revision"]


def test_removing_an_already_gone_tile_is_the_same_204(client, sign_in, publish):
    """Deliberately unlike ``revoke_share``'s 404.

    Two people closing one tile is what two people on one board do. Answering the second with an
    error would surface a race as a failure in the middle of a gesture.
    """
    publish()
    sign_in(OWNER, "Kadir")
    team = make_team(client)
    comp = make_comp(client, team)
    board = make_board(client, team, "Round one", comp["id"])

    first = client.delete(f"/api/v1/boards/{board['id']}/tiles/{comp['id']}")
    second = client.delete(f"/api/v1/boards/{board['id']}/tiles/{comp['id']}")
    never = client.delete(f"/api/v1/boards/{board['id']}/tiles/{uuid.uuid4()}")

    assert first.status_code == second.status_code == never.status_code == 204
    assert order(read(client, board)) == []


def test_moving_a_tile_that_is_gone_answers_with_the_board(client, sign_in, publish):
    publish()
    sign_in(OWNER, "Kadir")
    team = make_team(client)
    comp = make_comp(client, team)
    board = make_board(client, team, "Round one", comp["id"])
    client.delete(f"/api/v1/boards/{board['id']}/tiles/{comp['id']}")

    answered = client.patch(
        f"/api/v1/boards/{board['id']}/tiles/{comp['id']}", json={"beforeCompId": None}
    )

    assert answered.status_code == 200
    assert answered.json()["tiles"] == []


# --- Order ----------------------------------------------------------------------------------


def test_a_move_names_a_neighbour_and_touches_no_other_row(client, sign_in, publish, session):
    """Sparse positions are what make two people moving two tiles two independent writes.

    If a move renumbered its neighbours, every drop would be an UPDATE per tile on the board and
    two simultaneous drops would be a lost update on the commonest gesture the feature has.
    """
    publish()
    sign_in(OWNER, "Kadir")
    team = make_team(client)
    first = make_comp(client, team, "Alpha")
    second = make_comp(client, team, "Beta")
    third = make_comp(client, team, "Gamma")
    board = make_board(client, team, "Round one", first["id"], second["id"], third["id"])

    before = _positions(session, board)
    moved = move_tile(client, board, third["id"], before=first["id"])

    after = _positions(session, board)
    assert order(moved) == [third["id"], first["id"], second["id"]]
    # The two that did not move are byte-identical; only the carried tile was written.
    assert after[uuid.UUID(first["id"])] == before[uuid.UUID(first["id"])]
    assert after[uuid.UUID(second["id"])] == before[uuid.UUID(second["id"])]


def test_a_move_to_the_end_is_a_null_neighbour(client, sign_in, publish):
    publish()
    sign_in(OWNER, "Kadir")
    team = make_team(client)
    first = make_comp(client, team, "Alpha")
    second = make_comp(client, team, "Beta")
    board = make_board(client, team, "Round one", first["id"], second["id"])

    moved = move_tile(client, board, first["id"], before=None)

    assert order(moved) == [second["id"], first["id"]]


def test_the_board_renumbers_itself_when_the_gaps_run_out(client, sign_in, publish, session):
    """Sixteen drops into one slot reaches it, so this path runs rather than might.

    Halving a gap of 65536 exhausts it after sixteen moves. The renumber happens inside the same
    transaction, so a board is never briefly numbered two ways, and the order it was in is what
    comes out the other side.
    """
    publish()
    sign_in(OWNER, "Kadir")
    team = make_team(client)
    first = make_comp(client, team, "Alpha")
    second = make_comp(client, team, "Beta")
    filler = [make_comp(client, team, f"Filler {n}") for n in range(18)]
    board = make_board(client, team, "Round one", first["id"], second["id"])

    # Every one of these lands between the same two tiles, halving the gap each time.
    wedged = []
    for comp in filler:
        add_tile(client, board, comp["id"], before=second["id"])
        wedged.append(comp["id"])

    final = read(client, board)
    assert order(final) == [first["id"], *wedged, second["id"]]
    # And the positions came back out to full gaps rather than converging on one number.
    positions = sorted(_positions(session, board).values())
    assert len(set(positions)) == len(positions)
    assert min(positions[i + 1] - positions[i] for i in range(len(positions) - 1)) > 1


def test_a_renumbered_board_is_still_spread_on_the_standard_gap(client, sign_in, publish, session):
    publish()
    sign_in(OWNER, "Kadir")
    team = make_team(client)
    comps = [make_comp(client, team, f"Comp {n}") for n in range(3)]
    board = make_board(client, team, "Round one", *[comp["id"] for comp in comps])

    assert sorted(_positions(session, board).values()) == [
        0,
        POSITION_GAP,
        2 * POSITION_GAP,
    ]


def _positions(session, board: dict) -> dict[uuid.UUID, int]:
    session.expire_all()
    rows = session.execute(
        select(SharedBoardTile.comp_id, SharedBoardTile.position).where(
            SharedBoardTile.board_id == uuid.UUID(board["id"])
        )
    ).all()
    return {comp_id: position for comp_id, position in rows}


# --- Revisions ------------------------------------------------------------------------------


def test_an_op_that_changes_nothing_leaves_the_revision_where_it_was(client, sign_in, publish):
    """A write that changes nothing writes nothing and tells nobody.

    Every no-op that bumped the revision would be a full re-read on every other screen, and a
    drag that returns a tile to where it started does exactly that.
    """
    publish()
    sign_in(OWNER, "Kadir")
    team = make_team(client)
    first = make_comp(client, team, "Alpha")
    second = make_comp(client, team, "Beta")
    board = make_board(client, team, "Round one", first["id"], second["id"])
    settled = read(client, board)["revision"]

    renamed_the_same = client.patch(f"/api/v1/boards/{board['id']}", json={"name": board["name"]})
    put_back = move_tile(client, board, first["id"], before=second["id"])
    nothing_asked = client.patch(f"/api/v1/boards/{board['id']}/tiles/{first['id']}", json={})

    assert renamed_the_same.json()["revision"] == settled
    assert put_back["revision"] == settled
    assert nothing_asked.json()["revision"] == settled


def test_the_revision_moves_once_per_change_and_never_backwards(client, sign_in, publish):
    publish()
    sign_in(OWNER, "Kadir")
    team = make_team(client)
    comp = make_comp(client, team)
    board = make_board(client, team)

    seen = [board["revision"]]
    seen.append(add_tile(client, board, comp["id"])["revision"])
    renamed = client.patch(f"/api/v1/boards/{board['id']}", json={"name": "Renamed"})
    seen.append(renamed.json()["revision"])
    seen.append(move_tile(client, board, comp["id"], before=None)["revision"])

    # The move was a no-op — one tile has one place — so three changes and one that was not.
    assert seen[1] > seen[0]
    assert seen[2] > seen[1]
    assert seen[3] == seen[2]


def test_changing_only_one_field_leaves_the_others_alone(client, sign_in, publish):
    """Absence and null are different, or two people changing two fields revert each other."""
    publish()
    sign_in(OWNER, "Kadir")
    team = make_team(client)
    board = make_board(client, team, "Round one")

    client.patch(f"/api/v1/boards/{board['id']}", json={"snap": False})
    only_the_name = client.patch(f"/api/v1/boards/{board['id']}", json={"name": "Round two"})

    assert only_the_name.json()["name"] == "Round two"
    assert only_the_name.json()["snap"] is False


# --- What the cascade takes with it ---------------------------------------------------------


def test_deleting_a_comp_takes_its_tiles_off_every_board(client, sign_in, publish):
    """The reason this is a table and not a document.

    A comp id cannot outlive its comp, so no route and no client has to remember to filter one
    out — which also means the client's board handler can *read* and never write. Otherwise
    every participant looking at the board would race to remove the same tile.
    """
    publish()
    sign_in(OWNER, "Kadir")
    team = make_team(client)
    doomed = make_comp(client, team, "Alpha")
    kept = make_comp(client, team, "Beta")
    first = make_board(client, team, "Round one", doomed["id"], kept["id"])
    second = make_board(client, team, "Round two", doomed["id"])

    assert client.delete(f"/api/v1/comps/{doomed['id']}").status_code == 204

    assert order(read(client, first)) == [kept["id"]]
    assert order(read(client, second)) == []


def test_deleting_a_board_leaves_its_comps_alone(client, sign_in, publish, session):
    """A tile is a pointer. Closing a board destroys an arrangement, never anybody's work."""
    publish()
    sign_in(OWNER, "Kadir")
    team = make_team(client)
    comp = make_comp(client, team)
    board = make_board(client, team, "Round one", comp["id"])

    assert client.delete(f"/api/v1/boards/{board['id']}").status_code == 204

    assert client.get(f"/api/v1/comps/{comp['id']}").status_code == 200
    # Scoped to the board under test rather than counting the table: every team is born with a
    # default board (``shared_boards.seed_default_board``), so an empty table would now be
    # evidence that the seed had gone missing rather than that this delete had worked.
    doomed = uuid.UUID(board["id"])
    assert session.get(SharedBoard, doomed) is None
    assert (
        session.scalars(
            select(SharedBoardTile).where(SharedBoardTile.board_id == doomed)
        ).all()
        == []
    )


def test_a_board_belongs_to_its_team_and_goes_with_it(client, sign_in, publish, session):
    """Cascading in the database and not only in the ORM.

    No route deletes a team — archiving is what the application offers — so this is exercised
    the way a hand-run cleanup would do it. That is the case the cascade exists for: somebody at
    a psql prompt should not have to know this table is special.
    """
    publish()
    sign_in(OWNER, "Kadir")
    team = make_team(client)
    comp = make_comp(client, team)
    make_board(client, team, "Round one", comp["id"])

    session.execute(delete(Team).where(Team.id == uuid.UUID(team["id"])))
    session.commit()

    assert session.scalars(select(SharedBoard)).all() == []
    assert session.scalars(select(SharedBoardTile)).all() == []


# --- Promotion ------------------------------------------------------------------------------


def test_promoting_copies_the_tiles_and_leaves_the_personal_board_alone(
    client, sign_in, publish
):
    """The personal board is not converted, and that is three decisions in one.

    A half-failed conversion would cost the arrangement; a board flipping in place would turn
    ``Open board X`` into ``Open shared board X`` for the same object, which §6.8 forbids by
    name; and the two objects diverge from that moment anyway.
    """
    publish()
    sign_in(OWNER, "Kadir")
    team = make_team(client)
    first = make_comp(client, team, "Alpha")
    second = make_comp(client, team, "Beta")
    personal = {
        "id": str(uuid.uuid4()),
        "name": "Kite drafts",
        "tiles": [{"compId": first["id"]}, {"compId": second["id"]}],
    }
    saved = client.put(
        f"/api/v1/teams/{team['id']}/workspace",
        json={"boards": [personal], "activeBoardId": personal["id"]},
    )
    assert saved.status_code == 200

    shared = make_board(client, team, "Kite drafts", first["id"], second["id"])

    assert order(shared) == [first["id"], second["id"]]
    still_there = client.get(f"/api/v1/teams/{team['id']}/workspace").json()
    assert [board["id"] for board in still_there["boards"]] == [personal["id"]]
    assert [tile["compId"] for tile in still_there["boards"][0]["tiles"]] == [
        first["id"],
        second["id"],
    ]


def test_a_shared_board_is_not_a_member_of_the_personal_workspace(client, sign_in, publish):
    """The check that the two documents never mixed.

    Putting shared boards in ``WorkspaceDetail.boards`` would mean each participant storing their
    own private copy of the team's arrangement and writing it back on their next save.
    """
    publish()
    sign_in(OWNER, "Kadir")
    team = make_team(client)
    shared = make_board(client, team, "Round one")

    workspace = client.get(f"/api/v1/teams/{team['id']}/workspace").json()

    assert shared["id"] not in [board["id"] for board in workspace["boards"]]


# --- Bookkeeping ----------------------------------------------------------------------------


def test_a_board_carries_who_made_it_and_what_it_holds(client, sign_in, publish):
    publish()
    sign_in(OWNER, "Kadir")
    team = make_team(client)
    board = make_board(client, team, "Round one")

    assert board["createdByName"] == "Kadir"
    assert board["teamId"] == team["id"]
    assert board["mode"] == "grid"
    assert board["snap"] is True


def test_the_board_a_team_is_born_with_is_an_ordinary_board(client, sign_in, publish):
    """"By default" means at creation, not for ever.

    No route knows this board from any other, and none should. There is no column marking it, so
    the only thing a protection could key on is the name — which the rename control sitting on
    the same tab would defeat in one keystroke, leaving either a board called anything that
    cannot be deleted or a "Team board" that a rename re-armed. The rule this does not get is
    the personal strip's "the last board never closes", and that rule exists because a workspace
    with no board has nowhere to put a comp; a team with no *shared* board still has every
    personal one.
    """
    publish()
    sign_in(OWNER, "Kadir")
    team = make_team(client)
    default = client.get(f"/api/v1/teams/{team['id']}/boards").json()[0]

    renamed = client.patch(f"/api/v1/boards/{default['id']}", json={"name": "Round one"})
    assert renamed.status_code == 200
    assert renamed.json()["name"] == "Round one"

    assert client.delete(f"/api/v1/boards/{default['id']}").status_code == 204
    assert client.get(f"/api/v1/teams/{team['id']}/boards").json() == []


def test_a_tile_says_only_which_comp_it_is(client, sign_in, publish):
    """§6.7's shape rule, at the wire.

    "Somebody put the comps in the board document to save a fetch" is the plausible regression
    here, and nothing else would catch it: a board that carried a comp's hulls would re-render
    every tile on the board whenever anybody typed.
    """
    publish()
    sign_in(OWNER, "Kadir")
    team = make_team(client)
    comp = make_comp(client, team)
    board = make_board(client, team, "Round one", comp["id"])

    assert board["tiles"] == [{"compId": comp["id"]}]


def test_boards_are_listed_per_team_and_only_your_own(client, sign_in, publish):
    publish()
    sign_in(STRANGER, "Nobody")
    elsewhere = make_team(client, "Somebody else")
    theirs = make_board(client, elsewhere, "Not yours")

    sign_in(OWNER, "Kadir")
    team = make_team(client)
    mine = make_board(client, team, "Round one")

    listed = client.get(f"/api/v1/teams/{team['id']}/boards")

    assert listed.status_code == 200
    # Two, because the team was born with one: the default board, then the one just made. The
    # order is the route's — ``created_at, id`` — and ``now()`` is the transaction's clock, so
    # the seed sorts ahead of anything a later request adds.
    assert [board["name"] for board in listed.json()] == ["Team board", "Round one"]
    ids = [board["id"] for board in listed.json()]
    assert ids[1] == mine["id"]
    assert theirs["id"] not in ids


def test_an_editor_may_make_and_work_a_board(client, sign_in, publish, resolver):
    publish()
    sign_in(OWNER, "Kadir")
    team = make_team(client)
    comp = make_comp(client, team)
    resolver.knows("Ayla", EDITOR)
    grant_to(client, team, "Ayla", "editor")

    sign_in(EDITOR, "Ayla")
    board = make_board(client, team, "Ayla's board", comp["id"])

    assert board["createdByName"] == "Ayla"
    assert order(board) == [comp["id"]]
    assert client.delete(f"/api/v1/boards/{board['id']}").status_code == 204


def test_an_editor_may_close_a_board_somebody_else_made(client, sign_in, publish, resolver):
    """Deliberately not ``delete_comp``'s creator-or-owner rule.

    Deleting somebody's draft is not collaboration, but a board is an arrangement of pointers —
    closing one destroys no work, and requiring the creator would leave a board un-closable the
    moment they left the team.
    """
    publish()
    sign_in(OWNER, "Kadir")
    team = make_team(client)
    resolver.knows("Ayla", EDITOR)
    grant_to(client, team, "Ayla", "editor")
    board = make_board(client, team, "Kadir's board")

    sign_in(EDITOR, "Ayla")

    assert client.delete(f"/api/v1/boards/{board['id']}").status_code == 204
