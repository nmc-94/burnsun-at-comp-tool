"""The ruleset that ships with the application.

The tournament's rules are codified, so an operator should not have to feed them in to get
a working deployment: the built payload is committed under ``comptool/data/`` and seeded
into the database at deploy time, beside the migrations.

What is bundled is the ingester's *output*, not its input. The snapshots under ``docs/``
remain the source of truth and the ingester remains the tool that reads them — the file
here is regenerated with ``emit-payload`` and pinned by a test against exactly that, so it
cannot quietly drift from what the sources say.

Seeding is idempotent on (slug, label), so it is safe to run on every container start.
"""

from __future__ import annotations

import json
from importlib.resources import files

from sqlalchemy.orm import Session

from ..models import RulesetVersion
from . import atxxii
from .store import VersionAlreadyImported, store_version

#: Inside the installed package, so it is present in the image — ``docs/`` is not.
DATA_DIR = "data"


def payloads() -> list[dict]:
    """Every bundled payload, oldest label first.

    A directory rather than one fixed file: publishing a new capture is then a matter of
    committing another payload beside this one, with no code change.
    """
    directory = files("comptool").joinpath(DATA_DIR)
    found = [entry for entry in directory.iterdir() if entry.name.endswith(".json")]
    return [
        json.loads(entry.read_text(encoding="utf-8"))
        for entry in sorted(found, key=lambda entry: entry.name)
    ]


def seed(session: Session) -> list[RulesetVersion]:
    """Store any bundled version the database does not have yet.

    Returns what it added, which is empty on every start after the first. Does not commit —
    the caller owns the transaction.
    """
    added = []
    for payload in payloads():
        try:
            added.append(
                store_version(
                    session,
                    payload=payload,
                    # The payload names its own version, so nothing has to agree about
                    # filenames.
                    version_label=payload["version"],
                    slug=atxxii.SLUG,
                    name=atxxii.NAME,
                    organizer=atxxii.ORGANIZER,
                    source_url=atxxii.SOURCE_URL,
                )
            )
        except VersionAlreadyImported:
            # Already published. Seeding runs on every start, so this is the normal case.
            continue
    return added
