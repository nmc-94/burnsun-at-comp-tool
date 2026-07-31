"""The event stream's route, and that every write actually announces itself.

The second half is the point of this file. ``publish`` is called by hand at each write site
rather than hooked onto the session, which reads well and fails silently: a route added later
that forgets the call breaks nothing, passes everything, and leaves one kind of change
invisible to everybody else's board. There is no way to assert "every committing route
publishes" in general, so the answer is one test per path — and a new write path is expected
to arrive with one.

The stream itself is exercised only as far as its gate. Reading a response that never ends
through ``TestClient`` means driving a loop that is deliberately waiting, so what is checked
here is who may open it; what comes out of it is `test_live_broker.py`'s business.
"""

from __future__ import annotations

import asyncio
import sys
import uuid

import pytest

from comptool import live
from comptool.permissions import Viewer
from conftest import RULESET_SLUG


@pytest.fixture(autouse=True)
def _a_published_ruleset(publish):
    """A comp binds to a ruleset version, and every test here makes a comp.

    Autouse rather than named in each signature, mostly so that ``publish`` — which publishes a
    *ruleset* — does not appear throughout a file whose whole subject is publishing an *event*.
    """
    publish()

OWNER = 91_000_001
EDITOR = 91_000_002
STRANGER = 91_000_003

ABADDON = 24_692
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


class Heard:
    """Stands in for the fan-out, so a test can ask what a write announced.

    Patched over ``live.publish`` rather than opening a real stream: what these tests are
    about is whether the route says anything at all, and a real subscriber would add an event
    loop and a socket to a question that is answered by a list.
    """

    def __init__(self) -> None:
        self.events: list[tuple[uuid.UUID, str, dict]] = []

    def __call__(self, team_id, kind, **fields) -> None:
        self.events.append((team_id, kind, fields))

    def kinds(self) -> list[str]:
        return [kind for _, kind, _ in self.events]

    def only(self) -> tuple[uuid.UUID, str, dict]:
        assert len(self.events) == 1, f"expected one event, got {self.kinds()}"
        return self.events[0]


#: The names ``live`` publishes under, and that a route module imports directly.
_PUBLISHERS = ("publish", "publish_board")


def listening(monkeypatch) -> Heard:
    """Stand in for every publisher, in every module that imported one.

    Patched per importing module because ``from .live import publish`` binds the name
    *there* — patching only ``live.publish`` would leave every caller on the original.

    Which modules those are is **derived rather than written down**. The list used to be a
    hardcoded ``("comps", "comments", "share")``, which fails in the silent direction: a new
    publisher is simply absent from it, and a test asserting that a write announced one thing
    keeps passing while the events it does not name fire unobserved. Identity is the filter,
    so a module with a ``publish`` of its own — ``ingest.store`` publishes a *ruleset* — is
    left alone.
    """
    heard = Heard()
    originals = {name: getattr(live, name) for name in _PUBLISHERS}
    for module in list(sys.modules.values()):
        if not getattr(module, "__name__", "").startswith("comptool.") or module is live:
            continue
        for name, original in originals.items():
            if getattr(module, name, None) is original:
                monkeypatch.setattr(module, name, heard)
    return heard


# --- The route's gate -------------------------------------------------------------------


def test_a_stranger_gets_the_same_404_every_other_team_route_gives(client, sign_in, monkeypatch):
    """Not a 403, and not a different sentence from the one a missing team gets.

    A stream that answered differently for "no such team" and "not yours" would be the
    existence probe the whole of ``access.py`` is written to deny — and it would be a
    particularly good one, because it needs no write and leaves no trace.
    """
    sign_in(OWNER, "Kadir")
    team = make_team(client)

    sign_in(STRANGER, "Nobody")
    refused = client.get(f"/api/v1/teams/{team['id']}/events")
    missing = client.get(f"/api/v1/teams/{uuid.uuid4()}/events")

    assert refused.status_code == 404
    assert missing.status_code == 404
    assert refused.json()["detail"][: len("No team")] == "No team"


def test_signed_out_is_a_401_rather_than_a_404(client):
    """The one thing that is not a secret.

    EventSource retries on a dropped connection but not on a refused one, and the SPA has to
    tell "sign in" from "gone" — the same reason ``current_session`` answers 401.
    """
    team = uuid.uuid4()
    client.cookies.clear()
    assert client.get(f"/api/v1/teams/{team}/events").status_code == 401


def test_the_stream_holds_no_database_connection_open(client, sign_in):
    """The route asks for no session dependency, which is what keeps the pool available.

    Asserted on the signature rather than by counting connections, because that is where the
    mistake would be made: a ``yield`` dependency is released when the *response* finishes, and
    for a stream that is never — so ``Depends(get_session)`` here, or a ``current_viewer`` that
    reaches it, would pin one pooled connection per open board.
    """
    from comptool.db import get_session
    from comptool.main import app

    def every_route(router):
        # An included router is kept as a wrapper around the original rather than being
        # flattened into ``app.routes``, so reaching the real APIRoute means descending
        # through both shapes.
        for candidate in getattr(router, "routes", []):
            yield candidate
            yield from every_route(candidate)
            yield from every_route(getattr(candidate, "original_router", None))

    route = next(
        candidate
        for candidate in every_route(app)
        if getattr(candidate, "path", None) == "/api/v1/teams/{team_id}/events"
    )

    def walk(dependant):
        for sub in dependant.dependencies:
            assert sub.call is not get_session, "the stream must not reach get_session"
            walk(sub)

    walk(route.dependant)


# --- That every write announces itself ----------------------------------------------------


def test_creating_a_comp_announces_it(client, sign_in, monkeypatch):
    heard = listening(monkeypatch)
    sign_in(OWNER, "Kadir")
    team = make_team(client)

    made = make_comp(client, team)

    team_id, kind, fields = heard.only()
    assert str(team_id) == team["id"]
    assert kind == live.KIND_CREATED
    assert str(fields["comp_id"]) == made["id"]
    assert fields["actor"] == "Kadir"


def test_replacing_slots_announces_a_change_carrying_the_new_timestamp(
    client, sign_in, monkeypatch
):
    """The timestamp is what lets a client skip a version it already holds."""
    sign_in(OWNER, "Kadir")
    team = make_team(client)
    comp = make_comp(client, team)

    heard = listening(monkeypatch)
    response = client.put(
        f"/api/v1/comps/{comp['id']}/slots",
        json={"slots": [{"typeId": ABADDON, "isFlagship": False}]},
    )
    assert response.status_code == 200

    _, kind, fields = heard.only()
    assert kind == live.KIND_CHANGED
    assert str(fields["comp_id"]) == comp["id"]
    # Spelled the way the payload spells it, which is the comparison the client actually makes.
    # `isoformat` alone writes "+00:00" where pydantic writes "Z" — same instant, different
    # string, and a client comparing the two would treat every event as news.
    assert live._wire_time(fields["updated_at"]) == response.json()["updatedAt"]


def test_renaming_a_comp_announces_a_change(client, sign_in, monkeypatch):
    sign_in(OWNER, "Kadir")
    team = make_team(client)
    comp = make_comp(client, team)

    heard = listening(monkeypatch)
    assert client.patch(f"/api/v1/comps/{comp['id']}", json={"name": "Renamed"}).status_code == 200

    assert heard.only()[1] == live.KIND_CHANGED


def test_retagging_a_comp_announces_a_change_and_moves_its_timestamp(
    client, sign_in, monkeypatch
):
    """The half of this that was a bug before the stream existed.

    ``onupdate`` fires only when the comp row is itself in an UPDATE, and a tag write touches
    ``comp_tag``. With the archetype left alone SQLAlchemy emitted nothing for the comp at all,
    so re-tagging left ``updated_at`` standing still — which also made ``shareStale`` say a
    link was current when it was not.
    """
    sign_in(OWNER, "Kadir")
    team = make_team(client)
    comp = make_comp(client, team)
    before = comp["updatedAt"]

    heard = listening(monkeypatch)
    response = client.put(
        f"/api/v1/comps/{comp['id']}/tags",
        # Archetype unchanged — null on both sides — so only ``comp_tag`` rows are written.
        json={"archetype": None, "tags": ["kiter"]},
    )
    assert response.status_code == 200

    assert heard.only()[1] == live.KIND_CHANGED
    assert response.json()["updatedAt"] > before


def test_forking_announces_the_fork_and_says_nothing_about_the_parent(
    client, sign_in, monkeypatch
):
    """One event, for the comp that is new. The parent did not move."""
    sign_in(OWNER, "Kadir")
    team = make_team(client)
    comp = make_comp(client, team)
    client.put(
        f"/api/v1/comps/{comp['id']}/slots",
        json={"slots": [{"typeId": RIFTER, "isFlagship": False}]},
    )

    heard = listening(monkeypatch)
    response = client.post(f"/api/v1/comps/{comp['id']}/fork", json={"name": "A fork"})
    assert response.status_code == 201

    _, kind, fields = heard.only()
    assert kind == live.KIND_CREATED
    assert str(fields["comp_id"]) == response.json()["id"]
    assert str(fields["comp_id"]) != comp["id"]


def test_deleting_a_comp_announces_it_gone(client, sign_in, monkeypatch):
    sign_in(OWNER, "Kadir")
    team = make_team(client)
    comp = make_comp(client, team)

    heard = listening(monkeypatch)
    assert client.delete(f"/api/v1/comps/{comp['id']}").status_code == 204

    team_id, kind, fields = heard.only()
    assert kind == live.KIND_DELETED
    assert str(team_id) == team["id"]
    assert str(fields["comp_id"]) == comp["id"]


def test_a_comment_announces_a_change_to_the_comp_it_is_on(client, sign_in, monkeypatch):
    """The count is a field on the comp payload, so a thread moving is a comp changing."""
    sign_in(OWNER, "Kadir")
    team = make_team(client)
    comp = make_comp(client, team)

    heard = listening(monkeypatch)
    posted = client.post(f"/api/v1/comps/{comp['id']}/comments", json={"body": "Nice kite."})
    assert posted.status_code == 201
    comment_id = posted.json()["id"]

    client.patch(
        f"/api/v1/comps/{comp['id']}/comments/{comment_id}", json={"body": "Nicer kite."}
    )
    client.delete(f"/api/v1/comps/{comp['id']}/comments/{comment_id}")

    assert heard.kinds() == [live.KIND_CHANGED] * 3
    # No timestamp: a comment does not move the comp row, and sending the value a client
    # already holds would tell it there is nothing to do.
    assert all("updated_at" not in fields for _, _, fields in heard.events)


def test_sharing_a_comp_announces_a_change(client, sign_in, monkeypatch):
    """``shareSlug`` and ``shareStale`` are on the comp payload, so a tile redraws for these."""
    sign_in(OWNER, "Kadir")
    team = make_team(client)
    comp = make_comp(client, team)

    heard = listening(monkeypatch)
    assert client.post(f"/api/v1/comps/{comp['id']}/share").status_code == 201
    assert client.put(f"/api/v1/comps/{comp['id']}/share").status_code == 200
    assert client.delete(f"/api/v1/comps/{comp['id']}/share").status_code == 204

    assert heard.kinds() == [live.KIND_CHANGED] * 3


def test_an_event_carries_the_writing_tab_so_that_tab_can_ignore_it(client, sign_in, monkeypatch):
    """Otherwise every autosave comes back as an instruction to re-read your own work."""
    sign_in(OWNER, "Kadir")
    team = make_team(client)
    comp = make_comp(client, team)

    heard = listening(monkeypatch)
    client.patch(
        f"/api/v1/comps/{comp['id']}",
        json={"name": "Renamed"},
        headers={"x-comptool-client": "tab-one"},
    )

    assert heard.only()[2]["origin"] == "tab-one"


def test_a_write_with_no_tab_named_announces_without_one(client, sign_in, monkeypatch):
    """curl, a script, the e2e suite's API helper. Nobody's event gets filtered, which is fine."""
    sign_in(OWNER, "Kadir")
    team = make_team(client)
    comp = make_comp(client, team)

    heard = listening(monkeypatch)
    client.patch(f"/api/v1/comps/{comp['id']}", json={"name": "Renamed"})

    assert heard.only()[2]["origin"] is None


def test_a_refused_write_announces_nothing(client, sign_in, monkeypatch):
    """An event is a promise that a re-read will show the change.

    A viewer's refused write is the cheapest case to get wrong: the route raises before it
    commits, and a publish placed above the gate rather than below it would send every board
    on the team off to re-read a comp that never moved.
    """
    sign_in(OWNER, "Kadir")
    team = make_team(client)
    comp = make_comp(client, team)

    sign_in(STRANGER, "Nobody")
    heard = listening(monkeypatch)
    assert client.patch(f"/api/v1/comps/{comp['id']}", json={"name": "Mine now"}).status_code == 404

    assert heard.events == []


# --- The presence beat ---------------------------------------------------------------------


def test_a_presence_beat_updates_a_stream_that_is_already_open(client, sign_in):
    """It moves a record that exists rather than creating one, which is why it needs no gate.

    ``authorize`` is two queries. Ten people moving a highlight at 5 Hz would be a hundred
    queries a second of pure permission checking, forever, whether or not anybody edits
    anything. What makes skipping it safe is that this route creates nothing and can name
    nothing: the subscriber it updates exists because its holder opened a stream, and that
    stream was authorized when it opened and is re-authorized every minute after.
    """
    sign_in(OWNER, "Kadir")
    team = make_team(client)
    team_id = uuid.UUID(team["id"])
    board_id, comp_id = uuid.uuid4(), uuid.uuid4()

    async def beat_against_an_open_stream():
        async with live.subscribe(
            team_id, Viewer(character_id=OWNER, character_name="Kadir"), "tab-1"
        ) as sub:
            response = client.put(
                f"/api/v1/teams/{team['id']}/presence",
                json={"boardId": str(board_id), "compId": str(comp_id)},
                headers={"X-Comptool-Client": "tab-1"},
            )
            return response, sub.board_id, sub.comp_id

    response, seen_board, seen_comp = asyncio.run(beat_against_an_open_stream())

    assert response.status_code == 204
    assert seen_board == str(board_id)
    assert seen_comp == str(comp_id)


def test_a_beat_from_another_tab_moves_nobody_elses_highlight(client, sign_in):
    """Matched on the session's character *and* the tab, so one tab cannot move another's."""
    sign_in(OWNER, "Kadir")
    team = make_team(client)
    team_id = uuid.UUID(team["id"])

    async def beat_naming_the_wrong_tab():
        async with live.subscribe(
            team_id, Viewer(character_id=OWNER, character_name="Kadir"), "tab-1"
        ) as sub:
            client.put(
                f"/api/v1/teams/{team['id']}/presence",
                json={"boardId": str(uuid.uuid4())},
                headers={"X-Comptool-Client": "tab-2"},
            )
            return sub.board_id

    assert asyncio.run(beat_naming_the_wrong_tab()) is None


def test_a_beat_with_no_stream_open_says_nothing_about_the_team(client, sign_in):
    """204 either way, so the reply is not a probe.

    Whether a team is real, whether it is the caller's, and whether anybody is on it are all
    things this route must not answer — and it does not, because it does not look.
    """
    sign_in(OWNER, "Kadir")
    team = make_team(client)

    mine = client.put(f"/api/v1/teams/{team['id']}/presence", json={})
    invented = client.put(f"/api/v1/teams/{uuid.uuid4()}/presence", json={})

    assert mine.status_code == invented.status_code == 204


def test_a_presence_beat_needs_a_session(client):
    client.cookies.clear()
    assert client.put(f"/api/v1/teams/{uuid.uuid4()}/presence", json={}).status_code == 401


def test_a_roster_names_the_session_and_never_the_client_supplied_tab(client, sign_in):
    """A displayed name is a claim about a person, so it comes from the session.

    ``origin_client`` treats the sibling header as untrusted and that is enough for *its* job —
    claiming somebody else's id only costs you your own updates. A roster is different.
    """
    sign_in(OWNER, "Kadir")
    team_id = uuid.UUID(make_team(client)["id"])

    async def what_the_roster_says():
        async with live.subscribe(
            team_id,
            Viewer(character_id=OWNER, character_name="Kadir"),
            "Ayla the impostor",
        ):
            return live.roster(team_id)

    entries = asyncio.run(what_the_roster_says())

    assert entries[0]["characterName"] == "Kadir"
    assert entries[0]["characterId"] == OWNER
    # The client-supplied value survives only as a tab label.
    assert entries[0]["client"] == "Ayla the impostor"


# --- And that a shared board announces itself too ------------------------------------------


def make_board(client, team: dict, name: str = "Round one", *comp_ids: str) -> dict:
    response = client.post(
        f"/api/v1/teams/{team['id']}/boards", json={"name": name, "tiles": list(comp_ids)}
    )
    assert response.status_code == 201
    return response.json()


def test_creating_a_shared_board_announces_it(client, sign_in, monkeypatch):
    heard = listening(monkeypatch)
    sign_in(OWNER, "Kadir")
    team = make_team(client)

    board = make_board(client, team)

    team_id, kind, fields = heard.only()
    assert str(team_id) == team["id"]
    assert kind == live.KIND_BOARD_CREATED
    assert str(fields["board_id"]) == board["id"]
    assert fields["revision"] == board["revision"]
    assert fields["actor"] == "Kadir"


def test_adding_a_tile_announces_a_change(client, sign_in, monkeypatch):
    sign_in(OWNER, "Kadir")
    team = make_team(client)
    comp = make_comp(client, team)
    board = make_board(client, team)

    heard = listening(monkeypatch)
    response = client.post(f"/api/v1/boards/{board['id']}/tiles", json={"compId": comp["id"]})
    assert response.status_code == 200

    _, kind, fields = heard.only()
    assert kind == live.KIND_BOARD_CHANGED
    # The revision announced is the one the response carries, or a client would re-read to a
    # number older than the answer it already has and then ignore the answer.
    assert fields["revision"] == response.json()["revision"]


def test_moving_a_tile_announces_a_change(client, sign_in, monkeypatch):
    sign_in(OWNER, "Kadir")
    team = make_team(client)
    first = make_comp(client, team, "Alpha")
    second = make_comp(client, team, "Beta")
    board = make_board(client, team, "Round one", first["id"], second["id"])

    heard = listening(monkeypatch)
    response = client.patch(
        f"/api/v1/boards/{board['id']}/tiles/{second['id']}", json={"beforeCompId": first["id"]}
    )
    assert response.status_code == 200

    assert heard.only()[1] == live.KIND_BOARD_CHANGED


def test_removing_a_tile_announces_a_change(client, sign_in, monkeypatch):
    sign_in(OWNER, "Kadir")
    team = make_team(client)
    comp = make_comp(client, team)
    board = make_board(client, team, "Round one", comp["id"])

    heard = listening(monkeypatch)
    assert client.delete(f"/api/v1/boards/{board['id']}/tiles/{comp['id']}").status_code == 204

    assert heard.only()[1] == live.KIND_BOARD_CHANGED


def test_renaming_a_shared_board_announces_a_change(client, sign_in, monkeypatch):
    sign_in(OWNER, "Kadir")
    team = make_team(client)
    board = make_board(client, team)

    heard = listening(monkeypatch)
    renamed = client.patch(f"/api/v1/boards/{board['id']}", json={"name": "Round two"})
    assert renamed.status_code == 200

    assert heard.only()[1] == live.KIND_BOARD_CHANGED


def test_deleting_a_shared_board_announces_it_gone(client, sign_in, monkeypatch):
    sign_in(OWNER, "Kadir")
    team = make_team(client)
    board = make_board(client, team)

    heard = listening(monkeypatch)
    assert client.delete(f"/api/v1/boards/{board['id']}").status_code == 204

    _, kind, fields = heard.only()
    assert kind == live.KIND_BOARD_DELETED
    assert str(fields["board_id"]) == board["id"]


def test_a_board_op_that_changes_nothing_announces_nothing(client, sign_in, monkeypatch):
    """The same promise the comp routes make, and easier to break here.

    A drag that puts a tile back where it started is an ordinary gesture, and if it published,
    every other screen on the team would re-read the board for a change that did not happen.
    """
    sign_in(OWNER, "Kadir")
    team = make_team(client)
    first = make_comp(client, team, "Alpha")
    second = make_comp(client, team, "Beta")
    board = make_board(client, team, "Round one", first["id"], second["id"])

    heard = listening(monkeypatch)
    client.patch(f"/api/v1/boards/{board['id']}", json={"name": board["name"]})
    client.patch(
        f"/api/v1/boards/{board['id']}/tiles/{first['id']}", json={"beforeCompId": second["id"]}
    )
    client.post(f"/api/v1/boards/{board['id']}/tiles", json={"compId": first["id"]})
    client.post(f"/api/v1/boards/{board['id']}/tiles", json={"compId": str(uuid.uuid4())})
    client.delete(f"/api/v1/boards/{board['id']}/tiles/{uuid.uuid4()}")

    assert heard.events == []


def test_a_board_event_names_no_comp_and_a_comp_event_names_no_board(
    client, sign_in, monkeypatch
):
    """Two vocabularies on one wire, and a client keys a map on one of them.

    A board event carrying a ``compId``, or a comp event carrying a ``boardId``, would be read
    by the wrong handler — and the failure is silent, because a client keying a map on the field
    that is absent keys it on ``undefined`` rather than raising.
    """
    sign_in(OWNER, "Kadir")
    team = make_team(client)
    comp = make_comp(client, team)

    heard = listening(monkeypatch)
    make_board(client, team, "Round one", comp["id"])
    client.patch(f"/api/v1/comps/{comp['id']}", json={"name": "Renamed"})

    board_event = next(fields for _, kind, fields in heard.events if kind.startswith("board."))
    comp_event = next(fields for _, kind, fields in heard.events if kind.startswith("comp."))

    assert "comp_id" not in board_event
    assert "board_id" not in comp_event


def test_a_board_event_carries_the_writing_tab_so_that_tab_can_ignore_it(
    client, sign_in, monkeypatch
):
    """Same echo filter as a comp's, and load-bearing for a different reason.

    A tab that acted on its own board event would re-read a document it is already holding the
    authoritative answer for — the op's own response — and could adopt an older revision on the
    way past.
    """
    sign_in(OWNER, "Kadir")
    team = make_team(client)
    board = make_board(client, team)

    heard = listening(monkeypatch)
    client.patch(
        f"/api/v1/boards/{board['id']}",
        json={"name": "Round two"},
        headers={"X-Comptool-Client": "tab-7"},
    )

    assert heard.only()[2]["origin"] == "tab-7"
