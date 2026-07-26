// How big a floating board's canvas is, and how to get from a cursor to a coordinate on it.
//
// **This module is a seam, and the point of it is that it is the only one.** What shipped is a
// large pannable surface, chosen to be tried rather than settled on. The alternative — a canvas
// exactly as wide as the board area, growing downward only, with no horizontal scroll — is a
// change to `extentFor` below and one CSS line, and nothing else, because everything outside
// this file works in canvas coordinates and clamps to the `Bounds` this file hands out. Two
// sentences of contract, worth keeping:
//
//   1. Nothing else decides how big the canvas is, or where a tile may be put down.
//   2. A tile's stored x/y is in the canvas's own coordinates, never the viewport's.
//
// `placesWithin` exists for the revert specifically: a narrower canvas has to bring existing
// positions inside its bounds, and doing that as a *committed* rearrangement rather than a
// render-time adjustment is what stops the board drawing one thing and saving another.
//
// Pan is scroll rather than a transform. `reorder.ts` already fixed the convention — a box's
// left plus the container's `scrollLeft` — and a transform pan would need a second, different
// conversion for no gain. It also means native scrollbars, keyboard paging, two-finger pan and
// shift-wheel all work without being written.

import { MAX_COORD, PAD } from './place'
import type { Bounds, Occupied, Size } from './place'
import type { Place } from './types'

/** How much canvas to leave past the furthest tile, so there is always somewhere to drag to. */
const MARGIN = 240

/** The surface a floating board is drawn on. */
export interface Extent {
  readonly width: number
  readonly height: number
  /** Where a tile may be placed on it. */
  readonly bounds: Bounds
}

/**
 * The canvas for a board whose tiles sit here, seen through a viewport this size.
 *
 * Twice the viewport in each direction, or enough to hold what is already placed — whichever
 * is larger. Generous enough to spread out on, and **never smaller than the tiles occupy**,
 * which is the property that stops a tile being stranded outside the scrollable area where
 * nothing could reach it.
 *
 * ⚠️ The board-width alternative is this function returning `width: viewport.width` and
 * `maxX: viewport.width - tileWidth`, plus `overflow-x: hidden` on `.wsfloat`. Nothing else
 * in the feature changes. See the note at the top of this file before adding a third policy.
 */
export function extentFor(occupied: readonly Occupied[], viewport: Size, tile: Size): Extent {
  let right = PAD
  let bottom = PAD
  for (const one of occupied) {
    right = Math.max(right, one.place.x + tile.width)
    bottom = Math.max(bottom, one.place.y + one.height)
  }
  return {
    width: Math.max(viewport.width * 2, right + MARGIN),
    height: Math.max(viewport.height * 2, bottom + MARGIN),
    bounds: { minX: 0, minY: 0, maxX: MAX_COORD, maxY: MAX_COORD },
  }
}

/**
 * Canvas coordinates for a point in the viewport.
 *
 * The scroller's own offset rather than the page's: a board is a scroll container inside a
 * layout that does not itself scroll, so the cursor's client position is relative to the
 * board's *visible* corner and the canvas begins wherever that has been scrolled to.
 */
export function toCanvas(scroller: HTMLElement, clientX: number, clientY: number): Place {
  const box = scroller.getBoundingClientRect()
  return {
    x: clientX - box.left + scroller.scrollLeft,
    y: clientY - box.top + scroller.scrollTop,
  }
}

/**
 * Scroll so that a place is on screen, if it is not already.
 *
 * The least movement that works, rather than centring: a tile brought into view by scrolling
 * the whole canvas under it is harder to find than one that appeared at the edge you were
 * already looking at. Smooth, because this is always the answer to somebody asking where
 * something is, and a jump answers a different question.
 */
export function reveal(scroller: HTMLElement, place: Place, size: Size): void {
  const view = { width: scroller.clientWidth, height: scroller.clientHeight }
  const left = nudge(scroller.scrollLeft, place.x, size.width, view.width)
  const top = nudge(scroller.scrollTop, place.y, size.height, view.height)
  if (left === scroller.scrollLeft && top === scroller.scrollTop) return
  // Absent under jsdom, where there is no layout to scroll: fall back to assignment so a test
  // can still read the offsets.
  if (typeof scroller.scrollTo === 'function') {
    scroller.scrollTo({ left, top, behavior: 'smooth' })
    return
  }
  scroller.scrollLeft = left
  scroller.scrollTop = top
}

function nudge(offset: number, at: number, extent: number, view: number): number {
  // A margin so the tile arrives inside the board rather than flush against its edge.
  const near = at - PAD
  const far = at + extent + PAD - view
  if (near < offset) return Math.max(0, near)
  if (far > offset) return Math.max(0, far)
  return offset
}

/**
 * The same places, inside this extent.
 *
 * Only ever needed when an extent *shrinks* — which today it does not, and which the
 * board-width policy would make routine. Kept and tested now so the revert is a change to
 * `extentFor` and nothing else.
 *
 * Answers with the map it was given when everything already fits, so a caller can compare by
 * reference and a board whose tiles are all in bounds arms no save.
 */
export function placesWithin(
  places: ReadonlyMap<string, Place>,
  extent: Extent,
  tile: Size,
  heights: ReadonlyMap<string, number>,
): ReadonlyMap<string, Place> {
  let moved = false
  const next = new Map<string, Place>()
  for (const [id, place] of places) {
    const height = heights.get(id) ?? tile.height
    const x = Math.round(
      Math.max(extent.bounds.minX, Math.min(place.x, extent.bounds.maxX - tile.width)),
    )
    const y = Math.round(
      Math.max(extent.bounds.minY, Math.min(place.y, extent.bounds.maxY - height)),
    )
    if (x !== place.x || y !== place.y) moved = true
    next.set(id, { x, y })
  }
  return moved ? next : places
}
