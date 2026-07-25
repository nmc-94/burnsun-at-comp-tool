"""The saved workspace: which boards a character has open on a team, and what is on each.

Two rules shape both routes here.

**A layout is a document of ids somebody wrote down earlier, and the server trusts none of
them.** Between one visit and the next a comp can be deleted; a request can name an id that
was never a comp at all. So every read and every write intersects the document with the
comps the team actually has, and only the intersection is stored or served. Without that, a
layout would be a record of comp ids that outlives the comps — a leak against exactly the
invariant ``access.py`` exists to protect.

**A layout is not an oracle.** Ids that do not survive the intersection are *dropped*, never
refused. A refusal of any shape would say "that id is real, just not yours", which is the
sentence a comp 404 is written to avoid.

The workspace hangs off a team because a board is a view onto one team's comps, and it
belongs to a character because it is one person's screen. That pair is the whole of its
identity; there is no user table, so the character is a bare id like every other one here.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator
from pydantic.alias_generators import to_camel
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from .access import authorize
from .auth.dependencies import current_viewer
from .db import get_session
from .models import AccessLevel, Comp, WorkspaceLayout
from .permissions import Viewer

router = APIRouter(prefix="/api/v1/teams", tags=["workspace"])


#: Ceilings on what one request may carry, in the same spirit as ``MAX_SLOTS``: a bound on
#: a payload, not a statement about how anyone should work. Twenty boards of fifty tiles is
#: far past the point where a screen is useful; the point of the numbers is that a client
#: with a loop bug cannot store an unbounded document.
MAX_BOARDS = 20
MAX_TILES_PER_BOARD = 50


class _Response(BaseModel):
    # camelCase on the wire: the SPA is the only consumer.
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class _Request(_Response):
    """Same contract inbound. Named separately so the direction is readable."""


Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]


class WorkspaceTile(_Response):
    """One comp open on a board.

    An object rather than a bare id, because this is where a tile's position and size go
    when the board stops being a fixed grid — a client-side change then, not a migration.
    """

    comp_id: uuid.UUID


class WorkspaceBoard(_Response):
    """A board as it is stored and as it is served.

    Deliberately carries no ceilings. Those belong on the request below: a stored document
    was bounded when it was written, and a limit lowered later must not make somebody's
    existing workspace unreadable.
    """

    #: The client's, not the server's. The grid needs a stable key before it can render a
    #: new board and the router puts it in the URL, so a round trip to learn a board's own
    #: identity would be a round trip in the way of a click.
    id: uuid.UUID
    name: str
    tiles: list[WorkspaceTile]


class WorkspaceBoardWrite(_Request):
    id: uuid.UUID
    name: Name
    tiles: Annotated[list[WorkspaceTile], Field(max_length=MAX_TILES_PER_BOARD)]


class WorkspaceSave(_Request):
    boards: Annotated[list[WorkspaceBoardWrite], Field(max_length=MAX_BOARDS)]
    #: Which board was in front. Kept so returning to a bare team URL lands where the
    #: person left, rather than on whichever board happens to sort first.
    active_board_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def _boards_are_distinct(self) -> WorkspaceSave:
        # A 422 rather than the 409 a second flagship gets, and the difference is real: the
        # flagship rule is also in the database and would answer in its own words if this
        # route stayed quiet, whereas two boards sharing an id is nothing but a malformed
        # request — the grid keys its tiles on it, and so does the URL.
        ids = [board.id for board in self.boards]
        if len(set(ids)) != len(ids):
            raise ValueError("Each board needs its own id")
        return self


class WorkspaceDetail(_Response):
    """The workspace as it will be drawn: only boards, and only comps that still exist."""

    boards: list[WorkspaceBoard]
    active_board_id: uuid.UUID | None
    #: When the arrangement last actually changed. A save that changes nothing does not
    #: move it. Null until anything has been saved.
    updated_at: datetime | None


def _teams_comp_ids(session: Session, team_id: uuid.UUID) -> set[uuid.UUID]:
    """The comps this team actually has, right now.

    Everything a layout could be wrong about resolves against this one set: a comp deleted
    since the document was written, an id that was never a comp, an id belonging to
    somebody else's team, an id typed into a request to see what comes back. One set,
    consulted on the way in and on the way out, because a second copy of this rule is a
    second chance to hand back an id the caller may not see.
    """
    return set(session.scalars(select(Comp.id).where(Comp.team_id == team_id)).all())


def _present(
    boards: Sequence[WorkspaceBoard | WorkspaceBoardWrite], present: set[uuid.UUID]
) -> list[WorkspaceBoard]:
    """``boards`` with every tile naming a comp this team does not have removed.

    Duplicates within one board go too, first occurrence kept: two tiles on one board
    editing one comp would autosave over each other, which is the concurrency problem a
    board was supposed to make rarer rather than a feature. The same comp on *two* boards
    is fine and stays — a tile is a view, and looking at one comp from two boards is the
    point.

    A board whose comps have all been deleted keeps its place. It is still a board somebody
    named; removing it would be the server deciding what the user meant.
    """
    kept: list[WorkspaceBoard] = []
    for board in boards:
        seen: set[uuid.UUID] = set()
        tiles: list[WorkspaceTile] = []
        for tile in board.tiles:
            if tile.comp_id in present and tile.comp_id not in seen:
                seen.add(tile.comp_id)
                tiles.append(tile)
        kept.append(WorkspaceBoard(id=board.id, name=board.name, tiles=tiles))
    return kept


def _active(boards: Sequence[WorkspaceBoard], requested: uuid.UUID | None) -> uuid.UUID | None:
    """The requested board if it is one of these, else the first, else nothing.

    Resolved rather than echoed, so a stored id left over from a board that has since been
    closed cannot send the client looking for a board that is not in the same response.
    """
    if requested is not None and any(board.id == requested for board in boards):
        return requested
    return boards[0].id if boards else None


def _load(session: Session, team_id: uuid.UUID, character_id: int) -> WorkspaceLayout | None:
    return session.scalar(
        select(WorkspaceLayout).where(
            WorkspaceLayout.team_id == team_id,
            WorkspaceLayout.character_id == character_id,
        )
    )


def _document(boards: Sequence[WorkspaceBoard], active_board_id: uuid.UUID | None) -> dict:
    return {
        "boards": [board.model_dump(mode="json", by_alias=True) for board in boards],
        "activeBoardId": str(active_board_id) if active_board_id else None,
    }


@router.get("/{team_id}/workspace", response_model=WorkspaceDetail)
def get_workspace(
    team_id: uuid.UUID,
    session: Session = Depends(get_session),
    viewer: Viewer = Depends(current_viewer),
) -> WorkspaceDetail:
    """This character's arrangement of this team's comps.

    Never a 404 of its own. A team you can see but have never opened has an empty
    workspace, which is the truthful answer rather than an error — and a 404 here would be
    indistinguishable from the one ``authorize`` raises, so "no layout" and "no team" would
    answer alike for no reason.

    The stored document is filtered before it is served and *not* rewritten. A read that
    writes is a read that writes: it would move ``updated_at`` and turn opening the app
    into a save. The client sends the pruned version back on its next real save.
    """
    access = authorize(session, team_id, viewer, AccessLevel.VIEWER)
    record = _load(session, access.team.id, viewer.character_id)
    if record is None:
        return WorkspaceDetail(boards=[], active_board_id=None, updated_at=None)

    stored = [WorkspaceBoard.model_validate(raw) for raw in record.document.get("boards", [])]
    boards = _present(stored, _teams_comp_ids(session, access.team.id))
    requested = record.document.get("activeBoardId")
    return WorkspaceDetail(
        boards=boards,
        active_board_id=_active(boards, uuid.UUID(requested) if requested else None),
        updated_at=record.updated_at,
    )


@router.put("/{team_id}/workspace", response_model=WorkspaceDetail)
def save_workspace(
    team_id: uuid.UUID,
    body: WorkspaceSave,
    session: Session = Depends(get_session),
    viewer: Viewer = Depends(current_viewer),
) -> WorkspaceDetail:
    """Store the arrangement as it now stands.

    Viewer, not editor. Arranging your own screen is not editing the team's content: a
    viewer opens tiles to read them, and refusing to remember that would make a read-only
    team unusable while telling nobody anything.

    No ``live()`` either, and that is the considered part. An archived team stays plainly
    readable — that is the whole point of archiving rather than deleting — and reading it
    means having tiles on a board. If this refused, browsing an archived season would throw
    on every board switch. A layout is nobody's work and no part of the season's record; it
    is the one write in this codebase that is not a write to the team.

    Comp ids that are not this team's comps are dropped rather than refused. Refusing —
    with any status, in any words — would answer the one question a comp id must never
    answer. Dropped, an id that comes back is a comp the caller could already list, and an
    id that does not is a comp that was deleted, belongs to somebody else, or never
    existed: one answer for all three, which is the rule ``access.py`` exists to hold.
    """
    access = authorize(session, team_id, viewer, AccessLevel.VIEWER)
    boards = _present(body.boards, _teams_comp_ids(session, access.team.id))
    active_board_id = _active(boards, body.active_board_id)
    document = _document(boards, active_board_id)

    record = _load(session, access.team.id, viewer.character_id)
    if record is not None and record.document == document:
        # A board switch that changed nothing is not a change. Skipping the write keeps
        # updated_at meaning "the arrangement last moved", and keeps a client that saves on
        # every render from writing a new row version every few seconds for nothing. Names
        # are trimmed and ids canonicalized by validation, so this comparison is not fooled
        # by whitespace or by an uppercase uuid.
        return WorkspaceDetail(
            boards=boards, active_board_id=active_board_id, updated_at=record.updated_at
        )

    saved_at = session.scalar(
        pg_insert(WorkspaceLayout)
        .values(team_id=access.team.id, character_id=viewer.character_id, document=document)
        .on_conflict_do_update(
            # Upserted on the natural key rather than read-then-insert, so two browser tabs
            # saving at the same moment resolve to last-write-wins instead of to an
            # integrity error. Last write wins is right here and nowhere else in this
            # codebase: a layout has exactly one writer — you — so there is no second
            # editor to overwrite.
            index_elements=["team_id", "character_id"],
            # Spelled out because ``onupdate`` is an ORM-level default a core upsert never
            # reaches; without this the timestamp would freeze at insert.
            set_={"document": document, "updated_at": func.now()},
        )
        .returning(WorkspaceLayout.updated_at)
    )
    session.commit()
    return WorkspaceDetail(boards=boards, active_board_id=active_board_id, updated_at=saved_at)
