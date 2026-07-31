"""The fan-out behind the event stream.

Three things are worth a test here and the rest is plumbing.

**The crossing between a worker thread and the event loop.** Every route in this application
is a synchronous ``def``, so ``publish`` runs on a threadpool thread while the queues belong
to the loop. ``asyncio.Queue`` is not thread-safe, and getting this wrong produces the kind of
failure that never shows up in a test that publishes from the loop it is testing — so the
test below publishes from a real thread on purpose.

**What a slow reader costs.** A subscriber that stops reading must not be able to stall a save
or grow without bound, and the recovery it is given has to be one that actually recovers.

**That an ended stream is forgotten.** Boards open and close all day; a registry that only
grew would be a leak proportional to how long the process has been up.
"""

from __future__ import annotations

import asyncio
import functools
import threading
import uuid

import pytest

from comptool import live
from comptool.permissions import Viewer


def asyncio_test(fn):
    """Run an async test body on a loop of its own.

    A decorator rather than a plugin. These are the first async tests in this suite and its
    only development dependencies are pytest and ruff; putting ``pytest-asyncio`` in
    everybody's install — and in CI's — for one file is a worse trade than three lines here.
    A fresh loop per test also happens to be exactly what these want, since what they are
    checking is which loop a queue belongs to.
    """

    @functools.wraps(fn)
    def run(*args, **kwargs):
        return asyncio.run(fn(*args, **kwargs))

    return run


@pytest.fixture(autouse=True)
def _no_leftover_subscribers():
    """Module state outlives a test, the way it does for every in-process store here."""
    live._subscribers.clear()
    yield
    live._subscribers.clear()


def _read(raw: str) -> tuple[str, str]:
    """An SSE frame split into its event name and its data, which is all these tests read."""
    event = next(line[len("event: ") :] for line in raw.splitlines() if line.startswith("event: "))
    data = next(line[len("data: ") :] for line in raw.splitlines() if line.startswith("data: "))
    return event, data


@asyncio_test
async def test_a_publish_from_another_thread_reaches_a_subscriber():
    """The crossing this whole design turns on.

    Published from a real thread rather than from the loop, because that is what a route does
    and because publishing from the loop would pass whether or not ``call_soon_threadsafe`` is
    involved — which is the entire thing being checked.
    """
    team_id, comp_id = uuid.uuid4(), uuid.uuid4()

    async with live.subscribe(team_id) as sub:
        queue = sub.queue
        thread = threading.Thread(
            target=live.publish,
            args=(team_id, live.KIND_CHANGED),
            kwargs={"comp_id": comp_id, "actor": "Bob"},
        )
        thread.start()
        thread.join()

        frame = await asyncio.wait_for(queue.get(), timeout=2)

    event, data = _read(frame)
    assert event == live.KIND_CHANGED
    assert str(comp_id) in data
    assert "Bob" in data


@asyncio_test
async def test_a_publish_reaches_every_subscriber_on_that_team_and_no_other():
    """Two boards on one team both hear it; a board on another team does not.

    The second half is not paranoia about noise. An event names a comp id, and a stream that
    carried other teams' ids would hand a caller the one thing ``access.py`` spends its whole
    design refusing to confirm.
    """
    mine, theirs = uuid.uuid4(), uuid.uuid4()
    comp_id = uuid.uuid4()

    async with live.subscribe(mine) as one, live.subscribe(mine) as two:
        first, second = one.queue, two.queue
        async with live.subscribe(theirs) as third:
            elsewhere = third.queue
            live.publish(mine, live.KIND_CHANGED, comp_id=comp_id)

            assert _read(await asyncio.wait_for(first.get(), 2))[0] == live.KIND_CHANGED
            assert _read(await asyncio.wait_for(second.get(), 2))[0] == live.KIND_CHANGED
            assert elsewhere.empty()


@asyncio_test
async def test_a_subscriber_that_stops_reading_is_told_to_resync_rather_than_blocking_anyone():
    """A full queue degrades to one ``resync``, and the publisher is never held up.

    The recovery has to be a *complete* one, which is why it is a resync and not the newest
    few frames: everything dropped here is subsumed by re-reading the listing, so a client
    that acts on this ends up in the same place as one that never fell behind.
    """
    team_id = uuid.uuid4()

    async with live.subscribe(team_id) as sub:
        queue = sub.queue
        for _ in range(live.QUEUE_LIMIT + 20):
            live.publish(team_id, live.KIND_CHANGED, comp_id=uuid.uuid4())

        # Nothing has been *delivered* yet. `publish` hands every frame over with
        # `call_soon_threadsafe`, and a callback scheduled that way runs when the loop next
        # gets a turn — which is exactly what makes the crossing safe, and exactly why a test
        # that publishes without yielding would find an empty queue and prove nothing.
        await asyncio.sleep(0)

        assert queue.qsize() <= live.QUEUE_LIMIT

        drained = []
        while not queue.empty():
            drained.append(_read(queue.get_nowait())[0])

    # The overflow left a resync behind, which is the frame that puts the client right.
    assert live.KIND_RESYNC in drained


@asyncio_test
async def test_a_board_publish_from_another_thread_reaches_a_subscriber():
    """The same crossing, for the other publisher.

    Its own test rather than a parametrization of the one above, because the thing being
    checked is that ``publish_board`` goes through ``_fan_out`` too — a second publisher that
    quietly grew its own loop would pass every test about comps and deliver nothing about
    boards.
    """
    team_id, board_id = uuid.uuid4(), uuid.uuid4()

    async with live.subscribe(team_id) as sub:
        queue = sub.queue
        thread = threading.Thread(
            target=live.publish_board,
            args=(team_id, live.KIND_BOARD_CHANGED),
            kwargs={"board_id": board_id, "revision": 7, "actor": "Ayla"},
        )
        thread.start()
        thread.join()

        frame = await asyncio.wait_for(queue.get(), timeout=2)

    event, data = _read(frame)
    assert event == live.KIND_BOARD_CHANGED
    assert str(board_id) in data
    assert '"revision":7' in data
    # No timestamp anywhere on a board frame: the revision is the ordering, which is what
    # keeps ``_wire_time`` out of this path entirely.
    assert "updatedAt" not in data


@asyncio_test
async def test_board_frames_and_comp_frames_share_one_overflow_budget():
    """One queue per subscriber, so a busy board can push comp events out of it.

    Worth pinning because the recovery has to cover both: everything discarded here is
    subsumed by a resync only if the client's answer to a resync re-reads boards as well as
    comps.
    """
    team_id = uuid.uuid4()

    async with live.subscribe(team_id) as sub:
        queue = sub.queue
        for _ in range((live.QUEUE_LIMIT // 2) + 10):
            live.publish(team_id, live.KIND_CHANGED, comp_id=uuid.uuid4())
            live.publish_board(
                team_id, live.KIND_BOARD_CHANGED, board_id=uuid.uuid4(), revision=1
            )
        await asyncio.sleep(0)

        assert queue.qsize() <= live.QUEUE_LIMIT

        drained = []
        while not queue.empty():
            drained.append(_read(queue.get_nowait())[0])

    assert live.KIND_RESYNC in drained


@asyncio_test
async def test_publishing_to_a_team_nobody_is_watching_does_nothing_and_costs_nothing():
    """The common case: one person editing alone. No subscribers, no frames, no error."""
    live.publish(uuid.uuid4(), live.KIND_CHANGED, comp_id=uuid.uuid4())
    live.publish_board(uuid.uuid4(), live.KIND_BOARD_CHANGED, board_id=uuid.uuid4(), revision=1)
    assert live._subscribers == {}


@asyncio_test
async def test_a_finished_stream_leaves_no_trace_in_the_registry():
    """Otherwise the table grows by one team for every board anyone has ever opened."""
    team_id = uuid.uuid4()

    async with live.subscribe(team_id):
        assert live.subscriber_count(team_id) == 1

    assert live.subscriber_count(team_id) == 0
    # The team's own entry goes with its last listener, not just the listener.
    assert team_id not in live._subscribers


@asyncio_test
async def test_one_board_closing_leaves_the_other_subscribed():
    team_id = uuid.uuid4()

    async with live.subscribe(team_id):
        async with live.subscribe(team_id):
            assert live.subscriber_count(team_id) == 2
        assert live.subscriber_count(team_id) == 1


@asyncio_test
async def test_the_stream_hangs_up_on_its_own_before_railway_cuts_it(monkeypatch):
    """Railway ends any request at about fifteen minutes; this ends its own first.

    The difference is what the browser sees. A stream the platform kills is truncated
    mid-frame; one that ends cleanly is reconnected from, and the client's first act on
    reconnecting is to re-read the listing. That is the whole reason a broken connection is
    allowed to be ordinary here, so a recycle that never fired would take the design's main
    assumption with it — and would do it silently, fifteen minutes into somebody's evening.
    """
    monkeypatch.setattr(live, "RECYCLE_SECONDS", 0.05)
    monkeypatch.setattr(live, "RECYCLE_JITTER_SECONDS", 0.0)
    monkeypatch.setattr(live, "HEARTBEAT_SECONDS", 0.01)

    frames = [frame async for frame in live._stream(uuid.uuid4(), Viewer(character_id=1))]

    # It ended by itself rather than being waited out by the test.
    assert frames
    # The preamble comes first and carries the reconnect delay, so the browser knows how long
    # to wait before coming back.
    assert frames[0].endswith(f"retry: {live.RETRY_MS}\n\n")
    # Then the roster, on connect rather than on the first beat: a board opening into a room
    # already full of people draws them without waiting for one of them to move.
    assert _read(frames[1])[0] == live.KIND_PRESENCE
    # Everything after that, in a silent stream, is the heartbeat that keeps a proxy from
    # deciding the connection is dead.
    assert set(frames[2:]) <= {live._KEEPALIVE}
    # And the subscriber it registered went with it.
    assert live._subscribers == {}


def test_the_preamble_pads_for_a_proxy_that_buffers():
    """Inert where it is not needed, and it is a comment, so no EventSource ever sees it.

    Cloudflare has been reported to hold a `text/event-stream` response until it has a
    buffer's worth, which turns a live stream into batches minutes late. 2 KB per connection
    per recycle is a cheap answer to a failure that only appears in production.
    """
    preamble = live._preamble()
    assert preamble.startswith(": ")
    assert len(preamble) > live.PROXY_PADDING_BYTES


def test_a_frame_is_one_event_and_one_line_of_data():
    """The wire format, pinned.

    A newline inside ``data`` would end the frame early and the rest would be read as a new
    one, so the compact JSON is not only about size.
    """
    frame = live._frame(live.KIND_CHANGED, {"compId": "abc", "actor": "Bob"})
    assert frame.endswith("\n\n")
    # The blank line ends the frame, so there is exactly one and it is at the end.
    assert frame.count("\n\n") == 1
    assert frame == 'event: comp.changed\ndata: {"compId":"abc","actor":"Bob"}\n\n'


@asyncio_test
async def test_the_roster_is_one_entry_per_open_stream():
    """Per stream rather than per person: two tabs are two places a highlight can be."""
    team_id = uuid.uuid4()
    kadir = Viewer(character_id=1, character_name="Kadir")

    async with live.subscribe(team_id, kadir, "tab-1"), live.subscribe(team_id, kadir, "tab-2"):
        async with live.subscribe(team_id, Viewer(character_id=2, character_name="Ayla"), "tab-3"):
            entries = live.roster(team_id)

    assert [entry["characterName"] for entry in entries] == ["Ayla", "Kadir", "Kadir"]
    assert {entry["client"] for entry in entries} == {"tab-1", "tab-2", "tab-3"}


@asyncio_test
async def test_a_roster_entry_lives_exactly_as_long_as_its_stream():
    """No table, no heartbeat write, and nothing to expire.

    §4.7 asks for ephemeral, and the arithmetic makes it binding: a heartbeat table would be
    the busiest write path in the application by a wide margin, to persist information whose
    useful life is one second.
    """
    team_id = uuid.uuid4()

    async with live.subscribe(team_id, Viewer(character_id=1, character_name="Kadir"), "tab-1"):
        assert len(live.roster(team_id)) == 1

    assert live.roster(team_id) == []


@asyncio_test
async def test_presence_replaces_rather_than_queues():
    """The coalescing lane, which is what keeps presence off the overflow path.

    Fan-out is per subscriber, so N actors × R beats × N subscribers is the term to design
    against: ten people at 5 Hz is 500 frames a second, which overflows a 64-frame queue in
    about 128 ms — and the punishment for overflow is a full team re-read per client. The
    cheapest thing on this wire must not be able to trigger the most expensive recovery.
    """
    team_id = uuid.uuid4()
    watcher = Viewer(character_id=1, character_name="Kadir")

    async with live.subscribe(team_id, watcher, "tab-1") as sub:
        # Drain the join notice, if the fixture left one.
        while not sub.queue.empty():
            sub.queue.get_nowait()

        for n in range(200):
            sub.board_id = f"board-{n}"
            live._announce_roster(team_id)

        # Two hundred beats, one notification. The queue can never fill from presence alone.
        assert sub.queue.qsize() == 1
        assert sub.queue.get_nowait() == live._ROSTER_SENTINEL
        # And what goes out is the roster as it stands *now*, not as it was when queued.
        assert '"board-199"' in sub.take_roster()


@asyncio_test
async def test_a_presence_beat_that_says_nothing_new_wakes_nobody():
    team_id = uuid.uuid4()

    async with live.subscribe(team_id, Viewer(character_id=1, character_name="Kadir")) as first:
        async with live.subscribe(team_id, Viewer(character_id=2, character_name="Ayla")) as sub:
            while not sub.queue.empty():
                sub.queue.get_nowait()
            first.board_id = "board-1"
            live._announce_roster(team_id)
            assert sub.queue.qsize() == 1


def test_an_origin_longer_than_an_id_is_not_relayed_whole():
    """It is echoed to other clients, so it is treated as text a stranger wrote."""

    class _Request:
        headers = {"x-comptool-client": "x" * 500}

    assert len(live.origin_client(_Request())) == 64
