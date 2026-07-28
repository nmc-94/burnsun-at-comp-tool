"""A fixed window per caller, in memory.

Extracted from ``share.py``, which wrote the first one and whose docstring still holds the
argument for it: in memory because this deployment is one service, and because a limiter that
needed a broker would make the simplest self-host harder for a threat this size. Multi-instance
carries the caveat §7 records for the realtime channel — this becomes per instance, and the
budget multiplies by however many there are.

There are three callers now: a share read, a name claim, and the lookup behind a join link.
Three copies of the same twenty lines is how they drift, and the one that drifts is the one
nobody re-reads.

**What this is not.** It is a speed bump against a stranger with a script, not an accounting
system and not an authorization control. Whether a request is *allowed* is decided elsewhere,
every time; a caller who waits out the window is back to whatever the real check says. It also
forgets wholesale under pressure, which is a safer failure than exhausting memory — see
``MAX_TRACKED_KEYS``.

The counterpart to this is in ``comptool/join.py``: a *failure* count, in the database, because
guesses at a password have to survive a restart and be shared between workers. Rate and failure
are different questions and are answered by different machinery on purpose.
"""

from __future__ import annotations

import time

from fastapi import HTTPException, Request

#: A ceiling on the table a limiter keeps, so a spray of forged client addresses cannot grow it
#: without bound. Past this the window is cleared wholesale.
MAX_TRACKED_KEYS = 10_000


def caller_of(request: Request) -> str:
    """Who to count against.

    The socket address, and deliberately **not** ``X-Forwarded-For``: that header is
    caller-controlled, so honouring it would let anybody mint themselves an unlimited number
    of buckets and walk straight past the limit. Behind a proxy this does mean one bucket for
    everybody, which is the safe direction to be wrong in for a speed bump — and the reason
    every budget here is generous enough that a real person never meets it.
    """
    return request.client.host if request.client else "unknown"


class FixedWindow:
    """One budget, counted per key over a rolling-restart window.

    Instantiated per use rather than shared, so a share read and a name claim cannot spend one
    another's allowance — they are different actions with different costs and different limits.
    """

    def __init__(self, *, limit: int, window_seconds: int, detail: str) -> None:
        self._limit = limit
        self._window = window_seconds
        self._detail = detail
        self._hits: dict[str, tuple[float, int]] = {}

    def check(self, key: str) -> None:
        """Count one, or raise 429 with an honest ``Retry-After``."""
        now = time.monotonic()

        if len(self._hits) > MAX_TRACKED_KEYS:
            self._hits.clear()

        started, count = self._hits.get(key, (now, 0))
        if now - started >= self._window:
            started, count = now, 0
        if count >= self._limit:
            raise HTTPException(
                status_code=429,
                detail=self._detail,
                # What is left of the window, not the whole of it: the caller has already
                # waited out part of it, and telling them otherwise is telling them to wait
                # twice.
                headers={"Retry-After": str(max(1, int(self._window - (now - started))))},
            )
        self._hits[key] = (started, count + 1)

    def reset(self) -> None:
        """Tests only. Module state outlives a test, and tests share one client host."""
        self._hits.clear()
