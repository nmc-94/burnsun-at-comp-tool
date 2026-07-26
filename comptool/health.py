"""Health endpoint.

Version-independent ops probe (lives at ``/api/health``, not under ``/api/v1``). It
does a real read against a migrated table so a green result means "app booted,
database reachable, and migrations applied", not merely "process is up".
"""

from __future__ import annotations

import time

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from .build_meta import build_payload
from .db import get_session
from .models import AppMeta
from .settings import Settings, get_settings

router = APIRouter(prefix="/api", tags=["system"])


@router.get("/health")
def health(
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    db_ok = True
    started = time.perf_counter()
    try:
        session.execute(select(AppMeta).limit(1)).first()
    except Exception:
        db_ok = False
    latency_ms = round((time.perf_counter() - started) * 1000, 2)
    return {
        "status": "ok" if db_ok else "degraded",
        "db": {"ok": db_ok, "latency_ms": latency_ms},
        # Reported because an operator, a smoke test or a reviewer should be able to ask a
        # running instance whether it has a back door open without reading environment
        # variables on a box they may not have. That this route is unauthenticated is not the
        # leak it looks like: the secret is the secret, not the fact that one exists, and the
        # only deployments that could disclose anything are the ones the settings validator
        # will not let boot with it on. Always present rather than present-when-true, so a
        # probe can assert on a fixed shape and a `false` on every production instance is
        # itself the reassurance. Top level rather than inside `build`, which is build
        # metadata while this is runtime configuration.
        "dev_auth": settings.dev_auth_enabled,
        # The other back door, reported for the same reason and on the same terms: an
        # instance answering true is resolving character names from its own sign-in history
        # rather than from EVE, which is worth being able to ask about without shell access.
        "dev_resolve": settings.dev_resolve_enabled,
        "build": build_payload(settings.environment),
    }
