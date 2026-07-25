// The cross-language contract.
//
// The payload is assembled in Python and read here; nothing generates one from the other,
// so a renamed key would pass both suites and fail only in a browser. This closes that gap
// the cheap way: load a payload the ingester actually emitted, check every field the engine
// reads is present and of the right kind, then run the engine over it and check the answers.
//
// The comps are the mockup's own examples, reused from the golden corpus. They are the
// strongest check available — real hulls, real point values, and totals the design was
// drawn against — and running them against ingested data rather than a hand-built fixture
// is what proves the two halves of the app agree.
//
// Regenerate the payload with:
//   python -m comptool.ingest emit-payload --csv docs/sources/points-atxxii-2026-07-23.csv \
//       --ships docs/sources/ships-sde-3444265.json \
//       --out web/src/engine/__fixtures__/atxxii-2026-07-23.json

import { describe, expect, it } from 'vitest'

import { evaluate } from './evaluate'
import payloadJson from './__fixtures__/atxxii-2026-07-23.json?raw'
import { mockupComps } from './__fixtures__/comps'
import type { HullSize, Ruleset } from './types'

// Parsed, not imported as a module: this is external data under test, and typing it as
// `Ruleset` is the claim each assertion below is checking rather than something the
// compiler can know.
const ruleset = JSON.parse(payloadJson) as Ruleset

const HULL_SIZES: readonly HullSize[] = [
  'Corvette',
  'Frigate',
  'Destroyer',
  'Cruiser',
  'Battlecruiser',
  'Battleship',
  'Industrial',
]

describe('the ingested ATXXII payload', () => {
  it('carries every key the engine reads', () => {
    expect(Object.keys(ruleset).sort()).toEqual([
      'banPhase',
      'classPoints',
      'fieldSize',
      'flagship',
      'hullSizeCaps',
      'logisticsLimits',
      'pointCap',
      'ships',
      'version',
    ])
    expect(ruleset.version).toBe('2026-07-23')
    expect(ruleset.pointCap).toBe(200)
    expect(ruleset.fieldSize).toBe(10)
    expect(ruleset.hullSizeCaps).toEqual({
      Corvette: 3,
      Frigate: 3,
      Destroyer: 3,
      Cruiser: 3,
      Battlecruiser: 3,
      Battleship: 2,
      Industrial: 3,
    })
    expect(ruleset.logisticsLimits).toEqual({ cruiser: 1, frigate: 2, exclusive: true })
    expect(ruleset.flagship).toEqual({ allowed: true, battleshipAllowance: 3 })
  })

  it('carries §8 ban phase whole, so the client never has to know the numbers', () => {
    expect(ruleset.banPhase).toEqual({
      sequence: [
        { side: 'red', bans: 1, inPrelims: true },
        { side: 'blue', bans: 2, inPrelims: true },
        { side: 'red', bans: 2, inPrelims: true },
        { side: 'blue', bans: 1, inPrelims: true },
        { side: 'red', bans: 1, inPrelims: false },
        { side: 'blue', bans: 1, inPrelims: false },
      ],
      caps: { perHullSize: 3, logistics: 2 },
    })
  })

  it('caps logistics bans over exactly the hulls that carry a logistics group', () => {
    // The cap keys off `logisticsGroup` rather than shipping its own list of eighteen hulls.
    // That is only sound while the two describe the same set, which the ingester asserts and
    // this re-checks from the other side of the wire.
    const logi = Object.values(ruleset.ships).filter((ship) => ship.logisticsGroup !== null)
    expect(logi).toHaveLength(18)
    expect(new Set(logi.map((ship) => ship.logisticsGroup))).toEqual(
      new Set(['cruiser', 'frigate']),
    )
  })

  it('describes every ship in full', () => {
    // Collected rather than asserted one at a time, so a rename reports every hull it
    // broke instead of only the first.
    const problems: string[] = []
    for (const [key, ship] of Object.entries(ruleset.ships)) {
      const fault =
        ship.typeId !== Number(key)
          ? `keyed by ${key} but carries typeId ${ship.typeId}`
          : typeof ship.name !== 'string' || ship.name === ''
            ? 'has no name'
            : ship.points !== null && typeof ship.points !== 'number'
              ? 'has a non-numeric points value'
              : typeof ship.shipClass !== 'string'
                ? 'has no shipClass'
                : !HULL_SIZES.includes(ship.hullSize)
                  ? `has hullSize ${String(ship.hullSize)}`
                  : typeof ship.inflationValue !== 'number'
                    ? 'has a non-numeric inflationValue'
                    : ship.logisticsGroup !== null &&
                        ship.logisticsGroup !== 'cruiser' &&
                        ship.logisticsGroup !== 'frigate'
                      ? `has logisticsGroup ${String(ship.logisticsGroup)}`
                      : typeof ship.banned !== 'boolean'
                        ? 'has a non-boolean banned'
                        : typeof ship.flagshipEligible !== 'boolean'
                          ? 'has a non-boolean flagshipEligible'
                          : null
      if (fault !== null) problems.push(`${ship.name || key} ${fault}`)
    }
    expect(problems).toEqual([])
    expect(Object.keys(ruleset.ships)).toHaveLength(278)
  })

  it('prices every listed hull, so the class layer never has to', () => {
    const unpriced = Object.values(ruleset.ships).filter((ship) => ship.points === null)
    expect(unpriced).toEqual([])
    // The fallback layer is still served in full: it is part of the ruleset, and the next
    // snapshot may well need it.
    expect(Object.keys(ruleset.classPoints)).toHaveLength(42)
    expect(ruleset.classPoints.Battleship).toBe(40)
    expect(ruleset.classPoints['Tech 2 Industrial Ships']).toBe(10)
  })

  it('reads inflation values verbatim rather than deriving them from hull size', () => {
    const byName = Object.fromEntries(
      Object.values(ruleset.ships).map((ship) => [ship.name, ship]),
    )
    // The Geri is the snapshot's one deliberate exception: a frigate carrying 3 where every
    // other frigate carries 0. Deriving inflation from hull size would silently lose it.
    expect(byName.Geri?.inflationValue).toBe(3)
    expect(byName.Geri?.hullSize).toBe('Frigate')
    expect(byName.Shapash?.inflationValue).toBe(0)
    expect(byName.Rifter?.inflationValue).toBe(0)
  })

  it('excludes by omission, so nothing needs a ban flag', () => {
    expect(Object.values(ruleset.ships).filter((ship) => ship.banned)).toEqual([])
    const names = new Set(Object.values(ruleset.ships).map((ship) => ship.name))
    for (const excluded of ['Nestor', 'Marshal', 'Monitor', 'Venture', 'Cenotaph']) {
      expect(names.has(excluded)).toBe(false)
    }
  })

  it('makes every battleship but the Bhaalgorn flagship-eligible', () => {
    const eligible = Object.values(ruleset.ships).filter((ship) => ship.flagshipEligible)
    expect(eligible).toHaveLength(37)
    expect(eligible.every((ship) => ship.hullSize === 'Battleship')).toBe(true)
    const byName = Object.fromEntries(
      Object.values(ruleset.ships).map((ship) => [ship.name, ship]),
    )
    expect(byName.Bhaalgorn?.flagshipEligible).toBe(false)
    expect(byName.Praxis?.flagshipEligible).toBe(true)
  })
})

describe('the engine, run against the ingested payload', () => {
  it.each(mockupComps)('reproduces $label', ({ comp, pointsUsed, legal, violationCodes }) => {
    const result = evaluate(comp, ruleset)
    expect(result.summary.pointsUsed).toBe(pointsUsed)
    expect(result.summary.legal).toBe(legal)
    expect(result.violations.map((violation) => violation.code)).toEqual(violationCodes)
  })

  it('resolves every hull the mockup comps field', () => {
    for (const { comp } of mockupComps) {
      const unresolved = evaluate(comp, ruleset).slots.filter((slot) => !slot.resolved)
      expect(unresolved).toEqual([])
    }
  })
})
