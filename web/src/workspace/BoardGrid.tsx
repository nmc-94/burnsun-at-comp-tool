// The board itself: a responsive grid of tiles plus the ghost tile that makes another one.
//
// This component holds **no per-comp state**, and that is the whole design. Its props are a
// list of ids and callbacks that take an id — never a closure bound per item — so editing a
// comp sets state inside one `CompTileHost` and re-renders that subtree alone. The other
// nineteen tiles are not re-rendered, which means they are also not re-judged, and §6.7 is
// satisfied by the shape rather than by a discipline about `React.memo` that nothing checks.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { CSSProperties, RefObject } from 'react'

import CompTileHost from '../comps/CompTileHost'
import type { TileDrag } from '../comps/CompTileHost'
import TrashZone from './TrashZone'
import type { TileTrash } from './TrashZone'
import type { TagVocabulary } from '../comps/tag-model'
import type { CompDetail } from '../comps/types'
import { inTextField, isPaste } from '../lib/keys'
import { canvasFor, tileHeights, useBoardSize } from './board-metrics'
import type { Canvas } from './board-metrics'
import type { Carried, Float, Reorder } from './carry'
import { measure, play } from './flip'
import type { Box } from './flip'
import { beginFloat, gripOf } from './float-drag'
import GhostTile from './GhostTile'
import type { TileFork } from './GhostTile'
import { getCopied } from './hull-transfer'
import type { CarriedRows } from './hull-transfer'
import { FALLBACK_H, MAX_COORD, MIN_TILE_W, nextFreePlace } from './place'
import type { Bounds } from './place'
import { beginReorder } from './reorder'
import type { BoardMode, Place } from './types'

/** Shared so an empty board does not build a new map on every render and re-run the memo. */
const EMPTY_PLACES: ReadonlyMap<string, Place> = new Map()

/** Where a tile may go before the canvas has been measured — everywhere the server will
 *  store. Only reachable on the first frame of a board that has not laid out yet. */
const EVERYWHERE: Bounds = { minX: 0, minY: 0, maxX: MAX_COORD, maxY: MAX_COORD }

/** Which engine has hold of the tile. The one question `carry.ts` deliberately does not
 *  answer, asked in the one place that has to know: the drop. */
const isFloat = (held: Carried): held is Float => 'place' in held

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
   * Delete a comp outright, from the tile's footer or from the bin in the corner.
   *
   * Whose confirmation, if any, and whose undo is the board's caller's business — this only
   * says which gesture happened.
   */
  readonly onDelete?: (compId: string) => void
  /** Which of `compIds` this character may delete, so a tile knows whether to draw the control.
   *  Absent means none of them. */
  readonly deletableCompIds?: ReadonlySet<string>
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
  /**
   * How this board draws its tiles.
   *
   * The two modes share everything except where a tile ends up, which is why this is a branch
   * here rather than a second component. What a floating board would have had to copy is the
   * expensive half of this file — the Ctrl+V listener and `port()`, which the note above says
   * are deliberately one operation rather than "two that agree by accident"; the whole
   * fork-onto-ghost wiring with its settle-before-fork race; and the id-taking `CompTileHost`
   * call that *is* §6.7 expressed as a shape.
   *
   * Defaulted, like the callbacks around it: a board rendered with an id, a name and a list of
   * comps is a grid, which is what a board was before it could be anything else.
   */
  readonly mode?: BoardMode
  /** Where each tile sits, while floating. Ignored by a grid. */
  readonly places?: ReadonlyMap<string, Place>
  /** The board element, for the one control that acts on it from outside — "tidy up", which
   *  needs the same measured heights this board draws itself from. */
  readonly boardRef?: RefObject<HTMLElement | null>
  /**
   * Tiles that arrived without a position, placed.
   *
   * Rendered first and committed after, in one call: the board is the only thing that knows
   * how tall its tiles are, and a comp opened onto a canvas has to land *somewhere* before
   * anyone can be asked to save where.
   */
  readonly onPlaceMany?: (places: ReadonlyMap<string, Place>) => void
  /**
   * Where a tile was put down.
   *
   * The canvas's counterpart to `onReorder`, and optional the same way: a floating board given
   * neither still draws every tile, it simply cannot be rearranged.
   */
  readonly onPlace?: (compId: string, place: Place) => void
  /** Whether a tile put down lands on the step. */
  readonly snap?: boolean
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
  onDelete,
  deletableCompIds,
  onReorder,
  vocabulary,
  onCompChanged,
  mode = 'grid',
  places,
  boardRef,
  onPlaceMany,
  onPlace,
  snap = true,
}: Props) {
  const grid = useRef<HTMLElement>(null)
  /**
   * One element, two holders.
   *
   * The board keeps its own reference and hands the same one up, so "tidy up" — which runs from
   * a control outside the board — measures exactly what is drawn rather than forming a second
   * opinion about it. Written through a callback rather than by picking whichever ref was
   * passed, so `grid` stays one stable object: every memo and effect below depends on it, and a
   * ref that changed identity with a prop would re-run all of them.
   */
  const attach = useCallback(
    (element: HTMLElement | null) => {
      grid.current = element
      if (boardRef) boardRef.current = element
    },
    [boardRef],
  )
  const floating = mode === 'floating'
  /** Where the tiles were at the last commit, and which way they were being drawn — the two
   *  halves of a FLIP that spans a mode change. */
  const boxes = useRef<Map<string, Box> | null>(null)
  const drawnMode = useRef<BoardMode>(mode)
  /**
   * Where the last press landed inside the tile it landed on.
   *
   * Read at `mousedown`, which bubbles here from the cell, because that is the only moment the
   * offset from the cursor to the tile's corner exists — `dragstart` fires afterwards and
   * `TileDrag.lift` carries no coordinates. Doing it here rather than widening that interface
   * is what keeps `CompTileHost` untouched by the whole of this.
   */
  const gripped = useRef<Place | null>(null)
  /** The canvas as of the last render, for the engine to read at the moment of a lift — a
   *  gesture starts in an event handler, which the render's own `canvas` is not in scope of. */
  const canvasRef = useRef<Canvas | null>(null)
  /** The tile being carried, if one is. A ref and not state: the whole point of `reorder.ts`
   *  is that dragging one tile over twenty others re-renders none of them. */
  const carrying = useRef<Reorder | Float | null>(null)
  /** That tile's cell's flush, travelling with it. Only one of the two landings needs it —
   *  a fork reads the comp's rows on the server — but it is handed over at the lift, because
   *  which landing this turns out to be is not known until it is let go of. */
  const settling = useRef<(() => Promise<void>) | null>(null)

  useEffect(() => {
    // Switching boards keeps the scroll offset otherwise, so the second board opens
    // half-way down at whatever depth the first one was left at — or, on a canvas, at
    // whatever corner of it the first board was last panned to.
    if (!grid.current) return
    grid.current.scrollTop = 0
    grid.current.scrollLeft = 0
  }, [boardId])

  const size = useBoardSize(grid, floating)
  const canvas = useMemo(
    () => (floating ? canvasFor(size, places ?? EMPTY_PLACES, tileHeights(grid.current)) : null),
    [floating, size, places, grid],
  )
  canvasRef.current = canvas

  /**
   * Where each tile is *drawn*: where it was last put down, and for one that has only just
   * arrived, somewhere nothing else is.
   *
   * The gap-fill is here rather than in the toggle because the boxes are here — only the board
   * knows how tall its tiles came out. It is committed rather than left as a render-time
   * answer, because a board that drew one arrangement and saved another would lose the
   * difference on the next reload.
   */
  const drawn = useMemo(() => {
    if (!canvas) return null
    const filled = new Map(places ?? EMPTY_PLACES)
    const missing: string[] = []
    const heights = tileHeights(grid.current)
    for (const compId of compIds) {
      if (filled.has(compId)) continue
      const placed = [...filled].map(([id, place]) => ({
        place,
        height: heights.get(id) ?? FALLBACK_H,
      }))
      filled.set(compId, nextFreePlace(placed, canvas.tileWidth, canvas.columns))
      missing.push(compId)
    }
    return { filled, missing }
  }, [canvas, places, compIds, grid])

  useEffect(() => {
    // Cannot loop: every commit gives a tile a place, so the set of placeless tiles only
    // ever shrinks.
    if (!drawn || drawn.missing.length === 0 || !onPlaceMany) return
    onPlaceMany(new Map(drawn.missing.map((compId) => [compId, drawn.filled.get(compId)!])))
  }, [drawn, onPlaceMany])

  /**
   * The board changing shape, animated with the drag's own motion.
   *
   * A FLIP across a mode change: the tiles are already in their new places by the time this
   * runs, so `from` has to be the measurement taken at the previous commit — which is what the
   * bookkeeping pass at the bottom keeps. `flip.ts` is shared with `reorder.ts` so a board
   * rearranging itself and a board rearranged by hand are the same motion rather than two that
   * look alike.
   *
   * Measured on every commit rather than on a dependency list. It is one forced layout over a
   * handful of elements, at a point in the frame where layout is computed anyway, and the
   * alternative is a list that has to name every prop that can move a tile — including the
   * board's own width, which is not a prop at all.
   */
  useLayoutEffect(() => {
    const container = grid.current
    if (!container) return
    const tiles = new Map<string, HTMLElement>()
    for (const tile of container.querySelectorAll<HTMLElement>('[data-comp-id]')) {
      if (tile.dataset.compId) tiles.set(tile.dataset.compId, tile)
    }
    const scroll = { left: container.scrollLeft, top: container.scrollTop }
    const changed = drawnMode.current !== mode
    const was = changed ? boxes.current : null
    const now = measure(tiles, scroll, changed)
    if (was) play(tiles, was, now)
    drawnMode.current = mode
    boxes.current = now
  })

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
    // One object either way, and the only thing that differs is which engine takes hold. What
    // the board does with a tile in flight — `dragover`, the drop guard, handing it to the
    // new-comp tile to fork — is `carry.ts`'s interface and branches nowhere.
    if (floating ? !onPlace : !onReorder) return undefined
    return {
      lift(compId, settle) {
        if (!grid.current) return false
        carrying.current = floating
          ? beginFloat(grid.current, compId, {
              snap,
              bounds: canvasRef.current?.extent.bounds ?? EVERYWHERE,
              // Recorded at `mousedown`, several events before anything asks: the offset from
              // the cursor to the tile's corner is only knowable while the press is happening,
              // and without it the tile jumps so that its corner meets the cursor on drop.
              grip: gripped.current,
              tile: {
                width: canvasRef.current?.tileWidth ?? MIN_TILE_W,
                height: FALLBACK_H,
              },
            })
          : beginReorder(grid.current, compId)
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
  }, [onReorder, onPlace, floating, snap, grid])

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
    if (!held) return false

    if (isFloat(held)) {
      // Where, rather than which slot — the whole of the difference between the two boards,
      // and the only place in this file that has to know which one it is on.
      const moved = held.moved()
      const at = held.place()
      held.settle()
      carrying.current = null
      settling.current = null
      // Raised as it lands, not as it is picked up: the tiles are drawn in list order and the
      // last one paints on top, so "bring to front" is the move that already exists. One
      // commit, both facts — the arrangement and the stacking are the same list.
      if (moved) onPlace?.(held.carried, at)
      return true
    }

    if (!onReorder) return false
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
  }, [onReorder, onPlace])

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

  const tiles = compIds.map((compId) => (
    <CompTileHost
      key={compId}
      compId={compId}
      onClose={onClose}
      autoFocusName={compId === newCompId}
      onFork={onFork}
      onDelete={deletableCompIds?.has(compId) ? onDelete : undefined}
      vocabulary={vocabulary}
      onCompChanged={onCompChanged}
      tileDrag={tileDrag}
      place={drawn?.filled.get(compId)}
    />
  ))

  const ghost = (
    <GhostTile
      onCreate={onCreate}
      busy={creating}
      onPortDropped={onPort ? port : undefined}
      tileFork={tileFork}
    />
  )

  /**
   * Carrying a tile onto the bin, which deletes the comp rather than moving it.
   *
   * Deliberately unlike `tileFork` above in one respect: it does not settle the tile's
   * outstanding edit before acting. A fork reads the comp's rows on the server and so must not
   * run ahead of the last keystroke; this asks for the comp to stop existing, and flushing an
   * edit into it first would only widen the window in which the write and the delete collide.
   * What the deletion waits for instead is that write *settling*, on the far side — see
   * `comps/pending-delete.ts`.
   */
  const tileTrash = useMemo<TileTrash | undefined>(() => {
    if (!onDelete) return undefined
    return {
      carrying: () => carrying.current !== null && deletableCompIds?.has(carrying.current.carried) === true,
      hover: () => {
        carrying.current?.home()
      },
      drop() {
        const held = carrying.current
        if (!held) return
        // Home first, as a fork's drop does: whether the comp survives is decided elsewhere —
        // a confirmation may still refuse, and Ctrl+Z may still take it back — so the board's
        // arrangement is left exactly as it was rather than half-committed to a landing.
        held.cancel()
        carrying.current = null
        settling.current = null
        onDelete(held.carried)
      },
    }
  }, [onDelete, deletableCompIds])

  const trash = <TrashZone tileTrash={tileTrash} />

  const nothingOpen = compIds.length === 0 && (
    <p className="board-empty" data-testid="board-empty">
      Nothing open on this board yet — open a comp from the library, or start a new one.
    </p>
  )

  const board = (
    // The board is somewhere a carried tile may be let go of, which is what the two handlers
    // below are for and what the rule objects to. It is the gaps between the tiles rather than
    // a control of its own — a region of the page, not a widget — and there is nothing to give
    // it a role or a name as, because there is nothing here to operate. What a drag owes
    // instead is that its state can be read rather than inferred, which is `data-reordering`
    // and `data-tile-order` on this element. The cell carries the same note at more length.
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <section
      className={floating ? 'wsfloat' : 'wsgrid'}
      data-testid="board-grid"
      data-board-id={boardId}
      data-board-mode={mode}
      data-comp-count={compIds.length}
      // The order the tiles are *drawn* in, which while one is being carried is not the order
      // they sit in the DOM — `reorder.ts` re-sequences them with `order` and rewrites this to
      // match. React writes it here at rest and again when a drop changes `compIds`, and never
      // in between, because it only writes an attribute whose value it has changed.
      data-tile-order={compIds.join(',')}
      data-reordering="false"
      aria-label={boardName}
      ref={attach}
      onMouseDown={(event) => {
        // Bubbles up from the cell, where `byHandle` has already decided whether this press
        // arms a drag at all. Recorded either way and read only if one starts, so this stays a
        // measurement rather than a second opinion about what a press means.
        const tile =
          event.target instanceof Element
            ? event.target.closest<HTMLElement>('[data-comp-id]')
            : null
        gripped.current = tile ? gripOf(tile, event.clientX, event.clientY) : null
      }}
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
      {floating ? (
        // A surface the size of the canvas, so the scroller above has something to scroll and
        // the tiles have something to be positioned against. Its width and height are the only
        // two numbers on a floating board that come from `canvas-extent.ts` — which is what
        // makes that module the one place the canvas's size is decided.
        <div
          className="wsfloat-surface"
          data-testid="board-surface"
          style={{ width: canvas?.extent.width, height: canvas?.extent.height }}
        >
          {tiles}
        </div>
      ) : (
        tiles
      )}

      {/* Inside the grid, where it is the last cell and a drop on it forks. A canvas keeps it
          outside the scroller instead — see below — because a new-comp tile that scrolls away
          with the canvas is one that has to be found before it can be used. */}
      {!floating && ghost}
      {!floating && nothingOpen}
    </section>
  )

  // The wrapper is now returned in both modes. It used to be the canvas's alone — the grid needs
  // no positioning context of its own, since its ghost tile is simply its last cell. What wants
  // one in both is the bin: a tile is just as draggable on a grid, and pinning the zone to
  // `.ws-main` instead would mean giving that element a positioning context it does not have and
  // putting the bin outside the board it belongs to.
  return (
    <div className="wsboard" style={{ '--tile-w': `${canvas?.tileWidth ?? 0}px` } as CSSVars}>
      {board}
      {floating && ghost}
      {floating && nothingOpen}
      {/* After the board, and it has to be: whether it shows is a sibling selector on the
          attribute the carry engines write on the board element. */}
      {trash}
    </div>
  )
}

/** One custom property, which `style` has no type for. */
type CSSVars = CSSProperties & Record<'--tile-w', string>
