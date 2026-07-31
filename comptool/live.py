"""Telling a board that one of its comps moved.

Two people on one team keep the same comps on their own private boards. Until now the only
way a change crossed between them was a page reload, because nothing on the client ever
re-read a comp it had already loaded. This is the missing half: a stream a board subscribes
to, and a ``publish`` call at every write that changes what a comp says.

Both halves live here, the way ``share.py`` keeps minting and reading a link together — a
broadcast nobody listens for and a listener nobody broadcasts to are the same bug, and it is
found by reading one file rather than two.

**What crosses the wire is an invalidation, not a state delta.** An event names a comp and
when it changed; the client re-reads it through the routes it already uses. That choice is
forced by the deployment rather than chosen for elegance: Railway caps any request at about
fifteen minutes and Cloudflare cuts a stream that has been silent for a hundred seconds, so
this connection is *guaranteed* to break and reform. Deltas would need a replay buffer and
an answer for what a client missed while it was away. Invalidations need neither — a
reconnect re-reads, and a break stops being a correctness question. It is also why the
client resyncs on every open rather than only on the first.

**Fan-out is in-process, so one worker is a correctness requirement rather than a scaling
preference.** A dict of queues reaches everybody in this process and nobody outside it.
``ratelimit.py`` records the same caveat for the same reason and it applies here in a
sharper form: a second replica would not fail loudly, it would simply stop delivering half
the events, and a board that updates *sometimes* is harder to diagnose than one that never
does. With presence it is worse in kind — a roster showing two of the three people actually
present is read as a fact about who is online, and nobody debugs a fact.

An earlier version of this paragraph said one worker runs because ``comptool/__main__.py``
passes no ``workers``, which is the reason backwards. ``uvicorn.Config.__init__`` does
``self.workers = workers or 1`` and *then* ``if workers is None and "WEB_CONCURRENCY" in
os.environ``, so passing none is precisely what lets that variable win — one environment
variable, standard advice for every FastAPI deployment and set by default on some platforms,
forking the app with no log line. Hence ``__main__.py`` now passes ``workers=1`` explicitly
and ``settings.py`` refuses to boot when ``WEB_CONCURRENCY`` asks for more; ``/api/health``
reports a per-process ``instance`` so a second process is *detectable* rather than merely
forbidden.

:func:`publish` and :func:`subscribe` are the seam that change goes behind — Postgres
``LISTEN``/``NOTIFY`` fits underneath with no caller edits, and psycopg is already a
dependency. REQUIREMENTS §4.7 names it as the intended shape.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import random
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import datetime

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

from .access import authorize, team_not_found
from .auth import sessions
from .db import session_scope
from .models import AccessLevel
from .permissions import Viewer

logger = logging.getLogger("comptool")

router = APIRouter(prefix="/api/v1/teams", tags=["live"])


#: How long a silent stream may stay silent. Under Cloudflare's ~100s cut for a proxied
#: response that has produced nothing, and far under Railway's five-minute idle close.
HEARTBEAT_SECONDS = 20.0

#: How often an open stream re-asks whether its holder may still read this team. A grant
#: revoked mid-stream otherwise keeps being served, and ``access.py`` is not written to be
#: true only at the moment you connect. Cheap: one query a minute per open board.
REAUTH_SECONDS = 60.0

#: When to hang up on ourselves. Railway ends any request at about fifteen minutes; ending
#: it first means the browser sees a clean close and reconnects, rather than a stream
#: truncated mid-frame. Jittered so a deploy's worth of clients do not all come back in the
#: same second.
RECYCLE_SECONDS = 600.0
RECYCLE_JITTER_SECONDS = 60.0

#: How long the browser waits before reconnecting, in the stream's own preamble.
RETRY_MS = 3000

#: Bytes of comment padding sent before anything else.
#:
#: Some proxies — Cloudflare among them, intermittently and by report rather than by
#: documentation — hold a response until they have a buffer's worth, which turns a live
#: stream into batches that arrive minutes late. A comment line is ignored by every
#: EventSource, so this is inert everywhere it is not needed, and it costs one 2 KB write
#: per connection per ten minutes. Set to 0 if the proxy in front is known not to buffer.
PROXY_PADDING_BYTES = 2048

#: How many frames may queue for one subscriber before it is declared behind. Small on
#: purpose: the recovery is one extra read, so there is nothing to gain by remembering more.
QUEUE_LIMIT = 64

KIND_CREATED = "comp.created"
KIND_CHANGED = "comp.changed"
KIND_DELETED = "comp.deleted"
KIND_RESYNC = "resync"

#: A shared board gained, lost or rearranged something.
#:
#: One ``changed`` kind covers a rename, a mode switch, and a tile added, removed or moved,
#: because every one of them is recovered by re-reading the same route. A finer split would
#: be a delta hint the client cannot act on differently, and the first time one was wrong the
#: board would diverge with nothing to correct it.
KIND_BOARD_CREATED = "board.created"
KIND_BOARD_CHANGED = "board.changed"
KIND_BOARD_DELETED = "board.deleted"

#: Who is on this team's boards right now, and which tile each is touching.
#:
#: The whole roster every time rather than a join/leave delta, for the same reason every other
#: frame here is an invalidation: this connection is guaranteed to break and reform, and a delta
#: model would need a replay buffer and an answer for what a client missed.
KIND_PRESENCE = "presence"

#: A place-holder that means "read your roster slot", never delivered as itself.
#:
#: The lane is the point. A presence beat replaces a subscriber's pending roster instead of
#: queueing beside it, so ten people moving a highlight cannot fill a 64-frame queue and turn
#: the cheapest thing on this wire into a full team re-read.
_ROSTER_SENTINEL = "\x00roster"

_KEEPALIVE = ": keepalive\n\n"
_RESYNC_FRAME = f"event: {KIND_RESYNC}\ndata: {{}}\n\n"


def _wire_time(value: datetime) -> str:
    """A timestamp spelled the way the comp payload spells it.

    Pydantic renders a UTC datetime with a trailing ``Z``; ``datetime.isoformat`` writes
    ``+00:00``. Same instant, different strings — and the client's "do I already have this
    version?" test is a string comparison against the ``updatedAt`` it got from
    ``GET /comps/{id}``. Left unmatched, every event would look like news about a version
    already on screen, and every board would re-read every comp on every keystroke anybody
    made. Cheap to get wrong, invisible once it is, and expensive in exactly the way this
    design exists to avoid.
    """
    text = value.isoformat()
    return f"{text[:-6]}Z" if text.endswith("+00:00") else text


def _frame(kind: str, payload: dict[str, object]) -> str:
    # ``separators`` so a frame carries no whitespace nobody reads. One line of data: no
    # value here contains a newline, which is the only thing that would need more.
    body = json.dumps(payload, separators=(",", ":"))
    return f"event: {kind}\ndata: {body}\n\n"


@dataclass(eq=False)
class _Subscriber:
    """One open stream, and the loop that owns its queue.

    ``eq=False`` so instances hash by identity: two boards on one team are two subscribers
    and neither may stand in for the other.

    It also *is* the presence record. A roster entry's life is a stream's life — there is no
    table, no heartbeat write and nothing to expire, because the thing that would be expiring
    is a connection the operating system already tracks. §4.7 asks for that, and the arithmetic
    makes it binding rather than aspirational: a heartbeat table would become the busiest write
    path in the application by a wide margin, with row churn and vacuum pressure, to persist
    information whose useful life is one second.
    """

    queue: asyncio.Queue[str]
    loop: asyncio.AbstractEventLoop
    #: Who this is, **taken from the session and never from the client.** A displayed name is a
    #: claim about a person; ``client`` below may label a tab and nothing more.
    character_id: int = 0
    character_name: str = ""
    #: Which tab, so two tabs of one person are two entries. Client-supplied, bounded, untrusted.
    client: str | None = None
    #: Where this person is looking, as they last said. Replaced, never accumulated.
    board_id: str | None = None
    comp_id: str | None = None
    #: The roster as it stands, waiting to go out — the coalescing lane.
    #:
    #: Presence is the one thing on this wire where dropping is *correct*, because the next beat
    #: supersedes it. Fan-out is per subscriber, so N actors × R beats × N subscribers is the
    #: term to design against: three people at 5 Hz is 45 frames a second and ten people is 500,
    #: which overflows a 64-frame queue in about 128 ms — and the punishment for overflow is a
    #: full team re-read per client. The cheapest, most disposable thing on the wire would
    #: otherwise trigger the most expensive recovery in the system.
    roster: str | None = None
    #: Whether a notification for that slot is already in the queue. One at a time, ever, which
    #: is what makes this a lane that replaces rather than a stream that appends.
    roster_queued: bool = False

    def offer_roster(self, frame: str) -> None:
        """Replace this subscriber's pending roster rather than queueing another."""
        self.roster = frame
        if self.roster_queued:
            return
        self.roster_queued = True
        self.offer(_ROSTER_SENTINEL)

    def take_roster(self) -> str:
        """The newest roster, and the lane is empty again."""
        self.roster_queued = False
        return self.roster or _frame(KIND_PRESENCE, {"actors": []})

    def offer(self, frame: str) -> None:
        """Take a frame, or fall back to asking for a resync. Runs on ``loop``'s thread.

        A full queue means this client is not reading fast enough — a suspended laptop, a
        stalled proxy. Dropping what has piled up and leaving a single ``resync`` in its
        place is both smaller and *more* correct than keeping the backlog: the client's
        answer to a resync is to re-read everything, which subsumes every frame discarded
        here. The alternatives are worse in kind rather than degree — blocking would stall
        somebody else's save, and growing would be a leak with no ceiling.
        """
        if self.queue.full():
            while not self.queue.empty():
                self.queue.get_nowait()
            self.queue.put_nowait(_RESYNC_FRAME)
            return
        self.queue.put_nowait(frame)


#: Open streams, per team. Only ever mutated from the event loop thread.
_subscribers: dict[uuid.UUID, set[_Subscriber]] = {}


def publish(
    team_id: uuid.UUID,
    kind: str,
    *,
    comp_id: uuid.UUID,
    actor: str | None = None,
    origin: str | None = None,
    updated_at: datetime | None = None,
) -> None:
    """Tell this team's open boards that a comp moved.

    **Called from a worker thread.** Every route in this application is a synchronous
    ``def``, so it runs in AnyIO's threadpool, while the queues below belong to the event
    loop — and ``asyncio.Queue`` is not thread-safe. ``call_soon_threadsafe`` is the whole
    of the crossing, and skipping it buys corruption that only appears under concurrency.

    Never raises. A save that succeeded must not be reported as failed because nobody could
    be told about it; the client's own response already carries the change, and any peer
    that misses this recovers on its next reconnect.
    """
    listeners = _subscribers.get(team_id)
    if not listeners:
        return

    payload: dict[str, object] = {"compId": str(comp_id)}
    if updated_at is not None:
        payload["updatedAt"] = _wire_time(updated_at)
    if actor:
        payload["actor"] = actor
    if origin:
        # Echoed back so the tab that made the change can ignore its own event rather than
        # re-reading work it is holding. Matched on the tab and not the character, so a
        # second tab of your own still updates.
        payload["origin"] = origin

    _fan_out(listeners, _frame(kind, payload))


def publish_board(
    team_id: uuid.UUID,
    kind: str,
    *,
    board_id: uuid.UUID,
    revision: int,
    actor: str | None = None,
    origin: str | None = None,
) -> None:
    """Tell this team's open boards that a *shared board* moved.

    Beside :func:`publish` rather than sharing its signature, so ``comp_id`` can stay
    required there: forgetting it becomes a ``TypeError`` at the call site instead of an
    event nobody can act on. For the same reason a board event carries **no** ``compId`` and
    a comp event carries no ``boardId`` — a client keying a map on the wrong one would key it
    on ``undefined`` and fail quietly, so the separation is asserted by a test.

    The version is an **integer revision, not a timestamp**. The client compares it to decide
    whether an arriving document is newer than the one on screen, and two ops inside one
    clock tick have to be distinguishable — which is also why ``_wire_time`` is not involved
    here at all.

    Called from a worker thread, and never raises; see :func:`publish` for both.
    """
    listeners = _subscribers.get(team_id)
    # Repeated rather than folded into ``_fan_out`` so the common case — nobody watching —
    # costs one dict lookup and builds no payload, which a test in ``test_live_broker.py``
    # asserts directly.
    if not listeners:
        return

    payload: dict[str, object] = {"boardId": str(board_id), "revision": revision}
    if actor:
        payload["actor"] = actor
    if origin:
        payload["origin"] = origin

    _fan_out(listeners, _frame(kind, payload))


def _fan_out(listeners: set[_Subscriber], frame: str) -> None:
    """Hand one frame to every open stream on a team. Runs on a worker thread."""
    for subscriber in list(listeners):
        try:
            subscriber.loop.call_soon_threadsafe(subscriber.offer, frame)
        except RuntimeError:
            # The loop is closing. The stream on the other end is going away with it and
            # will deregister itself; there is nothing to do and nothing worth logging.
            continue


def origin_client(request: Request) -> str | None:
    """Which tab is making this write, if it said.

    A dependency rather than a ``Request`` parameter on nine routes, so the write sites gain
    one argument each instead of reaching into the request themselves. Absent for any caller
    that is not the SPA — curl, a test, a script — and absence simply means nobody's event
    gets filtered, which is the harmless direction.
    """
    value = request.headers.get("x-comptool-client")
    if not value:
        return None
    # Bounded and echoed to other clients, so it is treated as untrusted text: an id longer
    # than a uuid is not one, and there is no reason to relay it.
    return value[:64]


@contextlib.asynccontextmanager
async def subscribe(
    team_id: uuid.UUID, viewer: Viewer | None = None, client: str | None = None
) -> AsyncIterator[_Subscriber]:
    """Register for this team's events for the duration of the block.

    Yields the subscriber rather than its queue, because the stream now reads two things off
    it: the queue, and the roster slot the coalescing lane fills. ``viewer`` and ``client``
    default to nothing so the broker tests can still open a bare subscription, which is all
    they are about.
    """
    subscriber = _Subscriber(
        queue=asyncio.Queue(maxsize=QUEUE_LIMIT),
        loop=asyncio.get_running_loop(),
        character_id=viewer.character_id if viewer else 0,
        character_name=viewer.character_name if viewer else "",
        client=client,
    )
    _subscribers.setdefault(team_id, set()).add(subscriber)
    if viewer is not None:
        _announce_roster(team_id, except_for=subscriber)
    try:
        yield subscriber
    finally:
        listeners = _subscribers.get(team_id)
        if listeners is not None:
            listeners.discard(subscriber)
            # Drop the team's entry with its last listener, so the table is the size of
            # what is connected rather than of every team anyone has ever opened.
            if not listeners:
                _subscribers.pop(team_id, None)
            elif viewer is not None:
                # Somebody left. Everybody still here finds out within a frame, which is what
                # makes "closing a tab removes that entry" true without a timer.
                _announce_roster(team_id)


def roster(team_id: uuid.UUID) -> list[dict[str, object]]:
    """Who is on this team's boards, one entry per open stream.

    Per stream rather than per person, deliberately: two tabs of one character are two entries,
    because they are two places a highlight can be. Sorted so the frame is stable — an
    unordered roster would look like a change every time a set was iterated.
    """
    entries = [
        {
            "characterId": subscriber.character_id,
            "characterName": subscriber.character_name,
            "client": subscriber.client,
            "boardId": subscriber.board_id,
            "compId": subscriber.comp_id,
        }
        for subscriber in _subscribers.get(team_id, ())
        # A subscriber with no identity is a broker test's, not a person's.
        if subscriber.character_id
    ]
    entries.sort(key=lambda entry: (entry["characterName"] or "", entry["client"] or ""))
    return entries


def _announce_roster(team_id: uuid.UUID, except_for: _Subscriber | None = None) -> None:
    """Hand every open stream on this team the roster as it now stands.

    Down the coalescing lane, so a beat replaces a pending frame rather than queueing beside
    it. Runs on the event loop thread — every caller is already there, which is why this does
    no ``call_soon_threadsafe`` of its own.

    ``except_for`` is the joiner, who is about to be handed the same roster as its connect
    frame. Without it a stream would open with two identical rosters, one of them arriving as
    news about itself.
    """
    listeners = _subscribers.get(team_id)
    if not listeners:
        return
    frame = _frame(KIND_PRESENCE, {"actors": roster(team_id)})
    for subscriber in list(listeners):
        if subscriber is except_for:
            continue
        subscriber.offer_roster(frame)


def subscriber_count(team_id: uuid.UUID) -> int:
    """How many streams are open on this team. Tests, and nothing else, read this."""
    return len(_subscribers.get(team_id, ()))


def _viewer_for(token: str | None) -> Viewer | None:
    """The identity a cookie names, in a session of our own that closes before we stream.

    Deliberately does not renew the session the way ``optional_session`` does. A stream is a
    read that happens to be long, and letting one hold a session open indefinitely would
    mean a tab left on a board never expires while the same tab left on any other screen
    does — a difference in how long you stay signed in, decided by which page you walked
    away from. Not renewing keeps that exactly as it is today.
    """
    if not token:
        return None
    with session_scope() as session:
        record = sessions.load(session, token)
        if record is None:
            return None
        return Viewer(character_id=record.character_id, character_name=record.character_name)


def _authorized(team_id: uuid.UUID, viewer: Viewer) -> bool:
    with session_scope() as session:
        try:
            authorize(session, team_id, viewer, AccessLevel.VIEWER)
        except Exception:
            return False
        return True


def _preamble() -> str:
    padding = f": {'-' * PROXY_PADDING_BYTES}\n\n" if PROXY_PADDING_BYTES > 0 else ""
    return f"{padding}retry: {RETRY_MS}\n\n"


async def _stream(
    team_id: uuid.UUID, viewer: Viewer, client: str | None = None
) -> AsyncIterator[str]:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + RECYCLE_SECONDS + random.uniform(0, RECYCLE_JITTER_SECONDS)
    checked_at = loop.time()

    async with subscribe(team_id, viewer, client) as subscriber:
        yield _preamble()
        # The roster on connect, so a board that opens into a room already full of people draws
        # them without waiting for one of them to move.
        yield _frame(KIND_PRESENCE, {"actors": roster(team_id)})
        while True:
            now = loop.time()
            if now >= deadline:
                # A clean end. ``retry`` in the preamble is what brings the browser back,
                # and its first act on reconnecting is a full re-read.
                return
            if now - checked_at >= REAUTH_SECONDS:
                if not await run_in_threadpool(_authorized, team_id, viewer):
                    return
                checked_at = now
            try:
                frame = await asyncio.wait_for(
                    subscriber.queue.get(), timeout=min(HEARTBEAT_SECONDS, deadline - now)
                )
            except TimeoutError:
                frame = _KEEPALIVE
            # The sentinel is a wake-up, never a payload: what goes out is the roster as it
            # stands *now*, which may have moved several times since this was queued.
            if frame == _ROSTER_SENTINEL:
                frame = subscriber.take_roster()
            yield frame


class PresenceBeat(BaseModel):
    """Where the caller is looking. Both null means "on the team, on no board in particular"."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    board_id: uuid.UUID | None = None
    comp_id: uuid.UUID | None = None


@router.put("/{team_id}/presence", status_code=204, include_in_schema=False)
async def report_presence(
    team_id: uuid.UUID, body: PresenceBeat, request: Request
) -> Response:
    """Say which board and tile this tab is on.

    **This does not re-run ``authorize``, and that is a design constraint rather than an
    optimization.** ``authorize`` is two queries. Ten people moving a highlight at 5 Hz is fifty
    calls a second, so authorizing each would be a hundred queries a second of pure permission
    checking, forever, whether or not anybody edits anything — an order of magnitude more
    traffic than the actual product, whose busiest write is one save per 600 ms per editor.

    What makes that safe is that there is nothing here to authorize. This route creates nothing,
    reads nothing and can name nothing: it updates a record that **already exists** because its
    holder opened a stream, and that stream was authorized when it opened and is re-authorized
    every minute while it stays open. A caller with no open stream on this team updates nothing
    and is told 204, exactly as one with an open stream is — the reply says nothing about
    whether the team is real, whether it is theirs, or whether anybody is on it.

    Matched on the session's character *and* the tab's own ``client``, so a tab cannot move
    somebody else's highlight even inside a team it belongs to.

    ``async def``, so a beat costs no threadpool thread — the whole point of the arithmetic
    above. It touches nothing but the in-process table.
    """
    token = request.cookies.get(sessions.COOKIE_NAME)
    viewer = await run_in_threadpool(_viewer_for, token)
    if viewer is None:
        raise HTTPException(status_code=401, detail="Not signed in")

    client = (request.headers.get("x-comptool-client") or "")[:64] or None
    moved = False
    board_id = str(body.board_id) if body.board_id else None
    comp_id = str(body.comp_id) if body.comp_id else None
    for subscriber in _subscribers.get(team_id, ()):
        if subscriber.character_id != viewer.character_id or subscriber.client != client:
            continue
        if subscriber.board_id == board_id and subscriber.comp_id == comp_id:
            continue
        subscriber.board_id = board_id
        subscriber.comp_id = comp_id
        moved = True

    # A beat that says what the last one said tells nobody. Presence is a stream of repeats by
    # nature — a tab reports on a timer — so this is the branch that keeps a still room silent.
    if moved:
        _announce_roster(team_id)
    return Response(status_code=204)


@router.get("/{team_id}/events", include_in_schema=False)
async def team_events(team_id: uuid.UUID, request: Request) -> StreamingResponse:
    """Changes to this team's comps, as they happen.

    ``async def``, and the first in this application — every other handler is a synchronous
    ``def`` that FastAPI dispatches to AnyIO's threadpool. That threadpool has forty threads.
    A synchronous generator here would hold one of them for as long as somebody keeps a
    board open, and the fortieth listener would stop the entire API rather than merely
    failing to stream.

    It also asks for no session dependency, directly or through ``current_viewer`` — see
    ``db.session_scope`` for what that would cost. Identity and permission are resolved in
    the threadpool, in sessions that close before the first byte is written.

    Refusals are the same 404 every other team route gives, for the same reason: a channel
    that distinguished "no such team" from "not yours" would be the existence probe the
    whole of ``access.py`` is written to deny. Being signed out is a 401 here as elsewhere —
    that one is not a secret, and the SPA has to tell it apart from being gone.
    """
    token = request.cookies.get(sessions.COOKIE_NAME)
    viewer = await run_in_threadpool(_viewer_for, token)
    if viewer is None:
        # Matches ``current_session``: hiding a resource is one thing, but "am I signed in"
        # is answerable, and EventSource needs to fail rather than retry forever on a 404.
        raise HTTPException(status_code=401, detail="Not signed in")
    if not await run_in_threadpool(_authorized, team_id, viewer):
        raise team_not_found(team_id)

    # ``?client=`` has been on this URL since the stream shipped and nothing read it. This is
    # what it was for: a per-connection label, so two tabs of one person are two entries in the
    # roster. It labels a *tab* and is never an identity — the name in a roster comes from the
    # session, because a displayed name is a claim about a person. Bounded like the sibling
    # header for the same reason: it is text a stranger wrote and it is echoed to other clients.
    client = (request.query_params.get("client") or "")[:64] or None

    return StreamingResponse(
        _stream(team_id, viewer, client),
        media_type="text/event-stream",
        headers={
            # ``no-transform`` is the one that matters beyond the obvious: it asks an
            # intermediary not to recompress or repackage the body, which is how a proxy
            # turns a stream into batches. ``X-Accel-Buffering`` says the same thing to the
            # nginx-shaped half of the world.
            "Cache-Control": "no-cache, no-store, no-transform",
            "X-Accel-Buffering": "no",
        },
    )
