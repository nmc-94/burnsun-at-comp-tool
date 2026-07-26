// Where a tile sits on a floating board.
//
// The whole of the canvas's judgement is here, over numbers, for the reason `reorder.test.ts`
// tests `landing` the same way: a browser is needed to check how a drag *feels*, not whether
// its arithmetic is right, and arithmetic checked in jsdom is arithmetic checked against boxes
// that are all at the origin with no size.
//
// Two claims are load-bearing beyond their own tests. `trackWidth` reproducing the CSS is what
// makes a tile the same size in both modes — the property the whole toggle rests on — and
// `readingOrder` is what a floating board hands back when it becomes a grid again.

import { describe, expect, it } from 'vitest'

import {
  BAND,
  clamped,
  dropAt,
  FALLBACK_H,
  GAP,
  MIN_TILE_W,
  nextFreePlace,
  PAD,
  packed,
  readingOrder,
  samePlace,
  SNAP,
  snapped,
  trackCount,
  trackWidth,
} from './place'
import type { Occupied } from './place'
import type { Place } from './types'

const TILE = { width: MIN_TILE_W, height: FALLBACK_H }
const ROOMY = { minX: 0, minY: 0, maxX: 10_000, maxY: 10_000 }

const at = (x: number, y: number): Place => ({ x, y })

function placesOf(...entries: Array<[string, number, number]>): Map<string, Place> {
  return new Map(entries.map(([id, x, y]) => [id, at(x, y)]))
}

describe('trackWidth', () => {
  // `repeat(auto-fill, minmax(320px, 1fr))` in arithmetic. Written twice on purpose — once in
  // CSS, once in TypeScript — because a stylesheet cannot be imported and the two modes have
  // to draw a card at the same size. `board-float.spec.ts` measures both against each other.
  it.each([
    // viewport, columns the grid would make, because the content box is viewport - 2 * PAD
    [1600, 4],
    [1280, 3],
    [1000, 2],
    // Under the 860px breakpoint a board is never floating, so this one is a guard rather
    // than a layout anybody meets.
    [600, 1],
  ])('fills %ipx with %i tracks, the way auto-fill would', (viewport, columns) => {
    const width = trackWidth(viewport)

    expect(trackCount(viewport, width)).toBe(columns)
    // The tracks and their gaps account for the whole content box, with nothing left over —
    // which is what `1fr` means and what a fixed 320px would not do.
    expect(columns * width + (columns - 1) * GAP).toBeCloseTo(viewport - PAD * 2, 6)
  })

  it('never goes below one track, however little room there is', () => {
    // A viewport too narrow for even one tile gets a tile at the floor and a scrollbar, which
    // is what the grid does. Below 860px the board is not floating at all, so this is a guard
    // rather than a layout anybody sees.
    expect(trackWidth(300)).toBe(MIN_TILE_W)
    expect(trackWidth(0)).toBe(MIN_TILE_W)
  })

  it('is at least the floor at every width', () => {
    for (let viewport = 320; viewport <= 2400; viewport += 7) {
      expect(trackWidth(viewport)).toBeGreaterThanOrEqual(MIN_TILE_W)
    }
  })
})

describe('snapped', () => {
  it('goes to the nearest step in both directions', () => {
    expect(snapped(at(0, 0))).toEqual(at(0, 0))
    expect(snapped(at(SNAP / 2 - 1, SNAP / 2 + 1))).toEqual(at(0, SNAP))
    expect(snapped(at(331, 47))).toEqual(at(340, 40))
  })

  it('never lands before the origin', () => {
    // The canvas starts at its corner; a tile carried past it comes back rather than going
    // somewhere no scrollbar reaches.
    expect(snapped(at(-40, -5))).toEqual(at(0, 0))
  })
})

describe('clamped', () => {
  it('keeps the far edge inside, not just the corner', () => {
    // The one that matters. A tile clamped only at its top-left can still hang off the right
    // of the canvas — and that is exactly the tile somebody then cannot reach.
    const bounds = { minX: 0, minY: 0, maxX: 1000, maxY: 800 }

    expect(clamped(at(900, 700), TILE, bounds)).toEqual(at(1000 - TILE.width, 800 - TILE.height))
  })

  it('puts a tile at the origin when the bounds are smaller than it is', () => {
    const cramped = { minX: 0, minY: 0, maxX: 100, maxY: 100 }

    expect(clamped(at(50, 50), TILE, cramped)).toEqual(at(0, 0))
  })

  it('rounds, so a coordinate cannot arm the save debounce forever', () => {
    expect(clamped(at(12.4, 19.6), TILE, ROOMY)).toEqual(at(12, 20))
  })
})

describe('samePlace', () => {
  it('answers for a tile that has no place yet', () => {
    expect(samePlace(undefined, undefined)).toBe(true)
    expect(samePlace(at(0, 0), undefined)).toBe(false)
    expect(samePlace(at(1, 2), at(1, 2))).toBe(true)
    expect(samePlace(at(1, 2), at(1, 3))).toBe(false)
  })
})

describe('dropAt', () => {
  it('lands the tile under the cursor rather than putting its corner there', () => {
    // Without the grip a tile jumps the instant it is let go of, so that wherever it was held
    // becomes its top-left corner.
    expect(dropAt(at(500, 400), at(60, 12), false, TILE, ROOMY)).toEqual(at(440, 388))
  })

  it('snaps when the board says to, and does not when it does not', () => {
    expect(dropAt(at(451, 401), at(0, 0), true, TILE, ROOMY)).toEqual(at(460, 400))
    expect(dropAt(at(451, 401), at(0, 0), false, TILE, ROOMY)).toEqual(at(451, 401))
  })

  it('clamps after it snaps, so the edge has the last word', () => {
    // A tile snapped past the edge comes back inside the canvas rather than landing on a step
    // that is not there.
    const bounds = { minX: 0, minY: 0, maxX: 1000, maxY: 1000 }

    const landed = dropAt(at(2000, 2000), at(0, 0), true, TILE, bounds)

    expect(landed).toEqual(at(1000 - TILE.width, 1000 - TILE.height))
  })
})

describe('packed', () => {
  const heights = (...entries: Array<[string, number]>) => new Map(entries)

  it('lays tiles out in the columns the grid would give them', () => {
    const places = packed(['a', 'b', 'c'], heights(), MIN_TILE_W, 2)

    expect(places.get('a')).toEqual(at(PAD, PAD))
    expect(places.get('b')).toEqual(at(PAD + MIN_TILE_W + GAP, PAD))
    // Third tile goes under the first, because with equal heights both columns are level and
    // ties fill left to right.
    expect(places.get('c')).toEqual(at(PAD, PAD + FALLBACK_H + GAP))
  })

  it('puts the next tile under the shortest column, as max-content rows do', () => {
    // Heights are measured rather than assumed precisely because the grid's rows are unequal:
    // a comp with three hulls is a much shorter card than one with ten.
    const places = packed(['tall', 'short', 'next'], heights(['tall', 500], ['short', 100]), 300, 2)

    expect(places.get('next')).toEqual(at(PAD + 300 + GAP, PAD + 100 + GAP))
  })

  it('falls back to a card-sized height for a tile nobody has measured', () => {
    // A board packed before its tiles have loaded comes out untidy rather than overlapping.
    const places = packed(['a', 'b'], heights(), MIN_TILE_W, 1)

    expect(places.get('b')).toEqual(at(PAD, PAD + FALLBACK_H + GAP))
  })

  it('gives the same answer twice, so tidying an already tidy board changes nothing', () => {
    const once = packed(['a', 'b', 'c'], heights(['a', 200]), MIN_TILE_W, 2)
    const twice = packed(['a', 'b', 'c'], heights(['a', 200]), MIN_TILE_W, 2)

    expect([...twice]).toEqual([...once])
  })

  it('makes one column when it is told there is only room for one', () => {
    const places = packed(['a', 'b'], heights(), MIN_TILE_W, 0)

    expect(places.get('a')!.x).toBe(PAD)
    expect(places.get('b')!.x).toBe(PAD)
  })
})

describe('nextFreePlace', () => {
  const occupied = (...entries: Array<[number, number, number]>): Occupied[] =>
    entries.map(([x, y, height]) => ({ place: at(x, y), height }))

  it('takes the first free cell rather than repacking what is already down', () => {
    // The tiles already placed were placed by somebody. Rearranging them because a new one
    // arrived would be the board overruling that.
    const place = nextFreePlace(occupied([PAD, PAD, FALLBACK_H]), MIN_TILE_W, 3)

    expect(place).toEqual(at(PAD + MIN_TILE_W + GAP, PAD))
  })

  it('never lands on top of anything already there', () => {
    const placed = occupied(
      [PAD, PAD, FALLBACK_H],
      [PAD + MIN_TILE_W + GAP, PAD, FALLBACK_H],
      [PAD, PAD + FALLBACK_H + GAP, FALLBACK_H],
    )

    const place = nextFreePlace(placed, MIN_TILE_W, 2)

    for (const other of placed) {
      const apart =
        place.x >= other.place.x + MIN_TILE_W ||
        place.x + MIN_TILE_W <= other.place.x ||
        place.y >= other.place.y + other.height ||
        place.y + FALLBACK_H <= other.place.y
      expect(apart).toBe(true)
    }
  })

  it('starts at the corner on an empty canvas', () => {
    expect(nextFreePlace([], MIN_TILE_W, 3)).toEqual(at(PAD, PAD))
  })
})

describe('readingOrder', () => {
  // What a canvas hands back when it becomes a grid again. Ordering by the stored array would
  // be honest only until the first tile was moved.
  it('reads a clean arrangement top to bottom, left to right', () => {
    const places = placesOf(
      ['c', 350, 400],
      ['a', 0, 0],
      ['d', 350, 0],
      ['b', 0, 400],
    )

    expect(readingOrder(['a', 'b', 'c', 'd'], places)).toEqual(['a', 'd', 'b', 'c'])
  })

  it('treats tiles within a band of each other as one row', () => {
    // Rows are found by a sweep rather than by testing overlap, because overlap is not
    // transitive: a run of tiles each slightly lower than the last would come out as one row,
    // three rows, or something else depending on which pair was compared first.
    const places = placesOf(['a', 0, 0], ['b', 350, BAND - 1], ['c', 700, 10])

    expect(readingOrder(['c', 'b', 'a'], places)).toEqual(['a', 'b', 'c'])
  })

  it('starts a new row for a tile past the band', () => {
    const places = placesOf(['a', 700, 0], ['b', 0, BAND])

    expect(readingOrder(['a', 'b'], places)).toEqual(['a', 'b'])
  })

  it('answers with the list it was given when the arrangement already reads that way', () => {
    // Reference equality, which is what lets a caller tell "no rearrangement" from "the same
    // rearrangement rebuilt" — and what keeps a toggle that changes no order from arming the
    // save debounce.
    const ids = ['a', 'b']
    const places = placesOf(['a', 0, 0], ['b', 350, 0])

    expect(readingOrder(ids, places)).toBe(ids)
  })

  it('breaks a tie by the order it was given, so it is stable', () => {
    const places = placesOf(['a', 40, 40], ['b', 40, 40])

    expect(readingOrder(['b', 'a'], places)).toEqual(['b', 'a'])
  })

  it('puts a tile that has never been placed first, in the order it already had', () => {
    // It has no position to be read, and the alternative is inventing one to sort it by.
    const places = placesOf(['placed', 700, 0])

    expect(readingOrder(['placed', 'fresh'], places)).toEqual(['fresh', 'placed'])
  })

  it('round-trips a board nobody has rearranged', () => {
    // Grid to floating to grid, on an untouched board, gives back the order it started with —
    // the property that makes the toggle safe to offer casually.
    const ids = ['a', 'b', 'c', 'd', 'e']
    const places = packed(ids, new Map(), MIN_TILE_W, 2)

    expect(readingOrder(ids, places)).toBe(ids)
  })
})
