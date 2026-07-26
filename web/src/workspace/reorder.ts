// One tile being carried over the others, and the others getting out of its way.
//
// **Deliberately outside React, and that is the whole design.** A preview held in `BoardGrid`
// state would re-render every `CompTileHost` on the board each time the cursor crossed a tile
// — up to fifty of them, several times a second — and §6.7 asks for the opposite. `BoardGrid`
// says at the top of itself that the requirement is met "by the shape rather than by a
// discipline about `React.memo` that nothing checks"; state that changes on `dragover` would
// be exactly the shape it warns about. Nothing here re-renders anything. The one React update
// in the gesture is the drop.
//
// It is also what makes the preview survive its own parent. `WorkspaceScreen` hands the grid a
// freshly-built `compIds` array on every render, and it renders routinely mid-drag — the
// layout debounce alone passes through `saving` and back to `idle` — so a React-held preview
// would need reconciling against a prop whose identity changes for reasons nothing to do with
// the drag. Inline styles React never wrote are not touched by any of that.
//
// The tiles keep their places in the DOM throughout. What moves them is `order`, which grid
// items honour and which this board already leans on for `.board-empty`. The drop then commits
// the same arrangement through the layout, the DOM catches up, and the styles come off — all
// in one event, so the two orders are never both painted.
//
// **Where the cursor is answered by arithmetic, never by asking what is under it.** That is the
// one rule the rest of this file exists to keep. A `dragover` event names the element the
// browser hit-tested, and hit-testing reads the *transformed* box — so a tile part-way through
// sliding somewhere reports itself as being under a cursor it is only passing beneath. Acting
// on that reorders the board, which moves the tiles, which changes what is under the cursor: a
// loop that shows up as a jitter, worst on the diagonal moves that sweep across the most slots
// on their way. So the tiles' *layout* boxes are read once per rearrangement, with any flight
// cancelled first, and every question about the cursor is asked of those instead. Transforms
// then cannot reach the answer at all.

import { moveTile } from './layout'

/**
 * Long enough to follow rather than merely notice.
 *
 * §6.4's `0.1–0.15s` is a rule about *hover*; this is a tile crossing a board, and it is the
 * thing being read. See the note beside that rule for why direct manipulation is the one
 * exception to the band and to nothing else about it.
 */
const DURATION_MS = 200
const EASING = 'ease-out'

/** A tile's place, in the grid's own content rather than in the viewport — so a scroll between
 *  two readings does not read as every tile moving at once. */
export interface Box {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

export interface Reorder {
  /** The comp whose tile is being carried. */
  carried: string
  /** Say where the cursor is, in the grid's content. True when the arrangement changed. */
  over: (x: number, y: number) => boolean
  /** The order the tiles are drawn in now, which is where a drop would put them. */
  order: () => readonly string[]
  /** Leave the tiles where they are being shown, for the commit to catch up with. */
  settle: () => void
  /** Put them back where they came from, visibly. */
  cancel: () => void
}

/**
 * Where the carried tile would land, given where the cursor is.
 *
 * Pure, and separated out because it is the whole of the gesture's judgement and the one part
 * of it a browser is not needed to check. Answers `null` when nothing would move.
 *
 * The slot is the one the cursor is inside, or failing that the nearest — a board of unequal
 * tiles has real gaps in it, and a cursor in one still means the tile beside it rather than
 * nothing at all.
 */
export function landing(
  order: readonly string[],
  slots: ReadonlyMap<string, Box>,
  carried: string,
  x: number,
  y: number,
  stacked: boolean,
): number | null {
  let onto: string | null = null
  let closest = Number.POSITIVE_INFINITY
  for (const [id, box] of slots) {
    // Distance to the box rather than to its middle, so being inside one wins outright.
    const dx = Math.max(box.left - x, 0, x - (box.left + box.width))
    const dy = Math.max(box.top - y, 0, y - (box.top + box.height))
    const away = dx * dx + dy * dy
    if (away < closest) {
      closest = away
      onto = id
    }
  }
  if (onto === null || onto === carried) return null

  const box = slots.get(onto)
  const from = order.indexOf(carried)
  const at = order.indexOf(onto)
  if (!box || from === -1 || at === -1) return null

  const past = stacked ? y > box.top + box.height / 2 : x > box.left + box.width / 2
  // Where it lands among the others: that slot's own place, or the one after it. `at` counts a
  // list the carried tile is still in, so a slot ahead of it sits one place earlier once it has
  // been lifted out.
  const beside = at > from ? at - 1 : at
  return past ? beside + 1 : beside
}

/** Whether motion is wanted at all. Read when it is needed rather than subscribed to: the
 *  answer only matters inside one animation, and a listener would be board state the board does
 *  not otherwise have. `window.matchMedia` is absent under jsdom, hence both `?.`. */
function stillness(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true
}

function stopMoving(tile: HTMLElement): void {
  // Absent under jsdom, along with the rest of the Web Animations API.
  if (typeof tile.getAnimations !== 'function') return
  for (const running of tile.getAnimations()) running.cancel()
}

/**
 * Take hold of a comp's tile.
 *
 * Null when there is nothing to rearrange — one tile, or a comp this grid is not showing.
 */
export function beginReorder(grid: HTMLElement, compId: string): Reorder | null {
  const tiles = new Map<string, HTMLElement>()
  for (const found of grid.querySelectorAll<HTMLElement>('[data-comp-id]')) {
    const id = found.dataset.compId
    if (id) tiles.set(id, found)
  }
  if (tiles.size < 2 || !tiles.has(compId)) return null

  // Everything in the grid that is not a tile — the new-comp tile, in practice. It has no
  // `order` of its own, so once the tiles have one it would sort in among them rather than
  // staying at the end.
  const rest = [...grid.children].filter(
    (child): child is HTMLElement => child instanceof HTMLElement && !child.dataset.compId,
  )

  const started = [...tiles.keys()]
  let order = started
  let slots = new Map<string, Box>()
  let done = false

  /** Where the tiles are being *drawn*, mid-flight and all. The first half of a FLIP. */
  function drawn(): Map<string, Box> {
    return read(false)
  }

  /** Where the tiles actually *sit*, with any flight cancelled first. Both the second half of a
   *  FLIP and the map every question about the cursor is answered from. */
  function settled(): Map<string, Box> {
    return read(true)
  }

  function read(still: boolean): Map<string, Box> {
    // Cancelled in a pass of its own, before anything is measured. A running animation is a
    // transform and `getBoundingClientRect` reports the transformed box, so interleaving the
    // two would measure some tiles mid-flight and others at rest — and it would force a layout
    // per tile instead of one for all of them.
    if (still) for (const tile of tiles.values()) stopMoving(tile)
    const boxes = new Map<string, Box>()
    for (const [id, tile] of tiles) {
      const box = tile.getBoundingClientRect()
      boxes.set(id, {
        left: box.left + grid.scrollLeft,
        top: box.top + grid.scrollTop,
        width: box.width,
        height: box.height,
      })
    }
    return boxes
  }

  function draw(): void {
    order.forEach((id, index) => {
      const tile = tiles.get(id)
      if (tile) tile.style.order = String(index)
    })
    for (const other of rest) other.style.order = String(order.length)
    grid.dataset.tileOrder = order.join(',')
  }

  /** Send each tile from wherever it was drawn back to nothing. */
  function play(from: ReadonlyMap<string, Box>): void {
    if (stillness()) return
    for (const [id, tile] of tiles) {
      const was = from.get(id)
      const now = slots.get(id)
      if (!was || !now || typeof tile.animate !== 'function') continue
      const dx = was.left - now.left
      const dy = was.top - now.top
      if (dx === 0 && dy === 0) continue
      tile.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
        duration: DURATION_MS,
        easing: EASING,
      })
    }
  }

  function rearrange(next: readonly string[]): void {
    const from = drawn()
    order = [...next]
    draw()
    slots = settled()
    play(from)
  }

  const lifted = tiles.get(compId)
  // A frame late, because the browser takes its picture of the tile once this event's handlers
  // have run — dim it now and the thing following the cursor is the dimmed one.
  const dimming = requestAnimationFrame(() => {
    if (lifted) lifted.dataset.lifted = 'true'
  })

  grid.dataset.reordering = 'true'
  draw()
  slots = settled()

  function put(animated: boolean): void {
    if (done) return
    done = true
    // A drag that ends inside the frame the dimming was waiting for would otherwise have it
    // applied after the cleanup that takes it off, and the tile would stay faded for good.
    cancelAnimationFrame(dimming)
    const from = animated ? drawn() : null
    for (const tile of tiles.values()) {
      tile.style.order = ''
      tile.dataset.lifted = 'false'
    }
    for (const other of rest) other.style.order = ''
    grid.dataset.reordering = 'false'
    grid.dataset.tileOrder = (animated ? started : order).join(',')
    slots = settled()
    if (from) play(from)
  }

  return {
    carried: compId,
    order: () => order,

    over(clientX, clientY) {
      if (done) return false
      // Asked of the grid rather than guessed: the track count comes from the viewport, so
      // there is no fixed answer, and one column means the tiles run down instead of along.
      const stacked =
        window.getComputedStyle(grid).gridTemplateColumns.split(' ').length === 1
      const to = landing(
        order,
        slots,
        compId,
        clientX + grid.scrollLeft,
        clientY + grid.scrollTop,
        stacked,
      )
      if (to === null) return false
      const next = moveTile(order, compId, to)
      if (next === order) return false
      rearrange(next)
      return true
    },

    settle: () => put(false),
    cancel: () => put(true),
  }
}
