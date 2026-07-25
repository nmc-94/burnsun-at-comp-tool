"""FastAPI application: API routes plus serving the built SPA from the same origin.

Route order matters. The API router registers first, so ``/api/*`` always resolves to
JSON. The SPA catch-all registers last and explicitly refuses ``/api/*`` (returning a
JSON 404 rather than the HTML shell), serves real files when they exist, and otherwise
returns ``index.html`` so client-side routes work.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from datetime import UTC, datetime

from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.dialects.postgresql import insert as pg_insert

from . import __version__
from .db import dispose_db, get_engine, init_db
from .health import router as health_router
from .logging_config import configure_logging
from .models import AppMeta
from .rulesets import router as rulesets_router
from .settings import Settings, get_settings

logger = logging.getLogger("comptool")

_settings = get_settings()
configure_logging(_settings.log_level)


def _write_boot_marker() -> None:
    """Upsert a boot row — proves write connectivity against the migrated schema."""
    now = datetime.now(tz=UTC)
    stmt = pg_insert(AppMeta).values(key="boot", value=now.isoformat(), updated_at=now)
    stmt = stmt.on_conflict_do_update(
        index_elements=["key"],
        set_={"value": now.isoformat(), "updated_at": now},
    )
    with get_engine().begin() as conn:
        conn.execute(stmt)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db(_settings)
    try:
        _write_boot_marker()
        logger.info("startup", extra={"event": "app_started", "environment": _settings.environment})
    except Exception:
        # Don't refuse to boot if the DB write fails — /health will report "degraded".
        logger.warning("boot_marker_failed", extra={"event": "boot_marker_failed"}, exc_info=True)
    yield
    dispose_db()


app = FastAPI(title="AT Comp Tool", version=__version__, lifespan=lifespan)
app.include_router(health_router)
app.include_router(rulesets_router)

# Hashed, immutable bundles. Mounted only when a build is present (backend-only dev/CI
# runs without a web/dist); the catch-all handles the index and other root files.
_assets_dir = _settings.spa_dir / "assets"
if _assets_dir.is_dir():
    app.mount("/assets", StaticFiles(directory=_assets_dir), name="assets")


@app.get("/{full_path:path}", include_in_schema=False)
def spa_fallback(full_path: str, settings: Settings = Depends(get_settings)) -> FileResponse:
    if full_path == "api" or full_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="Not found")
    dist = settings.spa_dir
    if full_path:
        candidate = (dist / full_path).resolve()
        # is_file() + parent check: serve a real asset, never escape the dist dir.
        if candidate.is_file() and dist.resolve() in candidate.parents:
            return FileResponse(candidate)
    index = dist / "index.html"
    if index.is_file():
        return FileResponse(index, headers={"Cache-Control": "no-cache"})
    raise HTTPException(status_code=404, detail="SPA not built")
