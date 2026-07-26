// Where a tile sits on a floating board, as pure functions. No React, no DOM, no fetching —
// the `layout.ts` pattern, and tested the same way.
//
// This is `reorder.ts`'s `landing()` one level down and one dimension up. A grid drop answers
// with an *index*, which is the whole of what a grid arrangement is; a canvas drop answers with
// a *point*. The two share nothing but the discipline: the judgement lives in a pure function
// over numbers, so a browser is needed to check how it feels rather than whether it is right.
//
// It lives beside `layout.ts` rather than inside it because `float-drag.ts` needs this
// arithmetic **without a layout in hand** — mid-drag it is working in pixels, and there is no
// `WorkspaceLayout` to thread through. Exactly the relationship `reorder.ts` already has:
// pure geometry of its own, `moveTile` imported from the document's algebra.

import type { Place } from './types'

/**
 * The narrowest a tile is ever drawn — `.wsgrid`'s `minmax()` floor, and the width below
 * which the card's ten-row scaffold stops fitting its columns.
 */
export const MIN_TILE_W = 320

/** A tile whose height nobody has measured. The ghost tile's number, for the same reason it
 *  has it: it is about what a comp tile comes out as. */
export const FALLBACK_H = 350

/** `.wsgrid`'s gap and padding, so a packed canvas and the grid agree to the pixel. */
export const GAP = 14
export const PAD = 16

/** The step a snapped tile lands on. A design token rather than user data, which is why it is
 *  here and not in the stored document. */
export const SNAP = 20

/**
 * How far apart two tiles' tops may be and still count as the same row.
 *
 * Used only by `readingOrder`. Roughly a third of a card, and comfortably more than `SNAP`, so
 * a row of tiles snapped to slightly different steps does not come apart into several rows.
 */
export const BAND = 120

/** How far from the origin a tile may be placed. Mirrored in `comptool/workspace.py`. */
export const MAX_COORD = 20_000

export interface Size {
  readonly width: number
  readonly height: number
}

/** Where a tile may be put down. The canvas's business — see `canvas-extent.ts`. */
export interface Bounds {
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
}

/** A tile that is already somewhere, for the two functions that have to avoid it. */
export interface Occupied {
  readonly place: Place
  readonly height: number
}

/**
 * The width one tile gets, which is the width the **grid** would give it.
 *
 * `repeat(auto-fill, minmax(320px, 1fr))` in arithmetic: as many 320px tracks as fit the
 * content box, then the leftover shared out between them. The two modes have to draw a card at
 * the same size — that is what makes the toggle lossless, and what stops every tile on the
 * board visibly shrinking the moment somebody tries floating — and a stylesheet cannot be
 * imported, so the rule is written twice on purpose. `board-float.spec.ts` measures a tile in
 * each mode and is what catches the two drifting apart.
 *
 * Never narrower than one track: a viewport too small for even that gets a single tile at the
 * floor and a scrollbar, which is what the grid does too.
 */
export function trackWidth(available: number): number {
  const content = available - PAD * 2
  if (content < MIN_TILE_W) return MIN_TILE_W
  // The `+ GAP` on both sides is the gap-counting trick `auto-fill` uses: n tracks have n-1
  // gaps, so adding one gap to each side of the division makes it a clean floor.
  const columns = Math.max(1, Math.floor((content + GAP) / (MIN_TILE_W + GAP)))
  return (content - GAP * (columns - 1)) / columns
}

/** How many tiles of `width` fit across `available`. The companion to `trackWidth`, and the
 *  column count a pack uses. */
export function trackCount(available: number, width: number): number {
  const content = available - PAD * 2
  return Math.max(1, Math.floor((content + GAP) / (width + GAP)))
}

/** The nearest step, in both directions. Never negative: the canvas starts at its origin. */
export function snapped(place: Place): Place {
  return {
    x: Math.max(0, Math.round(place.x / SNAP) * SNAP),
    y: Math.max(0, Math.round(place.y / SNAP) * SNAP),
  }
}

/**
 * The same place, inside the bounds.
 *
 * Both edges, not just the origin: a tile clamped only at its top-left can still hang off the
 * far side of the canvas, which is precisely the tile somebody then cannot reach. The maximum
 * wins over the minimum when the bounds are narrower than the tile itself, so a canvas too
 * small for what is on it puts tiles at the origin rather than at a negative coordinate.
 */
export function clamped(place: Place, size: Size, bounds: Bounds): Place {
  const x = Math.min(place.x, bounds.maxX - size.width)
  const y = Math.min(place.y, bounds.maxY - size.height)
  return {
    x: Math.round(Math.max(bounds.minX, x)),
    y: Math.round(Math.max(bounds.minY, y)),
  }
}

/** Whether two places are the same one, either of them possibly absent. */
export function samePlace(a: Place | undefined, b: Place | undefined): boolean {
  if (!a || !b) return a === b
  return a.x === b.x && a.y === b.y
}

/**
 * Where a tile held by `grip` lands, given where the cursor is.
 *
 * The whole of a floating drag's judgement, and the one part of it a browser is not needed to
 * check — `landing`'s counterpart. `grip` is the offset from the cursor to the tile's own
 * top-left at pick-up, without which the tile would jump so that its corner met the cursor the
 * instant it was let go of.
 */
export function dropAt(
  cursor: Place,
  grip: Place,
  snap: boolean,
  size: Size,
  bounds: Bounds,
): Place {
  const loose = { x: cursor.x - grip.x, y: cursor.y - grip.y }
  // Snapped before it is clamped, so the clamp has the last word: a tile snapped past the edge
  // of the canvas comes back inside it rather than landing on a step that is not there.
  return clamped(snap ? snapped(loose) : loose, size, bounds)
}

/**
 * The tiles packed the way the grid would pack them.
 *
 * Shortest column first, in the order given — which is what `grid-auto-rows: max-content`
 * comes out as for tiles of unequal height, and why the heights are *measured* rather than
 * assumed. Pure: the measuring is the caller's, because only the board has the boxes.
 *
 * A tile with no measured height is `FALLBACK_H` tall rather than skipped, so a board packed
 * before its tiles have loaded is untidy rather than overlapping.
 */
export function packed(
  ids: readonly string[],
  heights: ReadonlyMap<string, number>,
  width: number,
  columns: number,
): Map<string, Place> {
  const across = Math.max(1, Math.floor(columns))
  const bottoms = Array.from({ length: across }, () => PAD)
  const places = new Map<string, Place>()

  for (const id of ids) {
    let column = 0
    for (let n = 1; n < across; n += 1) {
      // Strictly less than, so equal columns fill left to right and a fresh pack reads in the
      // order it was given rather than in whichever column the comparison happened to favour.
      if (bottoms[n]! < bottoms[column]!) column = n
    }
    const top = bottoms[column]!
    places.set(id, { x: Math.round(PAD + column * (width + GAP)), y: Math.round(top) })
    bottoms[column] = top + (heights.get(id) ?? FALLBACK_H) + GAP
  }

  return places
}

/**
 * Somewhere for one arriving tile that is not on top of anything already there.
 *
 * Deliberately not a pack: the tiles already placed were placed by somebody, and rearranging
 * them because a new one arrived would be the board overruling that. So this walks the same
 * column grid a pack uses and takes the first cell nothing occupies, falling off the bottom of
 * the shortest column when they are all taken.
 */
export function nextFreePlace(placed: readonly Occupied[], width: number, columns: number): Place {
  const across = Math.max(1, Math.floor(columns))
  const overlaps = (candidate: Place, height: number) =>
    placed.some(
      (other) =>
        candidate.x < other.place.x + width &&
        candidate.x + width > other.place.x &&
        candidate.y < other.place.y + other.height &&
        candidate.y + height > other.place.y,
    )

  // A generous number of rows to try — deep enough that a full board is exotic, shallow enough
  // that this cannot run away on one.
  const rows = placed.length + 2
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < across; column += 1) {
      const candidate = {
        x: Math.round(PAD + column * (width + GAP)),
        y: Math.round(PAD + row * (FALLBACK_H + GAP)),
      }
      if (!overlaps(candidate, FALLBACK_H)) return candidate
    }
  }

  const lowest = placed.reduce((low, other) => Math.max(low, other.place.y + other.height), PAD)
  return { x: PAD, y: Math.round(lowest + GAP) }
}

/**
 * The tiles in the order somebody reading the canvas would meet them.
 *
 * What a floating board hands back when it becomes a grid again. Ordering by the stored array
 * would be honest only until the first tile was moved: the array is the order tiles were
 * *opened* and raised in, and after an afternoon of arranging it says nothing about what is on
 * screen. So the grid takes the arrangement the person actually made, top to bottom and left to
 * right, and their board comes back looking like the one they had.
 *
 * Rows are found by a sweep rather than by testing whether tiles overlap vertically: overlap is
 * not transitive, so a row of tiles each slightly lower than the last could be one row, three
 * rows, or a different answer depending on which pair was compared first. A tile joins the open
 * row while it starts within `BAND` of the row's top, and opens a new one otherwise. Total and
 * stable — ties fall back to the order given, so a board where nothing has been moved comes
 * back exactly as it was.
 */
export function readingOrder(
  ids: readonly string[],
  places: ReadonlyMap<string, Place>,
): readonly string[] {
  const at = new Map(ids.map((id, index) => [id, index]))
  // A tile that has never been placed sorts to the front, in the order it already had: it has
  // no position to be read, and the alternative is inventing one to sort it by.
  const placeless = ids.filter((id) => !places.has(id))
  const positioned = ids.filter((id) => places.has(id))

  const byTop = [...positioned].sort((a, b) => {
    const top = places.get(a)!.y - places.get(b)!.y
    return top !== 0 ? top : at.get(a)! - at.get(b)!
  })

  const ordered: string[] = []
  let row: string[] = []
  let rowTop = 0
  const flush = () => {
    row.sort((a, b) => {
      const left = places.get(a)!.x - places.get(b)!.x
      if (left !== 0) return left
      const top = places.get(a)!.y - places.get(b)!.y
      return top !== 0 ? top : at.get(a)! - at.get(b)!
    })
    ordered.push(...row)
    row = []
  }

  for (const id of byTop) {
    const top = places.get(id)!.y
    if (row.length === 0) rowTop = top
    else if (top >= rowTop + BAND) {
      flush()
      rowTop = top
    }
    row.push(id)
  }
  flush()

  const next = [...placeless, ...ordered]
  // The same array when nothing moves, which is what lets a caller compare by reference and
  // what keeps a toggle that changes no order from arming the save debounce.
  return next.length === ids.length && next.every((id, n) => id === ids[n]) ? ids : next
}
