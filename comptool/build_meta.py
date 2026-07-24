"""Build/version metadata for the health endpoint.

Reads brand-neutral env vars first, falling back to the platform's git vars, so the
running image can report which commit it was built from.
"""

from __future__ import annotations

import os
from datetime import UTC, datetime

_STARTED_AT = datetime.now(tz=UTC).isoformat()


def build_payload(environment: str) -> dict:
    commit = os.environ.get("GIT_COMMIT_SHA") or os.environ.get("RAILWAY_GIT_COMMIT_SHA") or ""
    branch = os.environ.get("GIT_BRANCH") or os.environ.get("RAILWAY_GIT_BRANCH") or ""
    return {
        "service": "api",
        "build_id": commit or "local",
        "git_commit_sha": commit,
        "git_branch": branch,
        "started_at": _STARTED_AT,
        "deploy_env": environment,
    }
