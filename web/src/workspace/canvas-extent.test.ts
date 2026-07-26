// @vitest-environment jsdom

// How big the canvas is, and the seam that keeps that one decision in one place.
//
// The tests that matter here are not about the numbers the current policy produces — those are
// a judgement call and will change if the canvas feels wrong. They are about the two properties
// that have to hold whatever the policy is: **the canvas is never smaller than the tiles
// occupy**, so nothing can be stranded where no scrollbar reaches it, and **the bounds are the
// only thing that says where a tile may go**, so swapping the policy is a change to one
// function. `placesWithin` is tested against a policy that is not the one in use, on purpose:
// it exists for the revert, and a helper for a case nobody exercises is a helper that is wrong
// by the time the case arrives.

import { describe, expect, it } from 'vitest'

import { extentFor, placesWithin, reveal, toCanvas } from './canvas-extent'
import type { Extent } from './canvas-extent'
import { FALLBACK_H, MIN_TILE_W, PAD } from './place'
import type { Occupied } from './place'
import type { Place } from './types'

const TILE = { width: MIN_TILE_W, height: FALLBACK_H }
const VIEWPORT = { width: 1200, height: 800 }

const at = (x: number, y: number): Place => ({ x, y })
const occupied = (...places: Place[]): Occupied[] =>
  places.map((place) => ({ place, height: FALLBACK_H }))

describe('extentFor', () => {
  it('gives room to spread out on an empty board', () => {
    const extent = extentFor([], VIEWPORT, TILE)

    expect(extent.width).toBeGreaterThan(VIEWPORT.width)
    expect(extent.height).toBeGreaterThan(VIEWPORT.height)
  })

  it('never comes out smaller than the tiles already on it', () => {
    // The property that stops a tile being stranded outside the scrollable area, where
    // nothing on the board could reach it. Whatever policy this function grows, this holds.
    const far = at(6_000, 4_000)

    const extent = extentFor(occupied(far), VIEWPORT, TILE)

    expect(extent.width).toBeGreaterThanOrEqual(far.x + TILE.width)
    expect(extent.height).toBeGreaterThanOrEqual(far.y + TILE.height)
  })

  it('bounds a tile by the coordinate ceiling the server enforces', () => {
    const extent = extentFor([], VIEWPORT, TILE)

    expect(extent.bounds.minX).toBe(0)
    expect(extent.bounds.minY).toBe(0)
    // Mirrored in comptool/workspace.py, which answers 422 rather than storing more.
    expect(extent.bounds.maxX).toBe(20_000)
  })
})

describe('placesWithin', () => {
  const heights = new Map<string, number>()

  it('answers with the map it was given when everything already fits', () => {
    // Reference equality: a board whose tiles are all in bounds must arm no save.
    const places = new Map([['a', at(100, 100)]])

    expect(placesWithin(places, extentFor([], VIEWPORT, TILE), TILE, heights)).toBe(places)
  })

  it('brings a tile back inside a narrower canvas', () => {
    // The one thing the board-width policy needs that the pannable one does not: existing x
    // coordinates were legal under a wide canvas and are not under a narrow one. Committed as
    // a rearrangement rather than adjusted at render time, so the board never draws one thing
    // and saves another.
    const narrow: Extent = {
      width: VIEWPORT.width,
      height: 4_000,
      bounds: { minX: 0, minY: 0, maxX: VIEWPORT.width, maxY: 20_000 },
    }
    const places = new Map([
      ['inside', at(100, 100)],
      ['adrift', at(5_000, 100)],
    ])

    const brought = placesWithin(places, narrow, TILE, heights)

    expect(brought.get('adrift')).toEqual(at(VIEWPORT.width - TILE.width, 100))
    expect(brought.get('inside')).toEqual(at(100, 100))
  })
})

describe('toCanvas', () => {
  it('reads a cursor against what has been scrolled past', () => {
    // The claim a browser proves properly, and the one that makes a drop land where the
    // cursor is rather than where it would have been at the top of the canvas.
    const scroller = document.createElement('div')
    scroller.getBoundingClientRect = () => new DOMRect(40, 60, 800, 600)
    scroller.scrollLeft = 300
    scroller.scrollTop = 150

    expect(toCanvas(scroller, 140, 160)).toEqual(at(400, 250))
  })
})

describe('reveal', () => {
  /** A scroller of a known size, since jsdom lays nothing out. */
  function scrollerOf(scrollLeft: number, scrollTop: number) {
    const scroller = document.createElement('div')
    Object.defineProperty(scroller, 'clientWidth', { value: 800 })
    Object.defineProperty(scroller, 'clientHeight', { value: 600 })
    scroller.scrollLeft = scrollLeft
    scroller.scrollTop = scrollTop
    return scroller
  }

  it('leaves a tile that is already on screen alone', () => {
    const scroller = scrollerOf(0, 0)

    reveal(scroller, at(100, 100), TILE)

    expect([scroller.scrollLeft, scroller.scrollTop]).toEqual([0, 0])
  })

  it('moves as little as it can to bring a tile into view', () => {
    // Scrolling the whole canvas under a tile makes it harder to find than one that appears
    // at the edge you were already looking at.
    const scroller = scrollerOf(0, 0)

    reveal(scroller, at(2_000, 0), TILE)

    expect(scroller.scrollLeft).toBe(2_000 + TILE.width + PAD - 800)
    expect(scroller.scrollTop).toBe(0)
  })

  it('scrolls back for a tile above and behind where it is looking', () => {
    const scroller = scrollerOf(1_000, 1_000)

    reveal(scroller, at(400, 500), TILE)

    expect(scroller.scrollLeft).toBe(400 - PAD)
    expect(scroller.scrollTop).toBe(500 - PAD)
  })
})
