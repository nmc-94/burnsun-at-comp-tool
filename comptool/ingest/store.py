"""Putting a built payload into the database as a ruleset version.

The one piece of the ingester that touches the database, kept apart from the command that
usually calls it so the seed and the CLI cannot drift into two subtly different notions of
what an import means.

A version is an immutable snapshot. There is no update path here on purpose: a change to
the rules is a new row under a new label, which is what lets a comp built in June still
re-validate against June's point values in September.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..models import Ruleset, RulesetVersion
from .errors import IngestError


class VersionAlreadyImported(IngestError):
    """That label is already published.

    Its own class because HTTP wants to answer it differently from a malformed snapshot —
    one is a conflict with what is already there, the other is bad input.
    """


def capture_date(version_label: str) -> datetime:
    """When a snapshot was taken.

    A date-shaped label *is* the capture date, and that is what makes the ordering of a
    ruleset's versions meaningful. Any other label carries no date, so the import time is
    the honest answer — labels are free-form by design, and a free-form one must not be a
    traceback.
    """
    try:
        return datetime.fromisoformat(version_label).replace(tzinfo=UTC)
    except ValueError:
        return datetime.now(tz=UTC)


def store_version(
    session: Session,
    *,
    payload: dict,
    version_label: str,
    slug: str,
    name: str,
    organizer: str,
    source_url: str,
    fetched_at: datetime | None = None,
) -> RulesetVersion:
    """Find or create the ruleset, and add one version to it.

    Adds and flushes; it does not commit. The caller owns the transaction, which is what
    lets a command and a request share this without either of them guessing about the
    other's boundaries.
    """
    record = session.scalar(select(Ruleset).where(Ruleset.slug == slug))
    if record is None:
        record = Ruleset(slug=slug, name=name, organizer=organizer)
        session.add(record)
        session.flush()

    already = session.scalar(
        select(RulesetVersion).where(
            RulesetVersion.ruleset_id == record.id,
            RulesetVersion.version_label == version_label,
        )
    )
    if already is not None:
        raise VersionAlreadyImported(
            f"{slug} version {version_label!r} is already imported. A version is an "
            "immutable snapshot — publish the change under a new label instead."
        )

    version = RulesetVersion(
        ruleset_id=record.id,
        version_label=version_label,
        source_url=source_url,
        fetched_at=fetched_at or capture_date(version_label),
        payload=payload,
    )
    session.add(version)
    try:
        session.flush()
    except IntegrityError as error:
        # Two imports of the same label at once. The check above loses that race; the
        # unique constraint does not.
        session.rollback()
        raise VersionAlreadyImported(
            f"{slug} version {version_label!r} is already imported."
        ) from error
    return version
