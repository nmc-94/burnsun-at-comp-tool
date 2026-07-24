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
        "build": build_payload(settings.environment),
    }
