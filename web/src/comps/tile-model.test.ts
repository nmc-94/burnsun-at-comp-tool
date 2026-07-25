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
import { SHIP, UNPRICED_TYPE_ID, atxxiiRuleset } from '../engine/__fixtures__/atxxii-mini'
import {
  annotate,
  deltaPill,
  EMPTY_SELECTION,
  introducedBy,
  previewHulls,
  previewRow,
  rowsBlamedBy,
  scaffold,
  searchHulls,
  selectRow,
  slotsAt,
  withFlagship,
  withHullsAdded,
  withRow,
} from './tile-model'
import type { RowSelection } from './tile-model'

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
    const summary = { pointsUsed: 200, pointCap: 200 } as never

    expect(deltaPill(summary)).toEqual({
      text: '±0',
      tone: 'exact',
      label: 'Exactly at the 200 point cap',
    })
  })

  it('reads a minus sign, not a hyphen, when under budget', () => {
    const pill = deltaPill({ pointsUsed: 198, pointCap: 200 } as never)

    expect(pill).toEqual({
      text: '−2',
      tone: 'under',
      label: '2 points under the 200 point cap',
    })
    expect(pill.text.charCodeAt(0)).toBe(0x2212)
  })

  it('reads +N over budget', () => {
    expect(deltaPill({ pointsUsed: 224, pointCap: 200 } as never)).toEqual({
      text: '+24',
      tone: 'over',
      label: '24 points over the 200 point cap',
    })
  })

  it('says the same thing in words as it shows in symbols', () => {
    // The two must agree: the pill once announced the total while displaying the delta,
    // so a screen reader and the screen disagreed about the same element.
    const under = deltaPill({ pointsUsed: 150, pointCap: 200 } as never)

    expect(under.text).toBe('−50')
    expect(under.label).toContain('50 points under')
  })

  it('agrees with what the engine says a real comp costs', () => {
    const result = judge(slots(SHIP.abaddon, SHIP.abaddon))

    // Two Abaddons: 40 base, inflation 4, so 44 each and 88 in total.
    expect(result.summary.pointsUsed).toBe(88)
    expect(deltaPill(result.summary).text).toBe('−112')
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

describe('slotsAt — the rows a person picked out', () => {
  it('returns them in row order, whatever order they were picked in', () => {
    const four = slots(SHIP.abaddon, SHIP.rifter, SHIP.orthrus, SHIP.svipul)

    expect(slotsAt(four, [2, 0]).map((slot) => slot.typeId)).toEqual([SHIP.abaddon, SHIP.orthrus])
  })

  it('takes a row once however many times it is named', () => {
    const two = slots(SHIP.abaddon, SHIP.rifter)

    expect(slotsAt(two, [1, 1, 1])).toEqual([{ typeId: SHIP.rifter, isFlagship: false }])
  })

  it('ignores a row that is not there rather than producing a hole', () => {
    const two = slots(SHIP.abaddon, SHIP.rifter)

    expect(slotsAt(two, [0, 9])).toHaveLength(1)
  })

  it('carries the flagship designation, because a subset holds at most one', () => {
    const three: CompSlot[] = [
      { typeId: SHIP.abaddon, isFlagship: false },
      { typeId: SHIP.vindicator, isFlagship: true },
      { typeId: SHIP.rifter, isFlagship: false },
    ]

    expect(slotsAt(three, [1, 2])).toEqual([
      { typeId: SHIP.vindicator, isFlagship: true },
      { typeId: SHIP.rifter, isFlagship: false },
    ])
  })
})

describe('withHullsAdded — hulls arriving from another comp', () => {
  it('appends them in the order given, leaving what was there alone', () => {
    const one = slots(SHIP.abaddon)

    expect(withHullsAdded(one, [SHIP.rifter, SHIP.orthrus]).map((slot) => slot.typeId)).toEqual([
      SHIP.abaddon,
      SHIP.rifter,
      SHIP.orthrus,
    ])
  })

  it('never brings a flagship with it, so two can never meet', () => {
    // The receiving comp may already have one, and the API answers a second with a 409.
    // Taking type ids rather than slots is what makes this true by construction.
    const flagged: CompSlot[] = [{ typeId: SHIP.vindicator, isFlagship: true }]

    expect(withHullsAdded(flagged, [SHIP.typhoon])).toEqual([
      { typeId: SHIP.vindicator, isFlagship: true },
      { typeId: SHIP.typhoon, isFlagship: false },
    ])
  })

  it('adds nothing when nothing is offered', () => {
    const two = slots(SHIP.abaddon, SHIP.rifter)

    expect(withHullsAdded(two, [])).toEqual(two)
  })

  it('lands the hull past the field size rather than swallowing it', () => {
    // Nothing here refuses a copy. An eleventh hull is a violation the receiving tile
    // reports, not an edit that quietly does not happen.
    const full = slots(...Array<number>(10).fill(SHIP.rifter))

    const after = previewHulls(full, [SHIP.rifter], atxxiiRuleset)

    expect(after.slots).toHaveLength(11)
    expect(after.violations.map((violation) => violation.code)).toContain('over-field-size')
  })
})

describe('previewHulls — judged by the comp receiving them', () => {
  it('reprices the copies already there, the way a swap does', () => {
    const two = slots(SHIP.orthrus, SHIP.orthrus)
    expect(costs(two)).toEqual([21, 21])

    const after = previewHulls(two, [SHIP.orthrus], atxxiiRuleset)

    // Three now, so 23 each — a hull arriving made the two that were already here dearer.
    expect(after.slots.map((slot) => slot.points)).toEqual([23, 23, 23])
    expect(after.summary.pointsUsed).toBe(69)
  })

  it('disagrees with adding the arriving hull at its list price', () => {
    const two = slots(SHIP.orthrus, SHIP.orthrus)
    const current = judge(two)
    const after = previewHulls(two, [SHIP.orthrus], atxxiiRuleset)

    const honest = after.summary.pointsUsed - current.summary.pointsUsed

    expect(honest).toBe(27)
    expect(honest).not.toBe(19)
  })

  it('reports a hull its ruleset does not price rather than refusing it', () => {
    // What a copy out of a comp pinned to another version looks like on arrival.
    const one = slots(SHIP.rifter)

    const after = previewHulls(one, [UNPRICED_TYPE_ID], atxxiiRuleset)

    expect(after.slots[1]?.resolved).toBe(false)
    expect(after.violations.map((violation) => violation.code)).toContain('unlisted-hull')
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

describe('selectRow', () => {
  it('adds a row, and takes the same row back out', () => {
    const one = selectRow(EMPTY_SELECTION, 2)
    expect(one.rows).toEqual([2])

    expect(selectRow(one, 2).rows).toEqual([])
  })

  it('keeps the rows in row order however they were picked', () => {
    const picked = [5, 1, 3].reduce(selectRowAt, EMPTY_SELECTION)

    expect(picked.rows).toEqual([1, 3, 5])
  })

  it('extends from the anchor with shift, upwards or down', () => {
    const anchored = selectRow(EMPTY_SELECTION, 4)

    expect(selectRow(anchored, 7, { range: true }).rows).toEqual([4, 5, 6, 7])
    expect(selectRow(anchored, 1, { range: true }).rows).toEqual([1, 2, 3, 4])
  })

  it('leaves the anchor where it was, so a second shift-click re-extends from the start', () => {
    const anchored = selectRow(EMPTY_SELECTION, 4)
    const wide = selectRow(anchored, 7, { range: true })

    expect(wide.anchor).toBe(4)
    expect(selectRow(wide, 6, { range: true }).rows).toEqual([4, 5, 6, 7])
  })

  it('behaves as a plain pick when shift arrives with nothing to extend from', () => {
    expect(selectRow(EMPTY_SELECTION, 3, { range: true }).rows).toEqual([3])
  })

  it('never adds a row twice when ranges overlap', () => {
    const first = selectRow(selectRow(EMPTY_SELECTION, 1), 4, { range: true })
    const second = selectRow(selectRow(first, 3), 6, { range: true })

    expect(second.rows).toEqual([1, 2, 3, 4, 5, 6])
  })
})

function selectRowAt(selection: RowSelection, index: number): RowSelection {
  return selectRow(selection, index)
}
