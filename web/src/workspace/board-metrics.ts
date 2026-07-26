// The two things about a board only the DOM can answer, and the canvas worked out from them.
//
// `place.ts` packs tiles at a given width into a given number of columns, and it is pure
// because that is what makes it checkable. Somebody still has to say what the width and the
// column count *are*, and on a board those come from the element: how wide it is right now,
// and how tall each of its cards came out for the comp it happens to be drawing.
//
// Both readers are used twice — by the board, to draw itself, and by "tidy up", which runs
// from a control outside the board and needs exactly the same numbers. One home for them, so
// a tidied board and a drawn one cannot disagree.

import { useEffect, useState } from 'react'
import type { RefObject } from 'react'

import { extentFor } from './canvas-extent'
import type { Extent } from './canvas-extent'
import { FALLBACK_H, trackCount, trackWidth } from './place'
import type { Occupied, Size } from './place'
import type { Place } from './types'

export interface Canvas {
  readonly extent: Extent
  /** What every tile is drawn at — the width the grid would give it at this size. */
  readonly tileWidth: number
  readonly columns: number
}

/**
 * Each tile's height as it is actually drawn.
 *
 * Measured rather than assumed because the grid uses `grid-auto-rows: max-content` and its
 * rows are genuinely unequal — a comp with three hulls is a much shorter card than one with
 * ten — so a pack that assumed one height would leave gaps under the short ones.
 */
export function tileHeights(scroller: HTMLElement | null): Map<string, number> {
  const heights = new Map<string, number>()
  if (!scroller) return heights
  for (const tile of scroller.querySelectorAll<HTMLElement>('[data-comp-id]')) {
    const id = tile.dataset.compId
    // Zero under jsdom, which lays nothing out — and a zero height would stack every tile at
    // the same place. `packed` falls back for anything it is not told about, so leaving it out
    // is what gets that fallback used.
    if (id && tile.offsetHeight > 0) heights.set(id, tile.offsetHeight)
  }
  return heights
}

/** How much of the board is visible. Not the window: the board is a scroll container in a
 *  layout that does not itself scroll, and the rail takes some of the width. */
export function boardSize(scroller: HTMLElement | null): Size {
  if (!scroller) return { width: 0, height: 0 }
  return { width: scroller.clientWidth, height: scroller.clientHeight }
}

/**
 * The board's size, kept current as it changes.
 *
 * A `ResizeObserver` rather than a window listener: the board changes width when the library
 * rail opens as well as when the window does, and only one of those is a window event.
 * Absent under jsdom, where the fallback is to measure once — which is the right answer in a
 * document that never lays anything out anyway.
 */
export function useBoardSize(ref: RefObject<HTMLElement | null>, active: boolean): Size {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })

  useEffect(() => {
    const element = ref.current
    if (!active || !element) return
    const read = () => {
      const next = boardSize(element)
      // Compared before it is set, so an observer that fires for a resize in the other axis
      // does not re-render the board for nothing.
      setSize((current) =>
        current.width === next.width && current.height === next.height ? current : next,
      )
    }
    read()
    if (typeof ResizeObserver !== 'function') return
    const observer = new ResizeObserver(read)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, active])

  return size
}

/** The canvas a board of this size, holding these tiles, is drawn on. */
export function canvasFor(size: Size, places: ReadonlyMap<string, Place>, heights: ReadonlyMap<string, number>): Canvas {
  const tileWidth = trackWidth(size.width)
  const occupied: Occupied[] = [...places].map(([id, place]) => ({
    place,
    height: heights.get(id) ?? FALLBACK_H,
  }))
  return {
    extent: extentFor(occupied, size, { width: tileWidth, height: FALLBACK_H }),
    tileWidth,
    columns: trackCount(size.width, tileWidth),
  }
}
