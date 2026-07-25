// The tile's arithmetic, proven against the same hand-checkable ruleset the engine's own
// golden corpus uses.
//
// The heart of this file is the swap corpus. A retroactive surcharge means removing a hull
// makes the copies that remain *cheaper*, and adding one makes the copies already there
// *more expensive* — so the price of a swap is never the price of the hull. Several tests
// below assert the naive answer and the right one differ, so that a future shortcut has
// something to fail against.

import { describe, expect, it } from 'vitest'

import { evaluate } from '../engine'
import type { CompSlot, Violation } from '../engine'
import { SHIP, atxxiiRuleset } from '../engine/__fixtures__/atxxii-mini'
import {
  annotate,
  deltaPill,
  introducedBy,
  previewRow,
  rowsBlamedBy,
  scaffold,
  searchHulls,
  withFlagship,
  withRow,
} from './tile-model'

function slots(...typeIds: number[]): CompSlot[] {
  return typeIds.map((typeId) => ({ typeId, isFlagship: false }))
}

function judge(list: readonly CompSlot[]) {
  return evaluate({ slots: list }, atxxiiRuleset)
}

function costs(list: readonly CompSlot[]): number[] {
  return judge(list).slots.map((slot) => slot.points)
}

describe('scaffold', () => {
  it('puts filled rows first and pads to the field size', () => {
    const rows = scaffold(judge(slots(SHIP.abaddon, SHIP.rifter)), 10)

    expect(rows).toHaveLength(10)
    expect(rows.filter((row) => row.kind === 'ship')).toHaveLength(2)
    expect(rows.slice(2).every((row) => row.kind === 'empty')).toBe(true)
    expect(rows.map((row) => row.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('is exactly the field size for a full comp, with nothing left to click', () => {
    const rows = scaffold(judge(slots(...Array(10).fill(SHIP.rifter))), 10)

    expect(rows).toHaveLength(10)
    expect(rows.some((row) => row.kind === 'empty')).toBe(false)
  })

  it('grows rather than hiding hulls when a comp is over the field size', () => {
    // Nothing refuses an eleventh hull — it is a violation, not a blocked action — so the
    // scaffold must not be the thing that quietly swallows it.
    const rows = scaffold(judge(slots(...Array(11).fill(SHIP.rifter))), 10)

    expect(rows).toHaveLength(11)
    expect(rows.every((row) => row.kind === 'ship')).toBe(true)
  })
})

describe('deltaPill', () => {
  it('reads ±0 at the cap', () => {
    // Five Vindicators at 50 base: four copies of surcharge apiece takes them well past
    // the cap, so build the exact case out of the cheap hull instead.
    const summary = { pointsUsed: 200, pointCap: 200 } as never

    expect(deltaPill(summary)).toEqual({ text: '±0', tone: 'exact' })
  })

  it('reads a minus sign, not a hyphen, when under budget', () => {
    const pill = deltaPill({ pointsUsed: 198, pointCap: 200 } as never)

    expect(pill).toEqual({ text: '−2', tone: 'under' })
    expect(pill.text.charCodeAt(0)).toBe(0x2212)
  })

  it('reads +N over budget', () => {
    expect(deltaPill({ pointsUsed: 224, pointCap: 200 } as never)).toEqual({
      text: '+24',
      tone: 'over',
    })
  })

  it('agrees with what the engine says a real comp costs', () => {
    const result = judge(slots(SHIP.abaddon, SHIP.abaddon))

    // Two Abaddons: 40 base, inflation 4, so 44 each and 88 in total.
    expect(result.summary.pointsUsed).toBe(88)
    expect(deltaPill(result.summary)).toEqual({ text: '−112', tone: 'under' })
  })
})

describe('withRow', () => {
  it('replaces the hull in place, leaving the order alone', () => {
    expect(withRow(slots(SHIP.abaddon, SHIP.rifter), 0, SHIP.orthrus)).toEqual([
      { typeId: SHIP.orthrus, isFlagship: false },
      { typeId: SHIP.rifter, isFlagship: false },
    ])
  })

  it('appends when the row is past the end, which is how an empty row fills', () => {
    expect(withRow(slots(SHIP.rifter), 4, SHIP.orthrus)).toHaveLength(2)
  })

  it('removes the row when given no hull, closing the gap behind it', () => {
    expect(withRow(slots(SHIP.abaddon, SHIP.rifter, SHIP.orthrus), 1, null)).toEqual([
      { typeId: SHIP.abaddon, isFlagship: false },
      { typeId: SHIP.orthrus, isFlagship: false },
    ])
  })

  it('keeps the flagship designation with the row through a swap', () => {
    // Whether the replacement may *be* the flagship is a rule, and the engine says so.
    // Silently dropping the designation here would hide that.
    const withFlag: CompSlot[] = [{ typeId: SHIP.vindicator, isFlagship: true }]

    expect(withRow(withFlag, 0, SHIP.rifter)).toEqual([{ typeId: SHIP.rifter, isFlagship: true }])
  })
})

describe('previewRow — the swap reprices every copy', () => {
  it('makes the copies that remain cheaper when a duplicate is swapped away', () => {
    const three = slots(SHIP.orthrus, SHIP.orthrus, SHIP.orthrus)
    // Three Orthrus: 19 base, inflation 2, so 23 each and 69 in total.
    expect(costs(three)).toEqual([23, 23, 23])

    const after = previewRow(three, 2, SHIP.rifter, atxxiiRuleset)

    // Two Orthrus now, so 21 each — the two rows nobody touched both got cheaper.
    expect(after.slots.map((slot) => slot.points)).toEqual([21, 21, 4])
    expect(after.summary.pointsUsed).toBe(46)
  })

  it('disagrees with subtracting the swapped row and adding the new hull', () => {
    const three = slots(SHIP.orthrus, SHIP.orthrus, SHIP.orthrus)
    const current = judge(three)
    const after = previewRow(three, 2, SHIP.rifter, atxxiiRuleset)

    const honest = after.summary.pointsUsed - current.summary.pointsUsed
    const naive = -23 + 4 // what the swapped row cost, plus what the new hull lists at

    expect(honest).toBe(-23)
    expect(naive).toBe(-19)
    expect(honest).not.toBe(naive)
  })

  it('makes the copies already there dearer when a duplicate is swapped in', () => {
    const two = slots(SHIP.orthrus, SHIP.orthrus, SHIP.rifter)
    expect(costs(two)).toEqual([21, 21, 4])

    const after = previewRow(two, 2, SHIP.orthrus, atxxiiRuleset)

    expect(after.slots.map((slot) => slot.points)).toEqual([23, 23, 23])
    expect(after.summary.pointsUsed).toBe(69)
  })

  it('reprices both hulls at once when a duplicate is traded for another duplicate', () => {
    // Two of each. Swapping an Orthrus for a Svipul makes it three Svipul and one Orthrus,
    // which moves the price of all four rows that stayed put.
    const mixed = slots(SHIP.orthrus, SHIP.orthrus, SHIP.svipul, SHIP.svipul)
    expect(costs(mixed)).toEqual([21, 21, 11, 11])

    const after = previewRow(mixed, 1, SHIP.svipul, atxxiiRuleset)

    // One Orthrus at its base 19, three Svipul at 10 + 2 × 1 = 12.
    expect(after.slots.map((slot) => slot.points)).toEqual([19, 12, 12, 12])
  })

  it('costs an empty row being filled as a full re-judgement too', () => {
    const two = slots(SHIP.abaddon, SHIP.abaddon)
    const after = previewRow(two, 7, SHIP.abaddon, atxxiiRuleset)

    // Three Abaddons: 40 + 2 × 4 = 48 each, so the two already placed rose by 4 apiece.
    expect(after.slots.map((slot) => slot.points)).toEqual([48, 48, 48])
    expect(after.summary.pointsUsed - judge(two).summary.pointsUsed).toBe(56)
  })

  it('round-trips: swapping out and back returns the original prices', () => {
    const three = slots(SHIP.orthrus, SHIP.orthrus, SHIP.orthrus)
    const away = withRow(three, 2, SHIP.rifter)
    const back = withRow(away, 2, SHIP.orthrus)

    expect(costs(back)).toEqual(costs(three))
  })
})

describe('withFlagship', () => {
  it('moves the designation, leaving exactly one', () => {
    const three = slots(SHIP.vindicator, SHIP.abaddon, SHIP.rifter)

    const designated = withFlagship(withFlagship(three, 0), 1)

    expect(designated.map((slot) => slot.isFlagship)).toEqual([false, true, false])
  })

  it('clears the designation entirely when given no row', () => {
    const designated = withFlagship(slots(SHIP.vindicator), 0)

    expect(withFlagship(designated, null).map((slot) => slot.isFlagship)).toEqual([false])
  })

  it('lets an ineligible hull be designated, so the engine can say so', () => {
    // Refusing here would be enforcing a rule. The tool reports rules; it does not police
    // them, and `flagship-not-eligible` is how the builder finds out.
    const designated = withFlagship(slots(SHIP.rifter), 0)

    expect(judge(designated).violations.map((violation) => violation.code)).toContain(
      'flagship-not-eligible',
    )
  })
})

describe('rowsBlamedBy', () => {
  it('collects the rows a violation points at', () => {
    const overCap = judge(slots(SHIP.abaddon, SHIP.abaddon, SHIP.abaddon))
    const capViolation = overCap.violations.filter(
      (violation) => violation.code === 'hull-size-cap',
    )

    expect(rowsBlamedBy(capViolation)).toEqual(new Set([0, 1, 2]))
  })

  it('leaves logistics hulls out of a size cap, because they are exempt from it', () => {
    // Three Orthrus and a Scimitar are all cruiser-sized, but the Scimitar does not count
    // toward the cap — so it must not be offered up as the one to drop.
    const withLogi = slots(SHIP.orthrus, SHIP.orthrus, SHIP.orthrus, SHIP.orthrus, SHIP.scimitar)
    const capViolation = judge(withLogi).violations.filter(
      (violation) => violation.code === 'hull-size-cap',
    )

    expect(rowsBlamedBy(capViolation).has(4)).toBe(false)
  })

  it('blames no row for a comp-wide violation', () => {
    const wide: Violation[] = [
      { code: 'over-budget', message: 'x', fix: 'y', slotIndexes: [] },
    ]

    expect(rowsBlamedBy(wide).size).toBe(0)
  })
})

describe('introducedBy', () => {
  it('reports only what a pick would newly break', () => {
    const before = judge(slots(SHIP.abaddon, SHIP.abaddon, SHIP.abaddon))
    const after = previewRow(
      [...slots(SHIP.abaddon, SHIP.abaddon, SHIP.abaddon)],
      3,
      SHIP.abaddon,
      atxxiiRuleset,
    )

    const fresh = introducedBy(before.violations, after.violations)

    // The cap was already broken at three, so a fourth adds nothing new to say about it.
    expect(fresh.map((violation) => violation.code)).not.toContain('hull-size-cap')
  })

  it('names a rule the pick breaks for the first time', () => {
    const two = slots(SHIP.abaddon, SHIP.abaddon)
    const after = previewRow(two, 2, SHIP.abaddon, atxxiiRuleset)

    expect(introducedBy(judge(two).violations, after.violations).map((v) => v.code)).toEqual([
      'hull-size-cap',
    ])
  })
})

describe('searchHulls', () => {
  it('finds nothing for an empty query rather than offering the whole roster', () => {
    expect(searchHulls(atxxiiRuleset, '   ')).toEqual([])
  })

  it('matches case-insensitively on part of a name', () => {
    const found = searchHulls(atxxiiRuleset, 'vind')

    expect(found.map((ship) => ship.name)).toContain('Vindicator')
  })

  it('ranks every name that starts with the query above every one that merely contains it', () => {
    const names = searchHulls(atxxiiRuleset, 'ar', 500).map((ship) => ship.name)
    const starts = (name: string) => name.toLowerCase().startsWith('ar')
    const lastPrefix = names.findLastIndex(starts)
    const firstContained = names.findIndex((name) => !starts(name))

    // Both kinds are present — Armageddon leads, Garmur and Scimitar merely contain it.
    expect(names.filter(starts).length).toBeGreaterThan(0)
    expect(names.filter((name) => !starts(name)).length).toBeGreaterThan(0)
    expect(lastPrefix).toBeLessThan(firstContained)
  })

  it('honours the limit, so a broad query cannot cost a full re-judgement per hull', () => {
    expect(searchHulls(atxxiiRuleset, 'a', 3)).toHaveLength(3)
  })

  it('offers only hulls the ruleset lists, so an unpriced pick is unreachable', () => {
    const everything = searchHulls(atxxiiRuleset, 'a', 500)

    expect(everything.every((ship) => atxxiiRuleset.ships[ship.typeId])).toBe(true)
  })
})

describe('annotate', () => {
  it('prices each candidate by what it would do to this comp, not by its own value', () => {
    const two = slots(SHIP.orthrus, SHIP.orthrus)
    const current = judge(two)
    const orthrus = atxxiiRuleset.ships[SHIP.orthrus]
    if (!orthrus) throw new Error('fixture is missing the Orthrus')

    const [candidate] = annotate([orthrus], two, 2, atxxiiRuleset, current)

    // A third Orthrus lists at 19 but costs 27: itself at 23, plus 2 apiece on the two
    // already in the comp.
    expect(candidate?.delta).toBe(27)
    expect(orthrus.points).toBe(19)
  })

  it('flags what a pick would break without refusing to offer it', () => {
    const two = slots(SHIP.abaddon, SHIP.abaddon)
    const current = judge(two)
    const abaddon = atxxiiRuleset.ships[SHIP.abaddon]
    if (!abaddon) throw new Error('fixture is missing the Abaddon')

    const [candidate] = annotate([abaddon], two, 2, atxxiiRuleset, current)

    expect(candidate?.introduces.map((violation) => violation.code)).toEqual(['hull-size-cap'])
    expect(candidate?.ship.name).toBe('Abaddon')
  })
})
