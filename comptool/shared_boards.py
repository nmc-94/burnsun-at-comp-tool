"""A board the whole team works on, rather than one each.

``workspace.py`` stores one arrangement per character per team and says in as many words that
a layout has exactly one writer — you. This is the other thing: one board that belongs to the
*team*, that everybody with access opens at the same URL, and whose order the server decides.
The two never mix. A shared board is not a member of ``WorkspaceDetail.boards`` and never will
be; the client merges the two lists for its tab strip, which is a client's business.

Four rules shape every route here.

**Rows, not a document.** The decisive argument is one foreign key: ``shared_board_tile.comp_id``
cascades, so a comp id cannot outlive its comp. That is the invariant ``workspace.py`` spends two
functions enforcing by hand, and here the schema holds it. It also means two people moving two
different tiles are two UPDATEs on two rows rather than two writers racing to rewrite one blob.

**The key protects reads and never answers a write.** It is satisfied by *any* comp, including
another team's, and raises for a uuid that was never a comp at all — two cases that must be
indistinguishable to a caller, or a board becomes a probe for which comps exist. So a comp is
resolved against the team in Python first, an id that does not survive is **dropped rather than
refused** (``workspace.py``'s rule, and for its reason), and the read is written as a join so the
intersection cannot be left out of one query.

**Every op returns the whole resulting board.** Not the change — the result. A board op's outcome
depends on other people's ops interleaving with it, and the live stream deliberately filters a
tab's own echo, so a client that kept its optimistic guess would be permanently wrong with nothing
to correct it. The one exception is removing a tile, which answers 204 for the reason given on
:func:`remove_tile`.

**Order is carried by a sparse integer nobody sees.** ``position`` is never served; the response is
an ordered list. A move names the tile it lands *before*, never an index — an index stops meaning
the same place the moment somebody else inserts one.

What a shared board is *not*: floating. ``place_x``/``place_y`` exist on the tile so that promoting
one later costs no migration, but no op writes them and nothing here serves them — a field no route
writes is dead payload for the same reason a column no route reads is dead schema.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from pydantic.alias_generators import to_camel
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from .access import authorize, live, reach_shared_board
from .auth.dependencies import current_viewer
from .db import get_session
from .live import (
    KIND_BOARD_CHANGED,
    KIND_BOARD_CREATED,
    KIND_BOARD_DELETED,
    origin_client,
    publish_board,
)
from .models import AccessLevel, Comp, SharedBoard, SharedBoardTile
from .permissions import Viewer

# The one thing borrowed from ``workspace.py``, deliberately by import rather than by copy:
# resolving ids against the team is the rule that module exists to state, and a second
# implementation of it here would be a second chance to hand back an id the caller may not see.
from .workspace import _teams_comp_ids

team_router = APIRouter(prefix="/api/v1/teams", tags=["shared boards"])
router = APIRouter(prefix="/api/v1/boards", tags=["shared boards"])


#: Ceilings on one team's shared boards and one board's tiles, in the same spirit as
#: ``workspace.MAX_BOARDS``: a bound on a payload, not a statement about how anyone should work.
MAX_BOARDS_PER_TEAM = 20
MAX_TILES_PER_BOARD = 50

#: The space left between neighbours when a board is numbered.
#:
#: Sparse so a move is one UPDATE — take a number between the two tiles you land between —
#: rather than a renumbering of everybody's neighbours. Wide enough that the midpoint survives
#: sixteen consecutive drops into the same slot, which is the point at which :func:`_renumber`
#: runs; that path is reachable in ordinary use and therefore has its own test rather than a
#: comment saying it is unlikely.
POSITION_GAP = 1 << 16

#: How far a position may drift before the board is renumbered regardless of gaps.
#:
#: Repeatedly dropping a tile at the *front* walks positions downward a gap at a time and never
#: exhausts a midpoint, so the midpoint check alone would let them march to the edge of a 32-bit
#: integer and overflow there. Well inside it, so the renumber happens long before the column
#: would complain.
POSITION_LIMIT = 1 << 30


class _Response(BaseModel):
    # camelCase on the wire: the SPA is the only consumer.
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class _Request(_Response):
    """Same contract inbound. Named separately so the direction is readable."""


Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]

#: How a board draws its tiles. The same vocabulary ``workspace.BoardMode`` uses, so a board that
#: moves between the two kinds does not change what its mode is *called*. ``floating`` is stored
#: and served, and no op sets it in this slice.
BoardMode = Literal["grid", "floating"]


class SharedTile(_Response):
    """One comp on a shared board.

    An object rather than a bare id, for ``WorkspaceTile``'s reason: this is where a tile's
    place goes when a shared board learns to float, and an array of objects can grow a field
    where an array of uuids would have to change type.
    """

    comp_id: uuid.UUID


class SharedBoardDetail(_Response):
    id: uuid.UUID
    team_id: uuid.UUID
    name: str
    mode: BoardMode
    snap: bool
    #: What the client compares to decide whether an arriving document is newer than the one on
    #: screen. Monotonic; see ``models.SharedBoard.revision`` for why it is not a timestamp.
    revision: int
    tiles: list[SharedTile]
    created_by_name: str | None
    created_at: datetime
    updated_at: datetime


class BoardCreate(_Request):
    name: Name
    #: The comps to open on it, in order. Sent by the client because promoting a personal board
    #: has to copy *what is on screen* — the private layout is written 800 ms behind it, so a
    #: server-side copy of ``workspace_layout`` would take the board as it was before the last
    #: drag. Ids that are not this team's are dropped, exactly as everywhere else here.
    tiles: Annotated[list[uuid.UUID], Field(max_length=MAX_TILES_PER_BOARD)] = []


class BoardPatch(_Request):
    """What may be changed about a board itself, as opposed to what is on it.

    Every field optional and absence meaningful: two people changing two different fields must
    not revert each other, which is what a whole-object PUT would do.
    """

    name: Name | None = None
    mode: BoardMode | None = None
    snap: bool | None = None


class TileAdd(_Request):
    comp_id: uuid.UUID
    #: Where it lands. Null or absent means the end of the list. Named as a neighbour rather than
    #: an index for :func:`_slot_before`'s reason, and accepted on the *add* so that dragging a
    #: comp from the rail to a particular place is one op rather than an add and then a move.
    before_comp_id: uuid.UUID | None = None


class TileMove(_Request):
    """A move, and the one field in this module with three states.

    ``beforeCompId`` **absent** means "do not reorder" — a PATCH that changes nothing. **Null**
    means "to the end". A uuid means "immediately before that tile". Absence is read through
    ``model_fields_set``, not through the value, because null is a legitimate instruction here.
    """

    before_comp_id: uuid.UUID | None = None


def _tiles(session: Session, board: SharedBoard) -> Sequence[SharedBoardTile]:
    """A board's tiles, in order, and only ones whose comp is still this team's.

    The intersection is a **join** rather than a filter applied afterwards, so there is no
    unjoined query for a later reader to write by accident. Strictly the cascade already
    guarantees it — a tile cannot outlive its comp — which is exactly why saying it here is
    cheap: it costs one join and removes the need to remember why it is unnecessary.

    Ties are broken all the way down. ``position`` is sparse and not unique, and two tiles
    created in one transaction can share a timestamp, so without ``comp_id`` at the end the
    order served would occasionally be the database's whim.
    """
    return session.scalars(
        select(SharedBoardTile)
        .join(Comp, Comp.id == SharedBoardTile.comp_id)
        .where(SharedBoardTile.board_id == board.id, Comp.team_id == board.team_id)
        .order_by(
            SharedBoardTile.position,
            SharedBoardTile.created_at,
            SharedBoardTile.comp_id,
        )
    ).all()


def _present(board: SharedBoard, tiles: Sequence[SharedBoardTile]) -> SharedBoardDetail:
    return SharedBoardDetail(
        id=board.id,
        team_id=board.team_id,
        name=board.name,
        mode=board.mode,
        snap=board.snap,
        revision=board.revision,
        tiles=[SharedTile(comp_id=tile.comp_id) for tile in tiles],
        created_by_name=board.created_by_name,
        created_at=board.created_at,
        updated_at=board.updated_at,
    )


def _touch(board: SharedBoard) -> None:
    """Move the board's revision and its clock, by hand.

    A tile op writes no ``shared_board`` column, so SQLAlchemy emits no UPDATE on the board row
    and ``onupdate`` never fires: the revision would freeze and every client would quietly stop
    converging. This is the third occurrence of that bug in this codebase — ``_apply_slots`` and
    ``_apply_tags`` each fix it exactly this way — which is why it is a named helper rather than
    two assignments repeated at five call sites.

    The increment is a SQL expression rather than ``board.revision + 1`` evaluated here, so two
    ops landing together take two numbers instead of both writing the one they read. It also
    means ``board.revision`` is an expression until the row is refreshed, which is why every
    caller refreshes before it serves or publishes.
    """
    board.revision = SharedBoard.revision + 1
    board.updated_at = func.now()


def _announce(board: SharedBoard, kind: str, viewer: Viewer, origin: str | None) -> None:
    """Tell the team's open boards, after the write has actually landed.

    Called after ``commit`` in every case, for ``comps._announce``'s reason: an event is a
    promise that a re-read will show the change.
    """
    publish_board(
        board.team_id,
        kind,
        board_id=board.id,
        revision=board.revision,
        actor=viewer.character_name,
        origin=origin,
    )


def _slot_before(
    others: Sequence[SharedBoardTile], before_comp_id: uuid.UUID | None
) -> int | None:
    """The position that puts a tile immediately before ``before_comp_id``.

    ``others`` is the board in order, without the tile being placed. Returns ``None`` when the
    neighbours are already adjacent, or when positions have drifted far enough to be worth
    resetting — in both cases the caller renumbers and asks again.

    A neighbour that is not on the board lands the tile at the end rather than refusing. That is
    not defensiveness: somebody else removing the tile you were dropping in front of is an
    ordinary race, and the end of the list is a place, whereas an error mid-drag is not.
    """
    if not others:
        return 0

    if before_comp_id is None:
        following_index = len(others)
    else:
        found = next(
            (i for i, tile in enumerate(others) if tile.comp_id == before_comp_id), None
        )
        following_index = len(others) if found is None else found

    if following_index == len(others):
        position = others[-1].position + POSITION_GAP
    elif following_index == 0:
        position = others[0].position - POSITION_GAP
    else:
        preceding = others[following_index - 1].position
        following = others[following_index].position
        position = (preceding + following) // 2
        if position <= preceding or position >= following:
            return None

    return None if abs(position) > POSITION_LIMIT else position


def _renumber(tiles: Sequence[SharedBoardTile]) -> None:
    """Spread a board's tiles back out over fresh gaps, keeping their order.

    Runs inside the caller's transaction, so a board is never briefly numbered two ways. Only
    reachable once the gaps are gone, which sixteen drops into one slot is enough to do — the
    path exists because it will run, not because it might.
    """
    for index, tile in enumerate(tiles):
        tile.position = index * POSITION_GAP


def _land(
    session: Session,
    others: Sequence[SharedBoardTile],
    before_comp_id: uuid.UUID | None,
) -> int:
    """A position immediately before ``before_comp_id``, renumbering the board if it takes one."""
    position = _slot_before(others, before_comp_id)
    if position is None:
        _renumber(others)
        session.flush()
        position = _slot_before(others, before_comp_id)
        # After a renumber every gap is ``POSITION_GAP`` wide and every position is small, so
        # there is no second way for this to come back empty.
        assert position is not None
    return position


# --- The collection, under its team -------------------------------------------------------


@team_router.get("/{team_id}/boards", response_model=list[SharedBoardDetail])
def list_shared_boards(
    team_id: uuid.UUID,
    session: Session = Depends(get_session),
    viewer: Viewer = Depends(current_viewer),
) -> list[SharedBoardDetail]:
    """Every shared board on the team, contents and all.

    A viewer's read, like the comp listing: seeing what the team is working on is not editing it.
    """
    access = authorize(session, team_id, viewer, AccessLevel.VIEWER)
    boards = session.scalars(
        select(SharedBoard)
        .where(SharedBoard.team_id == access.team.id)
        .order_by(SharedBoard.created_at, SharedBoard.id)
    ).all()
    return [_present(board, _tiles(session, board)) for board in boards]


@team_router.post("/{team_id}/boards", response_model=SharedBoardDetail, status_code=201)
def create_shared_board(
    team_id: uuid.UUID,
    body: BoardCreate,
    session: Session = Depends(get_session),
    viewer: Viewer = Depends(current_viewer),
    origin: str | None = Depends(origin_client),
) -> SharedBoardDetail:
    """Make a board the whole team can work on.

    Editor, not viewer. ``save_workspace`` is a viewer's write because "arranging your own screen
    is not editing the team's content"; a shared board negates every clause of that sentence, so
    every write here is an editor's and every one of them refuses an archived team.
    """
    access = authorize(session, team_id, viewer, AccessLevel.EDITOR)
    team = live(access)

    existing = session.scalar(
        select(func.count())
        .select_from(SharedBoard)
        .where(SharedBoard.team_id == team.id)
    )
    if existing >= MAX_BOARDS_PER_TEAM:
        # A 422 rather than a 409, and not cosmetically: 409 on a board route already means the
        # team is archived, and a second meaning is a branch no client can make.
        raise HTTPException(
            status_code=422,
            detail=f"A team may have at most {MAX_BOARDS_PER_TEAM} shared boards",
        )

    board = SharedBoard(
        team_id=team.id,
        name=body.name,
        mode="grid",
        created_by_character_id=viewer.character_id,
        created_by_name=viewer.character_name,
    )
    session.add(board)
    session.flush()

    # Dropped rather than refused, and deduplicated in order: the client is sending what was on
    # a personal board, which is a document of ids somebody wrote down earlier.
    reachable = _teams_comp_ids(session, team.id)
    wanted: list[uuid.UUID] = []
    for comp_id in body.tiles:
        if comp_id in reachable and comp_id not in wanted:
            wanted.append(comp_id)
    for index, comp_id in enumerate(wanted):
        session.add(
            SharedBoardTile(
                board_id=board.id,
                comp_id=comp_id,
                position=index * POSITION_GAP,
                added_by_character_id=viewer.character_id,
                added_by_name=viewer.character_name,
            )
        )

    session.commit()
    session.refresh(board)
    _announce(board, KIND_BOARD_CREATED, viewer, origin)
    return _present(board, _tiles(session, board))


# --- The board itself -----------------------------------------------------------------------


@router.get("/{board_id}", response_model=SharedBoardDetail)
def shared_board_detail(
    board_id: uuid.UUID,
    session: Session = Depends(get_session),
    viewer: Viewer = Depends(current_viewer),
) -> SharedBoardDetail:
    board, _ = reach_shared_board(session, board_id, viewer, AccessLevel.VIEWER)
    return _present(board, _tiles(session, board))


@router.patch("/{board_id}", response_model=SharedBoardDetail)
def update_shared_board(
    board_id: uuid.UUID,
    body: BoardPatch,
    session: Session = Depends(get_session),
    viewer: Viewer = Depends(current_viewer),
    origin: str | None = Depends(origin_client),
) -> SharedBoardDetail:
    """Rename it, or change how it draws.

    Absence is read through ``model_fields_set`` rather than through the value, so a request that
    names only ``snap`` leaves the name alone instead of blanking it — two people changing two
    different things must not revert each other.
    """
    board, access = reach_shared_board(session, board_id, viewer, AccessLevel.EDITOR)
    live(access)

    sent = body.model_fields_set
    changed = False
    if "name" in sent and body.name is not None and body.name != board.name:
        board.name = body.name
        changed = True
    if "mode" in sent and body.mode is not None and body.mode != board.mode:
        board.mode = body.mode
        changed = True
    if "snap" in sent and body.snap is not None and body.snap != board.snap:
        board.snap = body.snap
        changed = True

    if not changed:
        # A write that changes nothing writes nothing and tells nobody — ``save_workspace``'s
        # short-circuit, applied to the broadcast as well as to the row.
        return _present(board, _tiles(session, board))

    _touch(board)
    session.commit()
    session.refresh(board)
    _announce(board, KIND_BOARD_CHANGED, viewer, origin)
    return _present(board, _tiles(session, board))


@router.delete("/{board_id}", status_code=204)
def delete_shared_board(
    board_id: uuid.UUID,
    session: Session = Depends(get_session),
    viewer: Viewer = Depends(current_viewer),
    origin: str | None = Depends(origin_client),
) -> Response:
    """Close a shared board, for everybody.

    Editor, and deliberately **not** ``delete_comp``'s creator-or-owner rule. That rule exists
    because deleting somebody's draft is not collaboration — but a board is an arrangement of
    pointers, closing it destroys no work, and requiring the creator would leave a board
    un-closable the moment they left the team.

    It is still the one gesture here whose blast radius is other people's screens, which is why
    the client puts it behind a menu rather than at the same coordinates as a personal board's
    close button.
    """
    board, access = reach_shared_board(session, board_id, viewer, AccessLevel.EDITOR)
    live(access)
    # Read off the row before it goes, as ``delete_comp`` does: afterwards there is no board
    # left to ask, and the revision is what tells a client this event is newer than its screen.
    team_id, gone, revision = board.team_id, board.id, board.revision
    session.delete(board)
    session.commit()
    publish_board(
        team_id,
        KIND_BOARD_DELETED,
        board_id=gone,
        revision=revision,
        actor=viewer.character_name,
        origin=origin,
    )
    return Response(status_code=204)


# --- The tiles on it ------------------------------------------------------------------------


@router.post("/{board_id}/tiles", response_model=SharedBoardDetail)
def add_tile(
    board_id: uuid.UUID,
    body: TileAdd,
    session: Session = Depends(get_session),
    viewer: Viewer = Depends(current_viewer),
    origin: str | None = Depends(origin_client),
) -> SharedBoardDetail:
    """Open a comp on this board.

    **Always 200, and always the whole board** — never 201, and never varying with what happened.
    A comp id the team does not have is dropped rather than refused, so a status that said
    "created" or "not created" would put the oracle in the status line: a caller could learn
    whether an id was real by watching the code change. The board is the response precisely so a
    dropped id has somewhere to be visibly absent from.

    Adding a comp already on the board is not a move. It leaves the tile where it is, for the
    same reason removing an absent one is not an error: two people reaching for the same comp at
    the same moment is ordinary, and the unique index — not a pre-check — is what settles it.
    """
    board, access = reach_shared_board(session, board_id, viewer, AccessLevel.EDITOR)
    live(access)

    tiles = _tiles(session, board)
    if any(tile.comp_id == body.comp_id for tile in tiles):
        return _present(board, tiles)
    if body.comp_id not in _teams_comp_ids(session, board.team_id):
        return _present(board, tiles)
    if len(tiles) >= MAX_TILES_PER_BOARD:
        raise HTTPException(
            status_code=422,
            detail=f"A board may hold at most {MAX_TILES_PER_BOARD} tiles",
        )

    position = _land(session, tiles, body.before_comp_id)
    result = session.execute(
        pg_insert(SharedBoardTile)
        .values(
            id=uuid.uuid4(),
            board_id=board.id,
            comp_id=body.comp_id,
            position=position,
            added_by_character_id=viewer.character_id,
            added_by_name=viewer.character_name,
        )
        # The index is the arbiter, not the check above: between that read and this write
        # somebody else's add can land, and losing that race should leave one tile rather than
        # raise. ``share._mint`` and ``save_workspace``'s upsert make the same choice.
        .on_conflict_do_nothing(index_elements=["board_id", "comp_id"])
    )
    if not result.rowcount:
        session.rollback()
        return _present(board, _tiles(session, board))

    _touch(board)
    session.commit()
    session.refresh(board)
    _announce(board, KIND_BOARD_CHANGED, viewer, origin)
    return _present(board, _tiles(session, board))


def _order_after(
    others: Sequence[SharedBoardTile], moving: SharedBoardTile, position: int
) -> list[uuid.UUID]:
    """The ids a board would serve if ``moving`` took ``position``.

    Used only to notice a move that changes nothing — dropping a tile back where it came from,
    which a drag does constantly, and which should cost neither a revision nor an event on
    everybody else's screen. Comparing the resulting *order* rather than the number is what makes
    that reliable: ``_land`` can hand back a different number for the same place, and after a
    renumber it hands back a different number for every place.
    """
    placed = sorted(
        [*others, moving],
        key=lambda tile: (
            position if tile.id == moving.id else tile.position,
            tile.created_at,
            tile.comp_id,
        ),
    )
    return [tile.id for tile in placed]


@router.patch("/{board_id}/tiles/{comp_id}", response_model=SharedBoardDetail)
def move_tile(
    board_id: uuid.UUID,
    comp_id: uuid.UUID,
    body: TileMove,
    session: Session = Depends(get_session),
    viewer: Viewer = Depends(current_viewer),
    origin: str | None = Depends(origin_client),
) -> SharedBoardDetail:
    """Put a tile somewhere else on the board.

    One UPDATE, on the moved tile alone: sparse positions mean a move takes a number between its
    new neighbours rather than pushing everybody along, which is what makes two people moving two
    different tiles two independent writes. A test asserts no neighbour's row was touched.
    """
    board, access = reach_shared_board(session, board_id, viewer, AccessLevel.EDITOR)
    live(access)

    tiles = _tiles(session, board)
    moving = next((tile for tile in tiles if tile.comp_id == comp_id), None)
    # A tile somebody else has just closed, or a comp that was never on this board. Neither is an
    # error mid-drag; the board that comes back says what is actually there.
    if moving is None or "before_comp_id" not in body.model_fields_set:
        return _present(board, tiles)
    if body.before_comp_id == comp_id:
        return _present(board, tiles)

    others = [tile for tile in tiles if tile.id != moving.id]
    position = _land(session, others, body.before_comp_id)
    if _order_after(others, moving, position) == [tile.id for tile in tiles]:
        return _present(board, tiles)

    moving.position = position
    _touch(board)
    session.commit()
    session.refresh(board)
    _announce(board, KIND_BOARD_CHANGED, viewer, origin)
    return _present(board, _tiles(session, board))


@router.delete("/{board_id}/tiles/{comp_id}", status_code=204)
def remove_tile(
    board_id: uuid.UUID,
    comp_id: uuid.UUID,
    session: Session = Depends(get_session),
    viewer: Viewer = Depends(current_viewer),
    origin: str | None = Depends(origin_client),
) -> Response:
    """Close a tile, for everybody on the board.

    **Idempotent 204**, and deliberately unlike ``revoke_share``'s 404: two people closing the
    same tile is an ordinary thing for two people on one board to do, and answering the second
    one with an error would surface a race as a failure in the middle of a gesture.

    The one op that does not answer with the board, because 204 has no body to put it in. The
    client invalidates and re-reads through the same coalescing path a remote event takes, so
    this costs a round trip and no new machinery.
    """
    board, access = reach_shared_board(session, board_id, viewer, AccessLevel.EDITOR)
    live(access)

    result = session.execute(
        delete(SharedBoardTile).where(
            SharedBoardTile.board_id == board.id, SharedBoardTile.comp_id == comp_id
        )
    )
    if not result.rowcount:
        session.rollback()
        return Response(status_code=204)

    _touch(board)
    session.commit()
    session.refresh(board)
    _announce(board, KIND_BOARD_CHANGED, viewer, origin)
    return Response(status_code=204)
