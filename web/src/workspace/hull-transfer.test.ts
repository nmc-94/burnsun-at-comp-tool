// The channel a hull crosses tiles through. Two properties carry the whole design:
// isolation — offering hulls to one comp must not wake another, because a store every tile
// subscribes to is board state wearing a different hat — and a snapshot that is the stored
// object, because `useSyncExternalStore` re-renders forever if it is not.

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  forgetCopiedFrom,
  getCopied,
  getDragged,
  offerHulls,
  peekTransfer,
  propose,
  resetHullTransfers,
  setCopied,
  setDragged,
  subscribeTransfer,
  takeOffer,
} from './hull-transfer'
import type { CarriedRows, HullOffer } from './hull-transfer'

const offer = (overrides: Partial<HullOffer> = {}): HullOffer => ({
  fromCompId: 'c1',
  fromName: 'Alpha',
  typeIds: [24_692],
  ...overrides,
})

/** Rows out of a tile: the offer a copy would take, plus what only a port reads. */
const carrying = (overrides: Partial<CarriedRows> = {}): CarriedRows => ({
  offer: offer(),
  positions: [0],
  settle: async () => {},
  ...overrides,
})

afterEach(resetHullTransfers)

describe('offering hulls', () => {
  it('tells only the tile the hulls were offered to', () => {
    const onTwo = vi.fn()
    const onThree = vi.fn()
    subscribeTransfer('c2', onTwo)
    subscribeTransfer('c3', onThree)

    offerHulls('c2', offer())

    expect(onTwo).toHaveBeenCalledTimes(1)
    expect(onThree).not.toHaveBeenCalled()
  })

  it('hands the hulls over once, so a copy cannot land twice', () => {
    offerHulls('c2', offer({ typeIds: [587, 609] }))

    expect(takeOffer('c2')?.offer.typeIds).toEqual([587, 609])
    expect(takeOffer('c2')).toBeUndefined()
  })

  it('hands the landing over with them, because where they go is half of what was said', () => {
    offerHulls('c2', offer({ typeIds: [587] }), 4)

    const taken = takeOffer('c2')

    expect(taken?.offer.typeIds).toEqual([587])
    expect(taken?.atIndex).toBe(4)
  })

  it('announces the taking as well as the offering, so the affordance goes away', () => {
    const listener = vi.fn()
    offerHulls('c2', offer())
    subscribeTransfer('c2', listener)

    takeOffer('c2')

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('leaves a mere proposal where it is, because nothing was committed', () => {
    propose('c2', offer())

    expect(takeOffer('c2')).toBeUndefined()
    expect(peekTransfer('c2')?.phase).toBe('proposed')
  })
})

describe('proposing hulls', () => {
  it('answers with the same object every time, or React never stops rendering', () => {
    propose('c2', offer())

    expect(peekTransfer('c2')).toBe(peekTransfer('c2'))
  })

  it('stays quiet when the same hulls are proposed again', () => {
    // dragenter fires afresh every time the cursor crosses into a child element, and each
    // announcement would be a re-render of the target and a re-judgement of its comp.
    propose('c2', offer())
    const listener = vi.fn()
    subscribeTransfer('c2', listener)

    propose('c2', offer())

    expect(listener).not.toHaveBeenCalled()
  })

  it('speaks up when different hulls are proposed', () => {
    propose('c2', offer())
    const listener = vi.fn()
    subscribeTransfer('c2', listener)

    propose('c2', offer({ typeIds: [24_692, 587] }))

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('speaks up when the same hulls are proposed against a different row', () => {
    // A drag moving down a column of rows is one offer proposed against each of them in turn.
    // A dedupe blind to the row would answer the first and then go quiet, and the mark would
    // stay on the row the cursor left.
    propose('c2', offer(), 3)
    const listener = vi.fn()
    subscribeTransfer('c2', listener)

    propose('c2', offer(), 4)

    expect(listener).toHaveBeenCalledTimes(1)
    expect(peekTransfer('c2')?.atIndex).toBe(4)
  })

  it('stays quiet when the same hulls are proposed against the same row', () => {
    propose('c2', offer(), 3)
    const listener = vi.fn()
    subscribeTransfer('c2', listener)

    propose('c2', offer(), 3)

    expect(listener).not.toHaveBeenCalled()
  })

  it('names no row when it is not given one, which is the end of the comp', () => {
    propose('c2', offer())

    expect(peekTransfer('c2')?.atIndex).toBeNull()
  })

  it('withdraws the question when the cursor leaves', () => {
    propose('c2', offer())

    propose('c2', null)

    expect(peekTransfer('c2')).toBeUndefined()
  })

  it('cannot withdraw hulls that were actually offered', () => {
    // A dragleave arriving after the drop must not swallow the copy.
    offerHulls('c2', offer())

    propose('c2', null)

    expect(peekTransfer('c2')?.phase).toBe('offered')
  })

  it('says nothing when there was no question to withdraw', () => {
    const listener = vi.fn()
    subscribeTransfer('c2', listener)

    propose('c2', null)

    expect(listener).not.toHaveBeenCalled()
  })
})

describe('the drag payload', () => {
  it('wakes nothing, because nothing draws it', () => {
    const listener = vi.fn()
    subscribeTransfer('c2', listener)

    setDragged(carrying())

    expect(getDragged()?.offer.fromCompId).toBe('c1')
    expect(listener).not.toHaveBeenCalled()
  })

  it('carries what a copy reads and what only a port reads', () => {
    // Two landings, one payload. A tile takes the hulls; the new-comp tile takes the row
    // numbers, because a fork is asked for by position — the server reads the rows out of its
    // own copy of the source comp, which is what pins the fork to the parent's version.
    setDragged(carrying({ offer: offer({ typeIds: [587, 609] }), positions: [1, 3] }))

    expect(getDragged()?.offer.typeIds).toEqual([587, 609])
    expect(getDragged()?.positions).toEqual([1, 3])
  })

  it('is put down again when the drag ends', () => {
    setDragged(carrying())

    setDragged(null)

    expect(getDragged()).toBeNull()
  })
})

describe('the clipboard', () => {
  it('holds the same thing a drag does, so a paste and a drop are one operation', () => {
    setCopied(carrying({ positions: [1, 3] }))

    expect(getCopied()?.positions).toEqual([1, 3])
    expect(getCopied()?.offer.fromCompId).toBe('c1')
  })

  it('is not emptied by reading it — pasting twice makes two comps', () => {
    setCopied(carrying())

    expect(getCopied()).not.toBeNull()
    expect(getCopied()).not.toBeNull()
  })

  it('is let go of when the comp the rows came from is edited', () => {
    // Row numbers, and removing a row renumbers every row below it. A copy held across an
    // edit would paste different hulls than the ones that were picked out, and say nothing.
    setCopied(carrying())

    forgetCopiedFrom('c1')

    expect(getCopied()).toBeNull()
  })

  it('survives an edit to any other comp', () => {
    setCopied(carrying())

    forgetCopiedFrom('c2')

    expect(getCopied()).not.toBeNull()
  })

  it('is separate from what is under the cursor', () => {
    // A drag while something is on the clipboard must not overwrite it: the drop and the
    // paste are two gestures a person can have in flight at once.
    setCopied(carrying({ positions: [4] }))

    setDragged(carrying({ positions: [7] }))

    expect(getCopied()?.positions).toEqual([4])
    expect(getDragged()?.positions).toEqual([7])
  })
})

describe('unsubscribing and resetting', () => {
  it('stops telling a listener that has gone', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeTransfer('c2', listener)

    unsubscribe()
    offerHulls('c2', offer())

    expect(listener).not.toHaveBeenCalled()
  })

  it('forgets everything when reset', () => {
    offerHulls('c2', offer())
    setDragged(carrying())
    setCopied(carrying())

    resetHullTransfers()

    expect(peekTransfer('c2')).toBeUndefined()
    expect(getDragged()).toBeNull()
    expect(getCopied()).toBeNull()
  })
})
