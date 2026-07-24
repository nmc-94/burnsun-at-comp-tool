// The legality engine's golden corpus.
//
// Point math is the product's whole value, so it is pinned here against known comps
// rather than trusted to review. The fixtures use real ATXXII values (see
// ./__fixtures__/atxxii-mini.ts), which means every number below can be checked by hand
// against docs/sources/points-atxxii-2026-07-23.csv and docs/ruleset-atxxii.md.

import { describe, expect, it } from 'vitest'

import { duplicateSurcharge, evaluate } from './index'
import type { Comp, Ruleset } from './index'
import {
  bannedTyphoonRuleset,
  escalatingRuleset,
  flatRuleset,
  prelimRuleset,
  SHIP,
} from './__fixtures__/atxxii-mini'
import * as comps from './__fixtures__/comps'

function codes(comp: Comp, ruleset: Ruleset = escalatingRuleset): string[] {
  return evaluate(comp, ruleset).violations.map((violation) => violation.code)
}

describe('duplicateSurcharge', () => {
  it('charges nothing for the first copy of a hull', () => {
    expect(duplicateSurcharge(0, 4, 'flat')).toBe(0)
    expect(duplicateSurcharge(0, 4, 'escalating')).toBe(0)
  })

  it('agrees on the second copy and diverges from the third', () => {
    expect(duplicateSurcharge(1, 2, 'flat')).toBe(2)
    expect(duplicateSurcharge(1, 2, 'escalating')).toBe(2)

    expect(duplicateSurcharge(2, 2, 'flat')).toBe(2)
    expect(duplicateSurcharge(2, 2, 'escalating')).toBe(4)

    expect(duplicateSurcharge(3, 2, 'flat')).toBe(2)
    expect(duplicateSurcharge(3, 2, 'escalating')).toBe(6)
  })

  it('leaves hulls with no inflation value free to duplicate', () => {
    expect(duplicateSurcharge(3, 0, 'escalating')).toBe(0)
  })
})

describe('the mockup example comps', () => {
  // These carry at most two copies of any hull, so both inflation readings must agree.
  for (const ruleset of [escalatingRuleset, flatRuleset]) {
    for (const example of comps.mockupComps) {
      it(`${example.label} (${ruleset.inflationMode})`, () => {
        const { summary, violations } = evaluate(example.comp, ruleset)

        expect(summary.pointsUsed).toBe(example.pointsUsed)
        expect(summary.pointsRemaining).toBe(200 - example.pointsUsed)
        expect(summary.pointsLeftOnTable).toBe(Math.max(0, 200 - example.pointsUsed))
        expect(summary.legal).toBe(example.legal)
        expect(violations.map((violation) => violation.code)).toEqual(example.violationCodes)
      })
    }
  }

  it('breaks the dual-Orthrus comp down per slot the way the tile renders it', () => {
    const dualOrthrus = comps.mockupComps[2]!
    const { slots } = evaluate(dualOrthrus.comp, escalatingRuleset)

    // Two Orthrus (base 19, inflation 2) and two Svipul (base 10, inflation 1).
    expect(slots.map((slot) => slot.surcharge)).toEqual([0, 0, 0, 0, 2, 0, 1, 0, 0, 0])
    expect(slots[3]).toMatchObject({ name: 'Orthrus', basePoints: 19, points: 19, copyIndex: 0 })
    expect(slots[4]).toMatchObject({ name: 'Orthrus', basePoints: 19, points: 21, copyIndex: 1 })
    expect(slots[6]).toMatchObject({ name: 'Svipul', basePoints: 10, points: 11, copyIndex: 1 })
  })

  it('reports the over-budget comp in a stable order', () => {
    const tripleBattleship = comps.mockupComps[3]!
    const { violations } = evaluate(tripleBattleship.comp, escalatingRuleset)

    expect(violations[0]).toMatchObject({
      code: 'over-budget',
      message: 'Over budget by 24 points',
    })
    expect(violations[1]).toMatchObject({
      code: 'hull-size-cap',
      message: '3 battleships — cap is 2',
    })
  })
})

describe('duplicate-hull inflation', () => {
  it('costs a pair identically under both readings', () => {
    expect(evaluate(comps.doubleSvipul, flatRuleset).summary.pointsUsed).toBe(21)
    expect(evaluate(comps.doubleSvipul, escalatingRuleset).summary.pointsUsed).toBe(21)
  })

  it('costs a third copy differently under each reading', () => {
    const flat = evaluate(comps.tripleSvipul, flatRuleset)
    const escalating = evaluate(comps.tripleSvipul, escalatingRuleset)

    expect(flat.slots.map((slot) => slot.surcharge)).toEqual([0, 1, 1])
    expect(flat.summary.pointsUsed).toBe(32)

    expect(escalating.slots.map((slot) => slot.surcharge)).toEqual([0, 1, 2])
    expect(escalating.summary.pointsUsed).toBe(33)
  })
})

describe('two-layer point resolution', () => {
  it('prices a hull the per-ship table omits through its class bucket', () => {
    const { summary, violations } = evaluate(comps.classPricedHull, escalatingRuleset)

    expect(summary.pointsUsed).toBe(9)
    expect(violations).toEqual([])
  })

  it('prefers the individual value over the class value', () => {
    const { slots, summary } = evaluate(comps.individualOverridesClass, escalatingRuleset)

    // Megathron 39 against a Battleship bucket of 40; Maulus 7 against a Tech 1
    // Disruption Frigate bucket of 6.
    expect(slots.map((slot) => slot.basePoints)).toEqual([39, 7])
    expect(summary.pointsUsed).toBe(46)
  })

  it('rejects a hull neither layer prices', () => {
    const { slots, violations } = evaluate(comps.unpricedHull, escalatingRuleset)

    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({ code: 'unlisted-hull', slotIndexes: [0] })
    expect(slots[0]).toMatchObject({ resolved: false, basePoints: 0, points: 0 })
  })

  it('rejects a hull its class prices but the ruleset excludes', () => {
    const { violations } = evaluate(comps.bannedHull, escalatingRuleset)

    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({ code: 'banned-hull', message: 'Nestor is banned' })
  })
})

describe('count caps', () => {
  it('caps battleships at two without a flagship', () => {
    const { summary, violations } = evaluate(
      comps.thirdBattleshipWithoutFlagship,
      escalatingRuleset,
    )

    expect(summary.battleshipAllowance).toBe(2)
    expect(violations.map((violation) => violation.code)).toEqual(['hull-size-cap'])
    expect(violations[0]?.fix).toContain('designate a flagship')
  })

  it('allows a third battleship once one of them is the flagship', () => {
    const { summary, violations } = evaluate(comps.thirdBattleshipWithFlagship, escalatingRuleset)

    expect(summary.battleshipAllowance).toBe(3)
    expect(summary.flagshipSlotIndex).toBe(2)
    expect(violations).toEqual([])
  })

  it('exempts logistics from the hull-size cap', () => {
    // Three Orthrus plus a Scimitar is four cruiser hulls but only three that count.
    const { summary, violations } = evaluate(comps.threeCruisersPlusLogi, escalatingRuleset)

    expect(summary.hullSizeCounts.Cruiser).toBe(3)
    expect(summary.logisticsCounts).toEqual({ cruiser: 1, frigate: 0 })
    expect(summary.pointsUsed).toBe(95)
    expect(violations).toEqual([])
  })

  it('blames only the slots that count when a size cap is breached', () => {
    const { summary, violations } = evaluate(comps.fourCruisersPlusLogi, escalatingRuleset)

    expect(summary.hullSizeCounts.Cruiser).toBe(4)
    expect(violations.map((violation) => violation.code)).toEqual(['hull-size-cap'])
    // The Scimitar in slot 4 is a cruiser hull, but an exempt one — dropping it would
    // not fix anything.
    expect(violations[0]?.slotIndexes).toEqual([0, 1, 2, 3])
  })

  it('caps the field size', () => {
    const { summary, violations } = evaluate(comps.overFieldSize, escalatingRuleset)

    expect(summary.shipCount).toBe(11)
    expect(summary.pointsUsed).toBe(175)
    expect(violations.map((violation) => violation.code)).toEqual(['over-field-size'])
    expect(violations[0]?.message).toBe('11 ships (max 10)')
  })
})

describe('per-match logistics limit', () => {
  it('permits one logistics cruiser', () => {
    expect(codes({ slots: [{ typeId: SHIP.scimitar }] })).toEqual([])
  })

  it('rejects two logistics cruisers', () => {
    expect(codes(comps.twoLogisticsCruisers)).toEqual(['logistics-limit'])
  })

  it('rejects mixing a logistics cruiser with a logistics frigate', () => {
    expect(codes(comps.logisticsCruiserAndFrigate)).toEqual(['logistics-limit'])
  })

  it('permits two logistics frigates', () => {
    expect(codes(comps.twoLogisticsFrigates)).toEqual([])
  })

  it('rejects three logistics frigates', () => {
    expect(codes(comps.threeLogisticsFrigates)).toEqual(['logistics-limit'])
  })
})

describe('flagships', () => {
  it('rejects a hull the ruleset bars from flagship status', () => {
    const { summary, violations } = evaluate(comps.ineligibleFlagship, escalatingRuleset)

    expect(violations.map((violation) => violation.code)).toEqual(['flagship-not-eligible'])
    // An invalid designation must not raise the battleship allowance.
    expect(summary.battleshipAllowance).toBe(2)
  })

  it('rejects a second flagship', () => {
    expect(codes(comps.twoFlagships)).toEqual(['multiple-flagships'])
  })

  it('rejects any flagship in a format that forbids them', () => {
    const flagshipComp = comps.mockupComps[1]!.comp

    expect(codes(flagshipComp, prelimRuleset)).toEqual(['flagship-not-allowed'])
    expect(evaluate(flagshipComp, prelimRuleset).summary.battleshipAllowance).toBe(2)
  })

  it('lets the flagship field a hull that is banned', () => {
    expect(codes(comps.bannedHullAsNormalSlot, bannedTyphoonRuleset)).toEqual(['banned-hull'])
    expect(codes(comps.bannedHullAsFlagship, bannedTyphoonRuleset)).toEqual([])
  })
})

describe('budget reporting', () => {
  it('treats an empty comp as legal with the whole budget unspent', () => {
    const { summary, slots, violations } = evaluate(comps.emptyComp, escalatingRuleset)

    expect(summary).toMatchObject({
      legal: true,
      pointsUsed: 0,
      pointsRemaining: 200,
      pointsLeftOnTable: 200,
      shipCount: 0,
      flagshipSlotIndex: null,
    })
    expect(slots).toEqual([])
    expect(violations).toEqual([])
  })

  it('reports nothing left on the table once a comp is over budget', () => {
    const { summary } = evaluate(comps.mockupComps[3]!.comp, escalatingRuleset)

    expect(summary.pointsRemaining).toBe(-24)
    expect(summary.pointsLeftOnTable).toBe(0)
  })

  it('gives every violation an actionable one-line fix', () => {
    const allViolations = [
      ...evaluate(comps.mockupComps[3]!.comp, escalatingRuleset).violations,
      ...evaluate(comps.unpricedHull, escalatingRuleset).violations,
      ...evaluate(comps.twoLogisticsCruisers, escalatingRuleset).violations,
      ...evaluate(comps.overFieldSize, escalatingRuleset).violations,
      ...evaluate(comps.ineligibleFlagship, escalatingRuleset).violations,
      ...evaluate(comps.twoFlagships, escalatingRuleset).violations,
      ...evaluate(comps.mockupComps[1]!.comp, prelimRuleset).violations,
    ]

    expect(allViolations.length).toBeGreaterThan(0)
    for (const violation of allViolations) {
      expect(violation.message).not.toContain('\n')
      expect(violation.fix.length).toBeGreaterThan(0)
      expect(violation.fix).not.toContain('\n')
    }
  })
})

describe('purity', () => {
  it('does not touch its inputs and repeats itself exactly', () => {
    const ruleset: Ruleset = structuredClone(escalatingRuleset)
    const comp: Comp = structuredClone(comps.mockupComps[2]!.comp)
    const rulesetBefore = structuredClone(ruleset)
    const compBefore = structuredClone(comp)

    const first = evaluate(comp, ruleset)
    const second = evaluate(comp, ruleset)

    expect(second).toEqual(first)
    expect(ruleset).toEqual(rulesetBefore)
    expect(comp).toEqual(compBefore)
  })

  it('runs against frozen inputs', () => {
    const ruleset = deepFreeze(structuredClone(escalatingRuleset))
    const comp = deepFreeze(structuredClone(comps.mockupComps[0]!.comp))

    expect(evaluate(comp, ruleset).summary.pointsUsed).toBe(200)
  })
})

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const nested of Object.values(value)) deepFreeze(nested)
  return value
}
