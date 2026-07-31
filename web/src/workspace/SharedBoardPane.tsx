// A shared board, drawn by the same grid as a personal one.
//
// Everything visual is `BoardGrid`'s — a shared board is a board, and a second component drawing
// tiles would be the expensive half of that file copied for the sake of where its arrangement is
// stored. What lives here is the difference: the ops, the latch that keeps a gesture safe while
// other people are writing, and the state node the e2e suite waits on instead of sleeping.
//
// **Grid only in this slice.** No `onPlace`, no `onPlaceMany` — a board given neither simply
// cannot be placed on, which is the same idiom a narrow viewport already uses. Withholding them
// is not tidiness: `onPlaceMany` fires for tiles that have arrived without a place, so on a
// shared board every viewer would send a place op for somebody else's arriving tile.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { CompDetail } from '../comps/types'
import type { TagVocabulary } from '../comps/tag-model'
import { reportPresence } from '../live/presence'
import BoardGrid from './BoardGrid'
import PresenceBar from './PresenceBar'
import TileWatchers from './TileWatchers'
import type { CarryWatch } from './carry'
import { moveTile } from './layout'
import { closeOnBoard, moveOnBoard, type OpFailure } from './shared-board-ops'
import { holdBoard, releaseBoard } from './shared-boards'
import { neighbourAfter, type SharedBoardDoc } from './shared-doc'

interface Props {
  readonly board: SharedBoardDoc
  readonly creating: boolean
  readonly newCompId: string | null
  readonly onCreate: () => void
  readonly onPort?: (compId: string, positions: readonly number[]) => void
  readonly onFork?: (compId: string) => void
  readonly onDelete?: (compId: string) => void
  readonly deletableCompIds?: ReadonlySet<string>
  readonly vocabulary?: TagVocabulary
  readonly onCompChanged?: (comp: CompDetail) => void
  /** Whether this character may rearrange it. A viewer reads the board and writes nothing. */
  readonly editable: boolean
}

export default function SharedBoardPane({
  board,
  creating,
  newCompId,
  onCreate,
  onPort,
  onFork,
  onDelete,
  deletableCompIds,
  vocabulary,
  onCompChanged,
  editable,
}: Props) {
  const [failure, setFailure] = useState<OpFailure>(null)
  const [busy, setBusy] = useState(0)
  /** The board element, handed up by `BoardGrid`, for the presence listeners below to hang off. */
  const boardRef = useRef<HTMLElement | null>(null)

  const compIds = useMemo(() => board.tiles.map((tile) => tile.compId), [board])

  const run = useCallback(async (op: Promise<OpFailure>) => {
    setBusy((count) => count + 1)
    try {
      setFailure(await op)
    } finally {
      setBusy((count) => count - 1)
    }
  }, [])

  const carryWatch = useMemo<CarryWatch>(
    () => ({
      begin: () => holdBoard(board.id),
      end: () => releaseBoard(board.id),
    }),
    [board.id],
  )

  /**
   * A drop, sent as one op the moment it happens.
   *
   * The index the grid hands back is turned into a **neighbour** here rather than sent as one:
   * an index stops meaning the same place the moment somebody else inserts a tile, and the list
   * it indexes into is the one *this* client last saw. `moveTile` computes the order the drop
   * produced, and the tile that ends up after the carried one is what the server is told —
   * null when it landed at the end.
   *
   * No debounce. The personal layout's 800 ms belongs to a document that is one person's
   * screen; here the gesture is the debounce, and a timer between letting go and everybody
   * seeing it is the one place latency is felt.
   */
  const onReorder = useCallback(
    (compId: string, toIndex: number) => {
      const next = moveTile(compIds, compId, toIndex)
      void run(moveOnBoard(board.id, compId, neighbourAfter(next, compId)))
    },
    [board.id, compIds, run],
  )

  const onClose = useCallback(
    (compId: string) => {
      void run(closeOnBoard(board.id, compId))
    },
    [board.id, run],
  )

  /**
   * Say where this tab is: which board, and which tile on it.
   *
   * **The signal is four native listeners on the board element, not handlers on twenty tiles.**
   * `boardRef` is the same reference "tidy up" already asks for, and hanging the listeners off it
   * keeps `BoardGrid` and `CompTileHost` untouched by presence entirely — a hover is not a React
   * update anywhere except inside the one footer leaf that draws the result, which is the same
   * bargain `reorder.ts` makes for a drag.
   *
   * **Focus outranks the pointer.** A mouse comes to rest wherever somebody happened to leave it;
   * a caret is where they are working. So a tile with focus inside it is where you are, whatever
   * the pointer is over, and a keyboard-only colleague shows up on tiles like anybody else.
   *
   * **And where you are is sticky.** Letting go of a tile is not the same as going somewhere
   * else: a board of unequal tiles is mostly gaps, so a pointer crossing from one tile to another
   * passes over nothing on the way, and clicking a gap or reaching for the rail is not a
   * statement about comps at all. Reporting the truthful "on no tile" for each of those made
   * everybody's mark blink out and back several times a minute, which reads as the roster being
   * broken rather than as anybody moving. So the last tile somebody was *actually* on stands
   * until they are on another one.
   *
   * The one case that stays blank is somebody who has only just arrived, because there is no last
   * tile to stand on and inventing one would be a claim rather than a stale fact.
   *
   * The throttle lives inside `reportPresence`, so every caller gets the ceiling for free, and
   * this tab's own mark is applied there synchronously — the round trip is news for other people
   * and never for the person who made the move.
   */
  useEffect(() => {
    reportPresence(board.teamId, board.id, null)

    const surface = boardRef.current
    let hovered: string | null = null
    let focused: string | null = null
    /** The last tile this tab was genuinely on. Null only until it has been on one. */
    let resting: string | null = null

    const settle = () => {
      // The whole of the stickiness: a live signal moves the mark, and the absence of one leaves
      // it where it was. Deliberately not "clear it after a while" — a timer would put the blink
      // back on a delay, and there is nothing a blank mark tells anybody that a stale one does
      // not tell them better.
      const here = focused ?? hovered
      if (here) resting = here
      reportPresence(board.teamId, board.id, resting)
    }

    const onOver = (event: PointerEvent) => {
      // Null in the gaps between tiles, which a board of unequal tiles has a lot of — below the
      // short ones and to the right of the last row. `settle` decides what that means.
      hovered = tileUnder(event.target)
      settle()
    }
    const onLeave = () => {
      // `pointerover` cannot say this: leaving the board altogether is the one move that is not
      // followed by arriving somewhere else inside it.
      hovered = null
      settle()
    }
    const onFocusIn = (event: FocusEvent) => {
      focused = tileUnder(event.target)
      settle()
    }
    const onFocusOut = (event: FocusEvent) => {
      // `relatedTarget` on a focusout *is* the element about to take focus, so this is complete
      // on its own — the focusin that follows only confirms it.
      focused = tileUnder(event.relatedTarget)
      settle()
    }

    surface?.addEventListener('pointerover', onOver)
    surface?.addEventListener('pointerleave', onLeave)
    surface?.addEventListener('focusin', onFocusIn)
    surface?.addEventListener('focusout', onFocusOut)

    return () => {
      surface?.removeEventListener('pointerover', onOver)
      surface?.removeEventListener('pointerleave', onLeave)
      surface?.removeEventListener('focusin', onFocusIn)
      surface?.removeEventListener('focusout', onFocusOut)
      // Left the board. Reported rather than left to the stream's own close, because switching
      // tabs does not close the stream and a stale entry would say somebody is where they are
      // not — the one kind of wrong a roster must not be.
      reportPresence(board.teamId, null, null)
    }
  }, [board.teamId, board.id])

  /**
   * The footer mark for one tile — a leaf that subscribes to that tile's watchers and nothing
   * else, so a beat re-renders it alone and not the board around it.
   */
  const renderWatchers = useCallback(
    (compId: string) => <TileWatchers boardId={board.id} compId={compId} />,
    [board.id],
  )

  return (
    <>
      <PresenceBar boardId={board.id} />

      <BoardGrid
        boardId={board.id}
        boardRef={boardRef}
        renderWatchers={renderWatchers}
        boardName={board.name}
        compIds={compIds}
        creating={creating}
        newCompId={newCompId}
        onClose={onClose}
        onCreate={onCreate}
        onPort={onPort}
        onFork={onFork}
        onDelete={onDelete}
        deletableCompIds={deletableCompIds}
        // A viewer gets a board that draws every tile and cannot be rearranged, which is what a
        // board with no `onReorder` already is. No second guard downstream to remember.
        onReorder={editable ? onReorder : undefined}
        carryWatch={carryWatch}
        vocabulary={vocabulary}
        onCompChanged={onCompChanged}
        mode="grid"
      />

      {/* Waited on rather than slept through, the same way `data-layout-state` is for the
          personal board — and needed here for a sharper reason: a shared board has no debounce,
          so "settled" is the only observable difference between an op in flight and one that
          has landed. Hidden, so it is automation vocabulary rather than a report to a person. */}
      <p
        hidden
        data-testid="shared-board-state"
        data-board-state={busy > 0 ? 'saving' : 'idle'}
        data-board-revision={board.revision}
      >
        {busy > 0 ? 'Saving board…' : 'Board saved'}
      </p>

      {failure && (
        <p className="err" data-testid="shared-board-error" role="alert">
          {failure.message}
        </p>
      )}
    </>
  )
}

/**
 * Which tile an event landed in, from the same attribute everything else on the board reads.
 *
 * `data-comp-id` is written by `CompTileHost` and is what `flip.ts` and the grid's own mousedown
 * already navigate by, so this adds no vocabulary. Null for the gaps between tiles, for the ghost
 * tile, and for anything outside the board — all three of which mean the same thing here.
 */
function tileUnder(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null
  return target.closest<HTMLElement>('[data-comp-id]')?.dataset.compId ?? null
}
