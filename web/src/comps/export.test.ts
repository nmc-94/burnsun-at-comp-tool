// The two text formats, pinned as golden strings.
//
// Worth pinning because they are the one output nothing else in the application validates: a
// wrong number here is wrong in somebody's Discord message, where no test and no type will
// ever catch it. The numbers all come off `SlotEvaluation`, so a duplicate hull's surcharge
// appears without this module knowing what a surcharge is.

import { describe, expect, it } from 'vitest'

import { hullListText, summaryText } from './export'
import { toEngineComp } from './tile-model'
import { SHIP, UNPRICED_TYPE_ID, atxxiiRuleset } from '../engine/__fixtures__/atxxii-mini'
import { evaluate } from '../engine'

const judge = (slots: { position: number; typeId: number; isFlagship: boolean }[]) =>
  evaluate(toEngineComp(slots), atxxiiRuleset)

const slot = (position: number, typeId: number, isFlagship = false) => ({
  position,
  typeId,
  isFlagship,
})

describe('the readable summary', () => {
  it('leads with the budget and the ruleset that priced it', () => {
    const result = judge([slot(0, SHIP.vindicator), slot(1, SHIP.rifter)])

    expect(summaryText('Angel Shield Kite', 'atxxii', '2026-07-23', result)).toBe(
      [
        'Angel Shield Kite — 54/200 points (atxxii 2026-07-23)',
        '1. Vindicator (Battleship) — 50 pts',
        '2. Rifter (Frigate) — 4 pts',
      ].join('\n'),
    )
  })

  it('marks the flagship, because which hull it is changes what the comp may field', () => {
    const result = judge([slot(0, SHIP.typhoon, true)])

    expect(summaryText('One Ship', 'atxxii', '2026-07-23', result)).toContain(
      '1. Typhoon (Battleship) — 40 pts [flagship]',
    )
  })

  it('charges a duplicate what the engine says it costs, surcharge and all', () => {
    // Never re-derived here: both copies re-price, and a formatter doing its own arithmetic
    // would be a second opinion on what a comp costs.
    const result = judge([slot(0, SHIP.vindicator), slot(1, SHIP.vindicator)])
    const text = summaryText('Twins', 'atxxii', '2026-07-23', result)

    expect(text).toContain(`1. Vindicator (Battleship) — ${result.slots[0]?.points} pts`)
    expect(result.slots[0]?.surcharge).toBeGreaterThan(0)
  })

  it('says something honest about a hull the ruleset does not price', () => {
    const result = judge([slot(0, UNPRICED_TYPE_ID)])

    expect(summaryText('Mystery', 'atxxii', '2026-07-23', result)).toContain(
      `1. Hull ${UNPRICED_TYPE_ID} — 0 pts`,
    )
  })
})

describe('the hull list', () => {
  it('is names only, one per line, in comp order', () => {
    // Order is information — the comp is an ordered list — and annotations would choke
    // whatever this gets pasted into.
    const result = judge([slot(0, SHIP.vindicator), slot(1, SHIP.rifter), slot(2, SHIP.rifter)])

    expect(hullListText(result)).toBe('Vindicator\nRifter\nRifter')
  })

  it('carries no flagship marker and no points', () => {
    const result = judge([slot(0, SHIP.typhoon, true)])

    expect(hullListText(result)).toBe('Typhoon')
  })
})
