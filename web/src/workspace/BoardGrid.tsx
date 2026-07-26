// The board itself: a responsive grid of tiles plus the ghost tile that makes another one.
//
// This component holds **no per-comp state**, and that is the whole design. Its props are a
// list of ids and callbacks that take an id — never a closure bound per item — so editing a
// comp sets state inside one `CompTileHost` and re-renders that subtree alone. The other
// nineteen tiles are not re-rendered, which means they are also not re-judged, and §6.7 is
// satisfied by the shape rather than by a discipline about `React.memo` that nothing checks.

import { useCallback, useEffect, useMemo, useRef } from 'react'

import CompTileHost from '../comps/CompTileHost'
import type { TileDrag } from '../comps/CompTileHost'
import type { TagVocabulary } from '../comps/tag-model'
import type { CompDetail } from '../comps/types'
import { inTextField, isPaste } from '../lib/keys'
import GhostTile from './GhostTile'
import type { TileFork } from './GhostTile'
import { getCopied } from './hull-transfer'
import type { CarriedRows } from './hull-transfer'
import { beginReorder } from './reorder'
import type { Reorder } from './reorder'

interface Props {
  readonly boardId: string
  readonly boardName: string
  readonly compIds: readonly string[]
  readonly creating: boolean
  /** The comp the ghost tile just made, so its tile opens with the cursor in its name. */
  readonly newCompId: string | null
  readonly onClose: (compId: string) => void
  readonly onCreate: () => void
  /**
   * Take rows out of one comp into a new one. The board's rather than a tile's, because the
   * gesture ends outside every tile: the rows are picked up in one and put down either on the
   * new-comp tile or nowhere in particular, with Ctrl+V. Nothing between the two ends belongs
   * to the tile they came from, so the board is where both routes meet.
   *
   * Optional, and a board given neither this nor the two below still draws every tile — it
   * simply offers no way to fork one, which is what keeps a bare `<BoardGrid>` a complete
   * board.
   */
  readonly onPort?: (compId: string, positions: readonly number[]) => void
  /**
   * The whole comp, which is the all-rows case of the same operation (§4.1c).
   *
   * Reached two ways: the tile's own control, and carrying the tile onto the new-comp tile —
   * where a drag that would otherwise rearrange the board derives a comp instead.
   */
  readonly onFork?: (compId: string) => void
  /**
   * Put a comp's tile at a given position on this board.
   *
   * The board's for the same reason porting is: the gesture begins in one tile and ends in
   * another, and the arrangement it changes belongs to neither. Optional like the rest — a
   * board given none of these still draws every tile, it simply cannot be rearranged.
   */
  readonly onReorder?: (compId: string, toIndex: number) => void
  readonly vocabulary?: TagVocabulary
  readonly onCompChanged?: (comp: CompDetail) => void
}

export default function BoardGrid({
  boardId,
  boardName,
  compIds,
  creating,
  newCompId,
  onClose,
  onCreate,
  onPort,
  onFork,
  onReorder,
  vocabulary,
  onCompChanged,
}: Props) {
  const grid = useRef<HTMLElement>(null)
  /** The tile being carried, if one is. A ref and not state: the whole point of `reorder.ts`
   *  is that dragging one tile over twenty others re-renders none of them. */
  const carrying = useRef<Reorder | null>(null)
  /** That tile's cell's flush, travelling with it. Only one of the two landings needs it —
   *  a fork reads the comp's rows on the server — but it is handed over at the lift, because
   *  which landing this turns out to be is not known until it is let go of. */
  const settling = useRef<(() => Promise<void>) | null>(null)

  useEffect(() => {
    // Switching boards keeps the scroll offset otherwise, so the second board opens
    // half-way down at whatever depth the first one was left at.
    if (grid.current) grid.current.scrollTop = 0
  }, [boardId])

  /**
   * Rows out into a comp of their own — the whole of what a drop on the ghost tile and a
   * Ctrl+V both do, so they are one operation rather than two that agree by accident.
   *
   * Settled first, and this is the one place that has to be. A port is a fork, and a fork
   * reads the source comp's rows on the *server* — so a port taken inside that tile's 600 ms
   * debounce would fork the comp as it was before the last edit, and the server drops row
   * numbers it does not recognise rather than refusing them. The flush travels with the rows
   * because no comp's editing state rises above its own tile, so there is nothing here to
   * reach into.
   */
  const port = useCallback(
    (rows: CarriedRows) => {
      if (!onPort) return
      void rows.settle().then(() => onPort(rows.offer.fromCompId, rows.positions))
    },
    [onPort],
  )

  /**
   * Picking a tile up and letting go of it, which is all a cell has to say about the matter.
   *
   * Where it goes in between is the board's alone. A cell that answered `dragover` would be
   * answering "the cursor is over *me*", which is the browser's hit test — and hit-testing
   * reads a tile's transformed box, so a tile part-way through sliding somewhere would claim
   * a cursor it is only passing beneath. `reorder.ts` decides from coordinates instead.
   *
   * Both answer from a ref rather than from state, so the only React update in the whole
   * gesture is the drop.
   */
  const tileDrag = useMemo<TileDrag | undefined>(() => {
    if (!onReorder) return undefined
    return {
      lift(compId, settle) {
        if (!grid.current) return false
        carrying.current = beginReorder(grid.current, compId)
        settling.current = settle
        return carrying.current !== null
      },
      end() {
        // After a drop this finds nothing, which is the point: the two arrive in that order
        // and only one of them means "put it back".
        carrying.current?.cancel()
        carrying.current = null
        settling.current = null
      },
    }
  }, [onReorder])

  /**
   * The other place a carried tile can be let go of: the new-comp tile, where it forks.
   *
   * Gated on `onFork` the way `tileDrag` is on `onReorder`, so a board that cannot fork simply
   * has a new-comp tile that refuses tiles — the browser then declines the drop rather than a
   * handler having to.
   */
  const tileFork = useMemo<TileFork | undefined>(() => {
    if (!onFork) return undefined
    return {
      carrying: () => carrying.current !== null,
      hover: () => {
        carrying.current?.home()
      },
      drop() {
        const held = carrying.current
        const settle = settling.current
        if (!held || !settle) return
        // Home, animated, where a reorder's drop settles: a fork leaves the board's arrangement
        // exactly as it was, so the tile goes back to the space it came out of.
        held.cancel()
        carrying.current = null
        settling.current = null
        // Settled first, for the reason `port` is: a fork reads the comp's rows on the server,
        // and this one may have been edited a keystroke ago.
        void settle().then(() => onFork(held.carried))
      },
    }
  }, [onFork])

  /** Let go of, wherever on the board that was. */
  const drop = useCallback(() => {
    const held = carrying.current
    if (!held || !onReorder) return false
    const toIndex = held.order().indexOf(held.carried)
    // A tile picked up and put back down where it was is not a rearrangement, and this is the
    // board saying so rather than handing the question upstream. The layout it would produce
    // is equal to the last one but not the *same* object, so it survives every reference check
    // between here and the write and is caught only by a full comparison against what was
    // persisted — which is a real answer, and a long way from the gesture that asked. A board
    // of one tile is this case every time.
    const moved = held.moved()
    // Left where it is being shown rather than animated home, because the commit below is
    // about to put the DOM in the same order — in this same event, so the arrangement it
    // replaces is never painted.
    held.settle()
    carrying.current = null
    settling.current = null
    if (moved && toIndex !== -1) onReorder(held.carried, toIndex)
    return true
  }, [onReorder])

  useEffect(() => {
    // A board that cannot fork has nowhere to paste to, and takes no listener at all.
    if (!onPort) return
    function onKeyDown(event: KeyboardEvent) {
      if (!isPaste(event) || inTextField(event.target)) return
      const rows = getCopied()
      if (!rows) return
      // Only once there is something to paste, so Ctrl+V still reaches the browser everywhere
      // else on the board.
      event.preventDefault()
      port(rows)
    }
    // On the document rather than the grid: the rows land on this board wherever the person
    // happens to be looking, and only one board is rendered at a time. Requiring focus inside
    // the grid would mean a paste that silently does nothing after clicking a tab.
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onPort, port])

  return (
    // The board is somewhere a carried tile may be let go of, which is what the two handlers
    // below are for and what the rule objects to. It is the gaps between the tiles rather than
    // a control of its own — a region of the page, not a widget — and there is nothing to give
    // it a role or a name as, because there is nothing here to operate. What a drag owes
    // instead is that its state can be read rather than inferred, which is `data-reordering`
    // and `data-tile-order` on this element. The cell carries the same note at more length.
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <section
      className="wsgrid"
      data-testid="board-grid"
      data-board-id={boardId}
      data-comp-count={compIds.length}
      // The order the tiles are *drawn* in, which while one is being carried is not the order
      // they sit in the DOM — `reorder.ts` re-sequences them with `order` and rewrites this to
      // match. React writes it here at rest and again when a drop changes `compIds`, and never
      // in between, because it only writes an attribute whose value it has changed.
      data-tile-order={compIds.join(',')}
      data-reordering="false"
      aria-label={boardName}
      ref={grid}
      onDragOver={(event) => {
        // Every `dragover` in the whole gesture arrives here, whether it started on a tile or
        // in one of the gaps between them — a board of unequal tiles has a lot of grid that is
        // not a tile, below the short ones and to the right of the last row, and a drag
        // crossing those uncancelled reads as refused and gives the gesture up on the way past.
        //
        // Where the cursor is, not what it is over. The board hands the coordinates down and
        // `reorder.ts` works out which slot they fall in from the tiles' resting places, so a
        // tile still sliding into position cannot be mistaken for one the cursor has reached.
        const held = carrying.current
        if (!held) return
        event.preventDefault()
        // Reset to its initial value on every event, so it is set on every event.
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
        held.over(event.clientX, event.clientY)
      }}
      onDrop={(event) => {
        // Reached by bubbling from a tile as well as raised here directly, and either way it
        // lands wherever it is currently being shown.
        if (drop()) event.preventDefault()
      }}
    >
      {compIds.map((compId) => (
        <CompTileHost
          key={compId}
          compId={compId}
          onClose={onClose}
          autoFocusName={compId === newCompId}
          onFork={onFork}
          vocabulary={vocabulary}
          onCompChanged={onCompChanged}
          tileDrag={tileDrag}
        />
      ))}

      <GhostTile
        onCreate={onCreate}
        busy={creating}
        onPortDropped={onPort ? port : undefined}
        tileFork={tileFork}
      />

      {compIds.length === 0 && (
        <p className="board-empty" data-testid="board-empty">
          Nothing open on this board yet — open a comp from the library, or start a new one.
        </p>
      )}
    </section>
  )
}
