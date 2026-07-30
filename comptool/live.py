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

**Fan-out is in-process, and that is a deployment claim with a shelf life.** One uvicorn
worker serves this app (``comptool/__main__.py`` passes no ``workers``), so a dict of
queues reaches everybody. ``ratelimit.py`` records the same caveat for the same reason and
it applies here in a sharper form: a second Railway replica would not fail loudly, it would
simply stop delivering half the events, and a board that updates *sometimes* is harder to
diagnose than one that never does. :func:`publish` and :func:`subscribe` are the seam that
change goes behind — Postgres ``LISTEN``/``NOTIFY`` fits underneath with no caller edits,
and psycopg is already a dependency. REQUIREMENTS §4.7 names it as the intended shape.
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

from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse

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
    """

    queue: asyncio.Queue[str]
    loop: asyncio.AbstractEventLoop

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
    frame = _frame(kind, payload)

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
async def subscribe(team_id: uuid.UUID) -> AsyncIterator[asyncio.Queue[str]]:
    """Register for this team's events for the duration of the block."""
    subscriber = _Subscriber(
        queue=asyncio.Queue(maxsize=QUEUE_LIMIT), loop=asyncio.get_running_loop()
    )
    _subscribers.setdefault(team_id, set()).add(subscriber)
    try:
        yield subscriber.queue
    finally:
        listeners = _subscribers.get(team_id)
        if listeners is not None:
            listeners.discard(subscriber)
            # Drop the team's entry with its last listener, so the table is the size of
            # what is connected rather than of every team anyone has ever opened.
            if not listeners:
                _subscribers.pop(team_id, None)


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


async def _stream(team_id: uuid.UUID, viewer: Viewer) -> AsyncIterator[str]:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + RECYCLE_SECONDS + random.uniform(0, RECYCLE_JITTER_SECONDS)
    checked_at = loop.time()

    async with subscribe(team_id) as queue:
        yield _preamble()
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
                    queue.get(), timeout=min(HEARTBEAT_SECONDS, deadline - now)
                )
            except TimeoutError:
                frame = _KEEPALIVE
            yield frame


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

    return StreamingResponse(
        _stream(team_id, viewer),
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
