"""Comments: what a team says to each other about a comp.

Its own module because it is its own concern. ``comps.py`` stores what a comp *contains*; this
stores what people said about it, which is the first thing in the application that is neither
game data nor an arrangement of it. Per-slot comments are a named later enhancement (§4.1b),
and they will land here rather than widening the comp routes.

Four rules shape every route.

**A comment on a comp you may not see does not exist.** Every route reaches its comp through
``access.reach_comp``, so "no such comp", "not your team" and "someone else's team" all answer
the same 404 they answer everywhere else.

**A comment is addressed inside its thread.** ``/comps/{comp_id}/comments/{comment_id}``,
scoped the way ``teams.py`` scopes a grant inside its team: a comment is not a thing people
open, it is a child of a conversation, and scoping it means an id from another comp is not
reachable by holding a comp you can see.

**Viewers may post.** §4.1b says any team member with access can comment, and a viewer
reviewing a captain's comp is the case that matters. This is the one write path in the
application open below editor — deliberately, and still refused on an archived team, because
archiving puts a season away rather than opening it for annotation.

**Refusing someone else's comment is a 403, not a 404.** The comment is right there in a
thread the caller can already read, so hiding it would be a lie rather than a defence. The
404 rule exists to stop an id revealing which *teams* there are, and nothing here does.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, StringConstraints
from pydantic.alias_generators import to_camel
from sqlalchemy import select
from sqlalchemy.orm import Session

from .access import live, reach_comp
from .auth.dependencies import current_viewer
from .db import get_session
from .live import KIND_CHANGED, origin_client, publish
from .models import AccessLevel, Comp, CompComment
from .permissions import Viewer

router = APIRouter(prefix="/api/v1/comps", tags=["comments"])


def _announce(comp: Comp, viewer: Viewer, origin: str | None) -> None:
    """Tell the team's open boards that this comp's thread moved.

    ``comp.changed``, the same event a hull swap sends, because it is the same question from
    a board's point of view: re-read this comp. The count a tile draws lives on the comp
    payload, so a comment landing changes what a *comp* says — the thread itself is a second
    read the client makes only where it is showing one.

    ``updated_at`` is deliberately not sent. A comment does not move it — writing to
    ``comp_comment`` leaves the comp row alone — and passing the unchanged value would tell a
    client that already holds this version it has nothing to do, which is the one thing that
    would make this event a no-op.
    """
    publish(
        comp.team_id,
        KIND_CHANGED,
        comp_id=comp.id,
        actor=viewer.character_name,
        origin=origin,
    )


class _Response(BaseModel):
    # camelCase on the wire: the SPA is the only consumer.
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class _Request(_Response):
    """Same contract inbound. Named separately so the direction is readable."""


#: Trimmed before it is measured, so a comment of nothing but spaces is refused rather than
#: posted as an empty line. The ceiling is generous — this is where somebody explains why the
#: third battleship is worth it — and bounded, so one request cannot store a novel.
Body = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]


class CommentDetail(_Response):
    id: uuid.UUID
    #: Whoever wrote it, captured once. Null on a comment whose author was never recorded.
    author_name: str | None
    body: str
    created_at: datetime
    #: When the body was last rewritten; null means never. The UI says "edited" on the
    #: strength of this, because a comment showing only its original timestamp after an edit
    #: is a comment lying about itself.
    updated_at: datetime | None
    #: Whether the requesting character wrote this one. Computed here rather than left to the
    #: client to work out from an id, the same way ``CompDetail.your_level`` is: the SPA gates
    #: its controls on what the server says, not on a guess.
    yours: bool


class CommentWrite(_Request):
    body: Body


def _detail(comment: CompComment, viewer: Viewer) -> CommentDetail:
    return CommentDetail(
        id=comment.id,
        author_name=comment.author_name,
        body=comment.body,
        created_at=comment.created_at,
        updated_at=comment.updated_at,
        yours=_is_author(comment, viewer),
    )


def _is_author(comment: CompComment, viewer: Viewer) -> bool:
    """Whether this character wrote it.

    ``author_character_id`` is nullable, and a null author is nobody rather than everybody: a
    comment with no recorded author is editable by no one, and only an owner can moderate it
    away. Matched on the id and never on the name, which is display only and can change.
    """
    return (
        comment.author_character_id is not None
        and comment.author_character_id == viewer.character_id
    )


def _find(session: Session, comp_id: uuid.UUID, comment_id: uuid.UUID) -> CompComment:
    # Scoped to the comp, so a comment id from another comp is not reachable by holding a
    # comp you can see — the same shape as ``teams.py``'s ``_find_grant``.
    comment = session.scalar(
        select(CompComment).where(
            CompComment.id == comment_id, CompComment.comp_id == comp_id
        )
    )
    if comment is None:
        raise HTTPException(status_code=404, detail=f"No comment {str(comment_id)!r}")
    return comment


@router.get("/{comp_id}/comments", response_model=list[CommentDetail])
def list_comments(
    comp_id: uuid.UUID,
    session: Session = Depends(get_session),
    viewer: Viewer = Depends(current_viewer),
) -> list[CommentDetail]:
    """The whole thread, oldest first.

    A conversation read in the order it happened. The ``(comp_id, created_at)`` index has
    been there since ``0002`` waiting for exactly this query.
    """
    comp, _ = reach_comp(session, comp_id, viewer, AccessLevel.VIEWER)
    comments = session.scalars(
        select(CompComment)
        .where(CompComment.comp_id == comp.id)
        .order_by(CompComment.created_at, CompComment.id)
    ).all()
    return [_detail(comment, viewer) for comment in comments]


@router.post("/{comp_id}/comments", response_model=CommentDetail, status_code=201)
def post_comment(
    comp_id: uuid.UUID,
    body: CommentWrite,
    session: Session = Depends(get_session),
    viewer: Viewer = Depends(current_viewer),
    origin: str | None = Depends(origin_client),
) -> CommentDetail:
    """Add to the thread. Viewer, not editor — see the module docstring."""
    comp, access = reach_comp(session, comp_id, viewer, AccessLevel.VIEWER)
    live(access)
    comment = CompComment(
        comp_id=comp.id,
        # Both, for the reason ``Comp`` keeps both: the id is what authorization matches on
        # and the name is what a thread displays, and a name resolved once cannot go stale
        # into somebody else's.
        author_character_id=viewer.character_id,
        author_name=viewer.character_name,
        body=body.body,
    )
    session.add(comment)
    session.commit()
    _announce(comp, viewer, origin)
    return _detail(comment, viewer)


@router.patch("/{comp_id}/comments/{comment_id}", response_model=CommentDetail)
def edit_comment(
    comp_id: uuid.UUID,
    comment_id: uuid.UUID,
    body: CommentWrite,
    session: Session = Depends(get_session),
    viewer: Viewer = Depends(current_viewer),
    origin: str | None = Depends(origin_client),
) -> CommentDetail:
    """Rewrite your own comment.

    Only your own, and not as an owner either: moderating is removing something, not putting
    different words in somebody's mouth. ``created_at`` never moves — when the comment was
    said is a fact about the conversation — and ``updated_at`` is set here, which is the only
    place that writes it.
    """
    comp, access = reach_comp(session, comp_id, viewer, AccessLevel.VIEWER)
    live(access)
    comment = _find(session, comp.id, comment_id)
    if not _is_author(comment, viewer):
        raise HTTPException(status_code=403, detail="Only a comment's author can edit it")
    comment.body = body.body
    comment.updated_at = datetime.now(tz=UTC)
    session.commit()
    _announce(comp, viewer, origin)
    return _detail(comment, viewer)


@router.delete("/{comp_id}/comments/{comment_id}", status_code=204)
def delete_comment(
    comp_id: uuid.UUID,
    comment_id: uuid.UUID,
    session: Session = Depends(get_session),
    viewer: Viewer = Depends(current_viewer),
    origin: str | None = Depends(origin_client),
) -> Response:
    """Take a comment out of the thread: your own, or anyone's if you own the team.

    Really deleted, not tombstoned. The same call ``delete_comp`` makes and for the same
    reason — a thread carrying "removed" placeholders is a thread that keeps showing you the
    thing somebody asked to have gone.
    """
    comp, access = reach_comp(session, comp_id, viewer, AccessLevel.VIEWER)
    live(access)
    comment = _find(session, comp.id, comment_id)
    if not _is_author(comment, viewer) and access.level < AccessLevel.OWNER:
        raise HTTPException(
            status_code=403, detail="Only a comment's author or the team's owner can delete it"
        )
    session.delete(comment)
    session.commit()
    _announce(comp, viewer, origin)
    return Response(status_code=204)
