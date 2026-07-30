// One tile being carried across a canvas.
//
// **Outside React, for the same reason `reorder.ts` is** — a preview held in `BoardGrid` state
// would re-render every `CompTileHost` on the board each time the cursor moved, several times
// a second, which is the shape §6.7 asks for the opposite of. Nothing here re-renders
// anything. The one React update in the gesture is the drop.
//
// **Much smaller than the grid's engine, and the reason is worth saying.** On a canvas nothing
// else moves. The browser draws the drag image, the tile stays where it was, and no other tile
// is displaced to make room — so there is no FLIP during the drag at all, and none of the
// careful business in `reorder.ts` about measuring tiles at rest rather than mid-flight
// applies. What is left is: mark the tile as lifted, work out where a drop would land, and
// draw one outline there.
//
// That also means the landing does not read any other tile's box, which is why
// `BoardFloat.test.tsx` can check it under jsdom where `reorder.ts`'s equivalent could not.
//
// The tile itself is never moved from here. React writes `left`/`top` from the saved place;
// this writes `z-index` and, on the outline, `transform` — different properties on different
// elements, so neither can undo the other.

import { layoutPx } from '../ui-scale'
import { toCanvas } from './canvas-extent'
import type { Carried, Float } from './carry'
import { clamped, dropAt, samePlace } from './place'
import type { Bounds, Size } from './place'
import type { Place } from './types'

export type { Carried, Float }

export interface FloatOptions {
  /** Whether a tile put down here lands on the step. Read once — a drag is not the moment to
   *  change your mind about it, and the outline is drawn snapped so the answer is visible
   *  before anything is committed. */
  readonly snap: boolean
  /** Where a tile may be put down, which is the canvas's business alone. */
  readonly bounds: Bounds
  /**
   * The offset from the cursor to the tile's own top-left when it was picked up.
   *
   * Null when the press was never seen, in which case the tile is centred on the cursor. That
   * is worse than the real thing and much better than refusing the gesture.
   */
  readonly grip: Place | null
  /** How big a tile is drawn, which the clamp needs so the far edge stays reachable. */
  readonly tile: Size
}

/**
 * Take hold of a comp's tile on a canvas.
 *
 * Null only for a comp this canvas is not showing, or one whose surface has gone — the same
 * rule `beginReorder` follows, and the second half of it is not theoretical: a viewport that
 * narrows past the breakpoint mid-drag re-renders the board as a grid underneath the gesture.
 */
export function beginFloat(
  scroller: HTMLElement,
  compId: string,
  { snap, bounds, grip, tile }: FloatOptions,
): Float | null {
  // Found by walking rather than by a selector built from the id. `beginReorder` reads the
  // same attribute the same way, and a comp id interpolated into a selector needs escaping
  // that `CSS.escape` does not exist to provide under jsdom.
  let found: HTMLElement | null = null
  for (const candidate of scroller.querySelectorAll<HTMLElement>('[data-comp-id]')) {
    if (candidate.dataset.compId === compId) found = candidate
  }
  const surface = found?.parentElement
  if (!found || !surface) return null
  const held = found

  const started: Place = { x: held.offsetLeft, y: held.offsetTop }
  const from = grip ?? { x: tile.width / 2, y: tile.height / 2 }
  let landing = started
  let done = false

  // A frame late, because the browser takes its picture of the tile once this event's handlers
  // have run — dim it now and the thing following the cursor is the dimmed one. Same trick,
  // and same reason, as the grid's.
  const dimming = requestAnimationFrame(() => {
    held.dataset.lifted = 'true'
  })
  // Above everything else for the duration, so the outline and the tile's own resting shape do
  // not end up behind a neighbour it was overlapping.
  held.style.zIndex = '3'

  const outline = document.createElement('div')
  outline.className = 'board-landing'
  outline.dataset.testid = 'board-landing'
  outline.setAttribute('aria-hidden', 'true')
  outline.style.width = `${tile.width}px`
  outline.style.height = `${held.offsetHeight || tile.height}px`
  surface.append(outline)

  scroller.dataset.floating = 'true'

  function show(at: Place): void {
    outline.style.transform = `translate(${at.x}px, ${at.y}px)`
    scroller.dataset.landing = `${at.x},${at.y}`
  }

  show(started)

  function put(): void {
    if (done) return
    done = true
    // A drag that ends inside the frame the dimming was waiting for would otherwise have it
    // applied after the cleanup that takes it off, and the tile would stay faded for good.
    cancelAnimationFrame(dimming)
    held.dataset.lifted = 'false'
    held.style.zIndex = ''
    outline.remove()
    delete scroller.dataset.floating
    delete scroller.dataset.landing
  }

  return {
    carried: compId,
    place: () => landing,
    // Against where it started rather than against the saved place, so a tile picked up and
    // put back reports nothing — the guard that keeps a gesture which changed nothing from
    // arming the save debounce. On a canvas that is a common way for a drag to end.
    moved: () => !samePlace(landing, started),

    over(clientX, clientY) {
      if (done) return false
      const next = dropAt(toCanvas(scroller, clientX, clientY), from, snap, tile, bounds)
      if (samePlace(next, landing)) return false
      landing = next
      show(landing)
      return true
    },

    home() {
      if (done || samePlace(landing, started)) return false
      landing = started
      show(landing)
      return true
    },

    // Nothing to animate in either direction: the tile never left its place, so "settle" and
    // "give up" differ only in what the board does next. Both exist because `Carried` promises
    // them and `BoardGrid` calls them without knowing which engine it holds.
    settle: put,
    cancel: put,
  }
}

/**
 * Where a tile pressed at this point would be held.
 *
 * Split out so the board can work it out at `mousedown` — which is the only moment it is
 * knowable, and several events before anything asks. Clamped to the tile, so a press on a
 * child that has been dragged outside its parent's box cannot produce a grip that would throw
 * the landing off.
 *
 * In layout pixels, because `dropAt` subtracts it from a `toCanvas` result and that is what
 * those are. The tile's own box needs converting for the same reason — it is the clamp, so a
 * painted one would let a grip sit a quarter of the way outside the tile it belongs to.
 */
export function gripOf(tile: HTMLElement, clientX: number, clientY: number): Place {
  const box = tile.getBoundingClientRect()
  return clamped(
    { x: layoutPx(clientX - box.left), y: layoutPx(clientY - box.top) },
    { width: 0, height: 0 },
    { minX: 0, minY: 0, maxX: layoutPx(box.width), maxY: layoutPx(box.height) },
  )
}
