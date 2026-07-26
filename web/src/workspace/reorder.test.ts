// Where a carried tile would land, given where the cursor is.
//
// The whole of the gesture's judgement, and the one part of it that needs no browser: it is
// arithmetic over boxes. That it *is* arithmetic is the point. Asking which element the cursor
// is over gets a different answer while a tile is sliding — hit-testing reads the transformed
// box — and acting on that answer moves the tiles, which changes it again. Working from the
// tiles' resting places instead is what makes a stationary cursor a stationary answer, so the
// tests below that hold one still and ask twice are the load-bearing ones.

import { describe, expect, it } from 'vitest'

import { landing } from './reorder'
import type { Box } from './reorder'

/** A row of three 100-wide tiles, 10 apart, all 60 tall. */
const ROW = new Map<string, Box>([
  ['a', { left: 0, top: 0, width: 100, height: 60 }],
  ['b', { left: 110, top: 0, width: 100, height: 60 }],
  ['c', { left: 220, top: 0, width: 100, height: 60 }],
])

/** The same three stacked, which is what one grid column looks like. */
const COLUMN = new Map<string, Box>([
  ['a', { left: 0, top: 0, width: 100, height: 60 }],
  ['b', { left: 0, top: 70, width: 100, height: 60 }],
  ['c', { left: 0, top: 140, width: 100, height: 60 }],
])

const order = ['a', 'b', 'c']
const along = (carried: string, x: number, y = 30) => landing(order, ROW, carried, x, y, false)
const down = (carried: string, y: number, x = 50) => landing(order, COLUMN, carried, x, y, true)

describe('where a carried tile would land', () => {
  it('goes before the slot whose near half the cursor is in', () => {
    // Carrying the last tile back over the first: left of centre means "in front of it".
    expect(along('c', 20)).toBe(0)
  })

  it('goes after the slot whose far half the cursor is in', () => {
    expect(along('c', 80)).toBe(1)
  })

  it('counts the slot in a list the carried tile has been lifted out of', () => {
    // Carrying the *first* tile onto the last: `c` is at index 2, but with `a` lifted out it
    // is the second of the two left, so landing after it is index 2 and not 3.
    expect(along('a', 300)).toBe(2)
    expect(along('a', 240)).toBe(1)
  })

  it('reads down the page instead of along it when the tiles are stacked', () => {
    expect(down('c', 20)).toBe(0)
    expect(down('c', 50)).toBe(1)
  })

  it('takes the nearest slot when the cursor is in a gap', () => {
    // The 10px between two tiles, and the empty board to the right of the last one. Both mean
    // the tile beside them rather than nothing at all.
    expect(along('c', 104)).toBe(1)
    expect(along('a', 900)).toBe(2)
  })

  it('says nothing when the cursor is over the tile being carried', () => {
    // What stops a drag held still over its own slot from asking to move something every time
    // the browser re-runs its hit test.
    expect(along('a', 20)).toBeNull()
    expect(along('b', 150)).toBeNull()
  })

  it('gives the same answer twice for a cursor that has not moved', () => {
    // The property the jitter came from not having. Ask, apply, ask again from the same point:
    // the second answer must be where the tile already is, or the board oscillates.
    const first = along('c', 20)
    expect(first).toBe(0)

    const after = ['c', 'a', 'b']
    // Its slot is the one it was put in — the boxes belong to places, not to tiles.
    const moved = new Map<string, Box>([
      ['c', ROW.get('a')!],
      ['a', ROW.get('b')!],
      ['b', ROW.get('c')!],
    ])

    expect(landing(after, moved, 'c', 20, 30, false)).toBeNull()
  })

  it('answers for a cursor beyond every tile without wandering off', () => {
    // Dragged off the top-left of the board entirely: the first slot is still the nearest, and
    // still the answer. A drag that leaves the grid is not a drag that has stopped.
    expect(landing(order, ROW, 'c', -500, -500, false)).toBe(0)
  })

  it.each([
    ['a comp that is not on the board', 'elsewhere'],
    ['nothing carried at all', ''],
  ])('says nothing given %s', (_case, carried) => {
    expect(landing(order, ROW, carried, 20, 30, false)).toBeNull()
  })

  it('says nothing when there are no slots to land in', () => {
    expect(landing(order, new Map(), 'a', 20, 30, false)).toBeNull()
  })
})
