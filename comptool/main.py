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
from .auth.dev import router as dev_auth_router
from .auth.local import router as local_auth_router
from .auth.routes import router as auth_router
from .comments import router as comments_router
from .comps import router as comps_router
from .comps import team_router as team_comps_router
from .db import dispose_db, get_engine, init_db
from .health import router as health_router
from .join import router as join_router
from .live import router as live_router
from .logging_config import configure_logging
from .models import AppMeta
from .rulesets import router as rulesets_router
from .settings import Settings, get_settings
from .share import comp_router as share_comp_router
from .share import router as share_router
from .teams import router as teams_router
from .workspace import router as workspace_router

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


# There is deliberately no session eviction at boot any more. An earlier draft kept one: the
# access password lived in the environment, so changing it was a redeploy, and every session it
# had minted had to die at the next start or a rotation would not have removed anybody. Nothing
# here is a sign-in credential now — a team's password is a column its owner edits at runtime,
# and changing it must *not* evict, because membership is a team_grant row and the whole point
# of moving the credential was that rotating it stops new joins rather than throwing the team
# out. Removing one person is deleting their grant.


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db(_settings)
    if _settings.dev_auth_enabled:
        # Its own record at WARNING rather than a field on the startup line: WARNING goes to
        # stderr in this app, so this lands beside real problems instead of in the INFO
        # stream nobody reads. This process will hand a session to anyone who presents one
        # string, and that is worth one loud line per boot.
        logger.warning(
            "dev_auth_enabled",
            extra={"event": "dev_auth_enabled", "environment": _settings.environment},
        )
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
# Ruleset reads stay unauthenticated: they are published tournament data, and the SPA has
# to render them before anyone signs in. Only routes that touch a *team* need an identity,
# so authentication is attached per router and never to the /api/v1 prefix as a whole.
app.include_router(rulesets_router)
# The second unauthenticated router, and the first that serves *team* content: one comp,
# frozen at the moment it was shared, behind an unguessable name. Registered here rather than
# beside the comp routers so that the exception is visible in the list — the half of the same
# module that mints and withdraws a link is authenticated and registers below.
app.include_router(share_router)
app.include_router(auth_router)
# The development sign-in, registered unconditionally and guarded inside. Not conditionally:
# this module reads settings once at import, while the test suite overrides them afterwards
# through dependency_overrides — a router chosen at import time is a guard no test can reach,
# and an untested guard on a back door is worse than a tested one. Excluding it from the
# production image was considered and rejected for the same shape of reason: one artifact,
# configuration decides, or CI tests a build that is not the one deployed.
app.include_router(dev_auth_router)
# The other front door, for a deployment with no EVE application. Registered unconditionally
# and guarded inside, for the reason given just above: a router chosen at import time is a
# guard no test can reach, because the suite overrides settings through dependency_overrides
# long after this module has read them.
app.include_router(local_auth_router)
app.include_router(teams_router)
# Joining a team by link, plus the controls its owner uses to hand one out. Registered after
# teams because it hangs routes off /teams/{id} as well as its own /join prefix, and read
# beside share_router above: they are the app's two capability-link features and the one
# difference between them — that a join link is not on its own the authorization — is the
# thing most worth noticing when either changes.
app.include_router(join_router)
# Comps arrive as two routers because they are addressed two ways: nested under a team to
# list and create, and on their own id thereafter.
app.include_router(team_comps_router)
app.include_router(comps_router)
# A third comp-shaped router, nested one level further. Comments are what a team says about a
# comp rather than what the comp contains, which is why they are not in comps.py — but they
# are reached through the same gate, so a comment on an invisible comp is invisible too.
app.include_router(comments_router)
# Minting and withdrawing a share link: a team action on a comp, through the same gate as
# everything else. Its public counterpart is registered above, and they share a module so the
# two halves of one feature are read together.
app.include_router(share_comp_router)
# The workspace hangs off a team for the same reason the comp listing does — a board is a
# view onto one team's comps — but it belongs to the character rather than to the team,
# which is why it is in neither teams.py nor comps.py.
app.include_router(workspace_router)
# The one long-lived response in the application: a board's stream of "that comp moved".
# Registered beside the workspace because it serves the same screen — and last among the
# team routers because it is the only one that does not answer and return.
app.include_router(live_router)

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
