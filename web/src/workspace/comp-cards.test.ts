// The derived store the rail reads. The property that matters is isolation: publishing one
// comp must not wake the listener for another, because that is the whole reason this exists
// rather than a piece of board state.

import { afterEach, describe, expect, it, vi } from 'vitest'

import { getCard, publishCard, resetCompCards, seedCards, subscribeCard } from './comp-cards'
import type { CompCard } from './comp-cards'

const card = (id: string, overrides: Partial<CompCard> = {}): CompCard => ({
  id,
  name: `Comp ${id}`,
  pointsUsed: 200,
  legal: true,
  leadTypeId: 24_692,
  ...overrides,
})

afterEach(resetCompCards)

describe('comp cards', () => {
  it('seeds the store from the team listing', () => {
    seedCards([card('c1'), card('c2', { legal: false })])

    expect(getCard('c1')?.pointsUsed).toBe(200)
    expect(getCard('c2')?.legal).toBe(false)
  })

  it('tells only the subscriber for the comp that changed', () => {
    const onOne = vi.fn()
    const onTwo = vi.fn()
    subscribeCard('c1', onOne)
    subscribeCard('c2', onTwo)

    publishCard(card('c1', { pointsUsed: 198 }))

    expect(onOne).toHaveBeenCalledTimes(1)
    expect(onTwo).not.toHaveBeenCalled()
  })

  it('stays quiet when a republished card says nothing new', () => {
    seedCards([card('c1')])
    const listener = vi.fn()
    subscribeCard('c1', listener)

    publishCard(card('c1'))

    expect(listener).not.toHaveBeenCalled()
  })

  it('announces each field that a rail leaf actually draws', () => {
    seedCards([card('c1')])
    const listener = vi.fn()
    subscribeCard('c1', listener)

    publishCard(card('c1', { name: 'Renamed' }))
    publishCard(card('c1', { name: 'Renamed', pointsUsed: 176 }))
    publishCard(card('c1', { name: 'Renamed', pointsUsed: 176, legal: false }))
    publishCard(card('c1', { name: 'Renamed', pointsUsed: 176, legal: false, leadTypeId: 587 }))

    expect(listener).toHaveBeenCalledTimes(4)
  })

  it('stops telling a listener that has unsubscribed', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeCard('c1', listener)

    unsubscribe()
    publishCard(card('c1', { pointsUsed: 12 }))

    expect(listener).not.toHaveBeenCalled()
  })

  it('tells every listener on one comp', () => {
    const first = vi.fn()
    const second = vi.fn()
    subscribeCard('c1', first)
    subscribeCard('c1', second)

    publishCard(card('c1', { pointsUsed: 12 }))

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('forgets everything when reset', () => {
    seedCards([card('c1')])

    resetCompCards()

    expect(getCard('c1')).toBeUndefined()
  })
})
