"""Sharing: a comp behind a name anyone can open.

Its own module because it holds the one place in this application where team content is read
**without a session**, and an exception has to be visible to stay one. ``comps.py`` promises
that every route in it reaches its comp through ``access.reach_comp``; a public read living
there would make that promise false. So this sits *beside* the gate the way ``rulesets.py``
does, rather than inside it.

Two routers, and the asymmetry is the design. Minting, updating and withdrawing are team
actions on a comp and go through ``reach_comp`` like everything else; reading goes through
nothing at all. They share a file so that what a link withholds is written next to the route
that creates it.

**Six rules shape every route.**

**A slug is a secret, not an identifier.** Holding it is the whole of the authorization, so it
is minted by the server and never chosen. Nothing else about the caller is consulted: a
signed-in reader and an anonymous one get byte-identical answers, because a public route that
varied with a session would be a second authorization path in the one place that must not have
one. What keeps a guessable-sized name safe is the rate limit below and the ability to
withdraw — see ``share_slug`` for the arithmetic.

**A share is a snapshot, not a window.** ``document`` is what the comp was when the link was
minted or last updated, and the reader is served straight out of it. So this route **never
touches the comp table** — it cannot leak a field of a comp it does not read, which is a
stronger promise than remembering not to serve one. The cost is that a share goes stale, which
is why ``CompDetail`` carries ``shareStale`` and the panel offers to update it.

**Nothing here re-derives a slug.** The row stores the string that was minted and lookup is
equality on it. The lexicon is write-only: change the word list, keep every link. Only the
*length* of an incoming slug is checked, and only so an unbounded path segment never reaches a
query — the alphabet and the grammar are deliberately not enforced, because a reader that
insisted on today's grammar would refuse yesterday's links.

**An unknown slug, a withdrawn one and a malformed one are one answer.** 404, identical down to
the body. Not for ``access.py``'s reason — a slug names no team, so there is nothing here to
enumerate — but because anything else is an oracle: a 403 would say "this exists and is not
yours", and telling somebody their guess was nearly right is most of what a guessing attack
needs. The slug is not echoed back either. Elsewhere an id in a 404 is the caller's own and
already parsed; here it is free text this route was handed.

**A link shows the comp, not the team around it.** The hulls, the name, the version it was
priced by, and when it was captured. Not the author, not the tags, not the lineage, not the
thread, and no id of any kind. :class:`SharedCompDetail` *is* that decision, and it is declared
here rather than imported from ``comps.py`` on purpose: a shape shared with the authenticated
routes is a shape that grows a field one morning and publishes it the same afternoon.

**Reading survives an archive; writing does not.** Archiving puts a season away rather than
opening it for annotation, and it has always guarded writes only. A link that died when a
captain tidied up would take the record of a match with it.
"""

from __future__ import annotations

import time
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import share_slug
from .access import live, reach_comp
from .auth.dependencies import current_viewer
from .db import get_session
from .models import AccessLevel, Comp, CompShare
from .permissions import Viewer

comp_router = APIRouter(prefix="/api/v1/comps", tags=["share"])
router = APIRouter(prefix="/api/v1/share", tags=["share"])

#: How many times to re-roll on a slug collision before giving up. A collision in a space of
#: four billion is a lottery win, but a bounded loop answering 503 is the difference between a
#: wedged constraint being a failed request and a hung one.
MINT_ATTEMPTS = 8

#: The public read's budget, per client, per window. This is load-bearing: the slug is a
#: four-word name rather than a key, and this is what turns "minutes to guess one" into
#: "years". Generous enough that a person opening a link, reloading it and following it from
#: two devices never notices.
RATE_LIMIT = 30
RATE_WINDOW_SECONDS = 60

#: A ceiling on the table the limiter keeps, so a spray of forged client addresses cannot grow
#: it without bound. Past this the window is cleared wholesale: the limiter is a speed bump,
#: not an accounting system, and forgetting is a safer failure than exhausting memory.
MAX_TRACKED_CLIENTS = 10_000

_hits: dict[str, tuple[float, int]] = {}


class _Response(BaseModel):
    # camelCase on the wire: the SPA is the only consumer.
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class ShareDetail(_Response):
    """The link itself, for whoever just made it. Never served to the reader."""

    slug: str
    #: When the link was minted, and when what it shows was last captured. They differ once a
    #: share has been updated, which is how a panel can say "shared last week, updated today".
    created_at: datetime
    captured_at: datetime


class SharedSlotDetail(_Response):
    position: int
    type_id: int
    is_flagship: bool


class SharedCompDetail(_Response):
    """Everything a share link reveals. The field list is the decision — see the docstring."""

    name: str
    #: What priced it. Both are keys to the already-public ruleset routes, so the reader can
    #: fetch the payload and compute points for themselves — legality stays client-only, and
    #: no hull name or point value is resolved on this route.
    ruleset_slug: str
    ruleset_version_label: str
    ship_count: int
    captured_at: datetime
    slots: list[SharedSlotDetail]


def no_such_link() -> HTTPException:
    """The single answer to every miss. Deliberately says nothing about which kind."""
    return HTTPException(status_code=404, detail="No such share link")


def _snapshot(comp: Comp) -> dict:
    """The frozen comp, in the shape it will be served in.

    Written camelCase because it is a wire document rather than a row: what goes in is what
    comes out, so serving a share is a read and not a translation.
    """
    return {
        "name": comp.name,
        "rulesetSlug": comp.ruleset_version.ruleset.slug,
        "rulesetVersionLabel": comp.ruleset_version.version_label,
        "slots": [
            {"position": slot.position, "typeId": slot.type_id, "isFlagship": slot.is_flagship}
            for slot in comp.slots
        ],
    }


def live_share(session: Session, comp_id: uuid.UUID) -> CompShare | None:
    """The one share of this comp that has not been withdrawn, if there is one."""
    return session.scalar(
        select(CompShare).where(CompShare.comp_id == comp_id, CompShare.revoked_at.is_(None))
    )


def _detail(record: CompShare) -> ShareDetail:
    return ShareDetail(
        slug=record.slug, created_at=record.created_at, captured_at=record.captured_at
    )


def _mint(session: Session, comp: Comp) -> CompShare:
    """Generate-and-retry, with the unique index as the arbiter rather than a pre-check.

    A savepoint per attempt, so a collision rolls back the insert and nothing else. The caller
    has already ruled out the one-live-share index by looking first, so a violation here can
    only be the slug's.
    """
    document = _snapshot(comp)
    for _ in range(MINT_ATTEMPTS):
        record = CompShare(comp_id=comp.id, slug=share_slug.generate(), document=document)
        try:
            with session.begin_nested():
                session.add(record)
            return record
        except IntegrityError:
            continue
    raise HTTPException(status_code=503, detail="Could not mint a share link; please try again")


def rate_limited(request: Request) -> None:
    """A fixed window per client address, in memory.

    In memory because this deployment is one service (§7) and because a limiter that needed a
    broker would make the simplest self-host harder for a threat this size. Multi-instance
    carries the same caveat §7 already records for the realtime channel: this becomes per
    instance, and the budget multiplies by however many there are.
    """
    now = time.monotonic()
    client = request.client.host if request.client else "unknown"

    if len(_hits) > MAX_TRACKED_CLIENTS:
        _hits.clear()

    started, count = _hits.get(client, (now, 0))
    if now - started >= RATE_WINDOW_SECONDS:
        started, count = now, 0
    if count >= RATE_LIMIT:
        raise HTTPException(
            status_code=429,
            detail="Too many share requests; wait a moment and try again",
            headers={"Retry-After": str(RATE_WINDOW_SECONDS)},
        )
    _hits[client] = (started, count + 1)


def reset_rate_limit() -> None:
    """Tests only. Module state outlives a test, and every test here shares one client host."""
    _hits.clear()


@comp_router.post("/{comp_id}/share", response_model=ShareDetail, status_code=201)
def mint_share(
    comp_id: uuid.UUID,
    response: Response,
    session: Session = Depends(get_session),
    viewer: Viewer = Depends(current_viewer),
) -> ShareDetail:
    """Share this comp, or hand back the link it already has.

    Answering 200 with the existing link rather than minting a second: a comp is shared or it
    is not, and asking twice is a client that lost the first answer, not a request for another
    link. The database says the same thing through ``uq_comp_share_one_live``.
    """
    comp, access = reach_comp(session, comp_id, viewer, AccessLevel.EDITOR)
    live(access)

    existing = live_share(session, comp.id)
    if existing is not None:
        response.status_code = 200
        return _detail(existing)

    record = _mint(session, comp)
    session.commit()
    session.refresh(record)
    return _detail(record)


@comp_router.put("/{comp_id}/share", response_model=ShareDetail)
def update_share(
    comp_id: uuid.UUID,
    session: Session = Depends(get_session),
    viewer: Viewer = Depends(current_viewer),
) -> ShareDetail:
    """Re-capture the comp under the **same** slug.

    The same slug on purpose: a link somebody has already sent to a scrim partner should not
    stop working because its author fixed a typo. Withdrawing and re-sharing is the gesture
    that changes the address, and it is a different button.
    """
    comp, access = reach_comp(session, comp_id, viewer, AccessLevel.EDITOR)
    live(access)

    existing = live_share(session, comp.id)
    if existing is None:
        raise HTTPException(status_code=404, detail="This comp is not shared")

    existing.document = _snapshot(comp)
    existing.captured_at = func.now()
    session.commit()
    session.refresh(existing)
    return _detail(existing)


@comp_router.delete("/{comp_id}/share", status_code=204)
def revoke_share(
    comp_id: uuid.UUID,
    session: Session = Depends(get_session),
    viewer: Viewer = Depends(current_viewer),
) -> Response:
    """Withdraw the link. The row stays — see ``CompShare`` — so the slug is never reissued.

    A 404 when there is nothing shared, rather than a silent 204: the caller is holding a comp
    that told them there was a link, so pretending otherwise would hide that their view has
    moved on. Nothing is concealed by saying so — they already hold editor on the comp.
    """
    comp, access = reach_comp(session, comp_id, viewer, AccessLevel.EDITOR)
    live(access)

    existing = live_share(session, comp.id)
    if existing is None:
        raise HTTPException(status_code=404, detail="This comp is not shared")

    existing.revoked_at = func.now()
    session.commit()
    return Response(status_code=204)


@router.get("/{slug}", response_model=SharedCompDetail)
def read_share(
    slug: str,
    response: Response,
    session: Session = Depends(get_session),
    _limit: None = Depends(rate_limited),
) -> SharedCompDetail:
    """One shared comp, as it was captured. No viewer parameter, and that absence is the route.

    Bounded by length only, and answering the same 404 for every kind of miss.
    """
    if len(slug) > share_slug.MAX_SLUG_LENGTH:
        # Refused as a miss rather than as a malformed request: a 422 here would confirm that
        # short slugs are the interesting ones.
        raise no_such_link()

    record = session.scalar(
        select(CompShare).where(CompShare.slug == slug, CompShare.revoked_at.is_(None))
    )
    if record is None:
        raise no_such_link()

    # A shared comp is somebody's draft behind an unguessable name. Being indexed would make
    # the name pointless.
    response.headers["X-Robots-Tag"] = "noindex, nofollow"

    document = record.document
    return SharedCompDetail(
        name=document["name"],
        ruleset_slug=document["rulesetSlug"],
        ruleset_version_label=document["rulesetVersionLabel"],
        ship_count=len(document["slots"]),
        captured_at=record.captured_at,
        slots=[SharedSlotDetail.model_validate(slot) for slot in document["slots"]],
    )
