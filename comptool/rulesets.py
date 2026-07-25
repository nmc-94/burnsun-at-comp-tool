"""Serving ingested rulesets.

The server's whole role in legality is this: hand the client the resolved payload of a
version, and say which version it is. It never judges a comp — that happens in the browser,
against the payload these routes return.

Two lookups, because comps outlive point changes: *latest* is what a new comp is built
against, and *by label* is how an existing comp re-validates against the rules it was
designed under. Both carry the version label and capture date alongside the payload, so the
UI can always name what is loaded rather than silently serving stale values.
"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from .db import get_session
from .models import Ruleset, RulesetVersion

router = APIRouter(prefix="/api/v1/rulesets", tags=["rulesets"])


class _Response(BaseModel):
    # camelCase on the wire: the SPA is the only consumer.
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class VersionSummary(_Response):
    version_label: str
    source_url: str
    fetched_at: datetime


class RulesetSummary(_Response):
    slug: str
    name: str
    organizer: str
    #: Null until a version has been imported.
    latest_version: VersionSummary | None


class RulesetVersionDetail(_Response):
    slug: str
    name: str
    organizer: str
    version_label: str
    source_url: str
    fetched_at: datetime
    #: The engine's ``Ruleset`` shape, served through as stored.
    payload: dict


def _summary(version: RulesetVersion) -> VersionSummary:
    return VersionSummary(
        version_label=version.version_label,
        source_url=version.source_url,
        fetched_at=version.fetched_at,
    )


def _detail(record: Ruleset, version: RulesetVersion) -> RulesetVersionDetail:
    return RulesetVersionDetail(
        slug=record.slug,
        name=record.name,
        organizer=record.organizer,
        version_label=version.version_label,
        source_url=version.source_url,
        fetched_at=version.fetched_at,
        payload=version.payload,
    )


def _find(session: Session, slug: str) -> Ruleset:
    record = session.scalar(
        select(Ruleset).where(Ruleset.slug == slug).options(selectinload(Ruleset.versions))
    )
    if record is None:
        raise HTTPException(status_code=404, detail=f"No ruleset {slug!r}")
    return record


@router.get("", response_model=list[RulesetSummary])
def list_rulesets(session: Session = Depends(get_session)) -> list[RulesetSummary]:
    records = session.scalars(
        select(Ruleset).order_by(Ruleset.slug).options(selectinload(Ruleset.versions))
    ).all()
    return [
        RulesetSummary(
            slug=record.slug,
            name=record.name,
            organizer=record.organizer,
            # Versions are ordered by capture date, so the newest is the last.
            latest_version=_summary(record.versions[-1]) if record.versions else None,
        )
        for record in records
    ]


@router.get("/{slug}/latest", response_model=RulesetVersionDetail)
def latest_version(slug: str, session: Session = Depends(get_session)) -> RulesetVersionDetail:
    record = _find(session, slug)
    if not record.versions:
        raise HTTPException(status_code=404, detail=f"No version imported for {slug!r}")
    return _detail(record, record.versions[-1])


@router.get("/{slug}/versions/{version_label}", response_model=RulesetVersionDetail)
def pinned_version(
    slug: str, version_label: str, session: Session = Depends(get_session)
) -> RulesetVersionDetail:
    record = _find(session, slug)
    version = next((v for v in record.versions if v.version_label == version_label), None)
    if version is None:
        raise HTTPException(status_code=404, detail=f"No version {version_label!r} for {slug!r}")
    return _detail(record, version)
