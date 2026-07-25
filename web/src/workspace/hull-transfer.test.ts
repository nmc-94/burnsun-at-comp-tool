// The channel a hull crosses tiles through. Two properties carry the whole design:
// isolation — offering hulls to one comp must not wake another, because a store every tile
// subscribes to is board state wearing a different hat — and a snapshot that is the stored
// object, because `useSyncExternalStore` re-renders forever if it is not.

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  getDragged,
  offerHulls,
  peekTransfer,
  propose,
  resetHullTransfers,
  setDragged,
  subscribeTransfer,
  takeOffer,
} from './hull-transfer'
import type { HullOffer } from './hull-transfer'

const offer = (overrides: Partial<HullOffer> = {}): HullOffer => ({
  fromCompId: 'c1',
  fromName: 'Alpha',
  typeIds: [24_692],
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

    expect(takeOffer('c2')?.typeIds).toEqual([587, 609])
    expect(takeOffer('c2')).toBeUndefined()
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

    setDragged(offer())

    expect(getDragged()?.fromCompId).toBe('c1')
    expect(listener).not.toHaveBeenCalled()
  })

  it('is put down again when the drag ends', () => {
    setDragged(offer())

    setDragged(null)

    expect(getDragged()).toBeNull()
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
    setDragged(offer())

    resetHullTransfers()

    expect(peekTransfer('c2')).toBeUndefined()
    expect(getDragged()).toBeNull()
  })
})
