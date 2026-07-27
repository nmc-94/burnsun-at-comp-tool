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
import type { Violation } from '../engine'
import { SHIP, UNPRICED_TYPE_ID, atxxiiRuleset } from '../engine/__fixtures__/atxxii-mini'
import {
  annotate,
  deltaPill,
  EMPTY_SELECTION,
  firstFreeRow,
  introducedBy,
  navigableRows,
  offersFlagship,
  previewRow,
  rowsBlamedBy,
  toEngineComp,
  scaffold,
  selectEvery,
  selectRow,
  slotsAt,
  withFlagship,
  withHullMovedTo,
  withHullOn,
  withHullsAdded,
  withRow,
} from './tile-model'
import type { PlacedSlot, RowSelection } from './tile-model'

/** Hulls on consecutive rows from zero — a comp nobody has arranged, which is nearly all of them. */
function slots(...typeIds: number[]): PlacedSlot[] {
  return typeIds.map((typeId, position) => ({ position, typeId, isFlagship: false }))
}

/** Hulls on the rows named: `placed([0, abaddon], [4, rifter])` leaves rows 1–3 empty. */
function placed(...rows: [number, number][]): PlacedSlot[] {
  return rows.map(([position, typeId]) => ({ position, typeId, isFlagship: false }))
}

/** Each hull's row, in slot order — what `scaffold` needs to draw a comp where it says it is. */
const rowsOf = (list: readonly PlacedSlot[]) => list.map((slot) => slot.position)

function judge(list: readonly PlacedSlot[]) {
  return evaluate(toEngineComp(list), atxxiiRuleset)
}

function costs(list: readonly PlacedSlot[]): number[] {
  return judge(list).slots.map((slot) => slot.points)
}

/** The hull names a scaffold draws, top to bottom, skipping the empty rows. */
function names(rows: ReturnType<typeof scaffold>): string[] {
  return rows.flatMap((row) => (row.kind === 'ship' ? [row.slot.name] : []))
}

describe('scaffold', () => {
  it('puts filled rows first and pads to the field size', () => {
    const rows = scaffold(judge(slots(SHIP.abaddon, SHIP.rifter)), 10)

    expect(rows).toHaveLength(10)
    expect(rows.filter((row) => row.kind === 'ship')).toHaveLength(2)
    expect(rows.slice(2).every((row) => row.kind === 'empty')).toBe(true)
    expect(rows.map((row) => row.row)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('is exactly the field size for a full comp, with nothing left to click', () => {
    const rows = scaffold(judge(slots(...Array(10).fill(SHIP.rifter))), 10)

    expect(rows).toHaveLength(10)
    expect(rows.some((row) => row.kind === 'empty')).toBe(false)
  })

  it('draws the expensive hulls first, whatever order they were stored in', () => {
    // A comp is read from the top down when you are deciding what to cut, and what you are
    // looking for is the expensive end of it.
    const rows = scaffold(judge(slots(SHIP.rifter, SHIP.abaddon, SHIP.orthrus)), 10)

    expect(names(rows)).toEqual(['Abaddon', 'Orthrus', 'Rifter'])
  })

  it('breaks a tie on points with the bigger hull', () => {
    // Both are 10 points and they are not the same commitment: a destroyer is a hull you lose
    // differently from a frigate.
    const rows = scaffold(judge(slots(SHIP.deacon, SHIP.svipul)), 10)

    expect(names(rows)).toEqual(['Svipul', 'Deacon'])
  })

  it('breaks a tie on points and size alphabetically, so the same comp always draws the same', () => {
    // Three tactical destroyers at 10 points each. Without this the order would be whatever the
    // slots happened to be stored in, and a comp would shuffle as it was edited.
    const rows = scaffold(judge(slots(SHIP.svipul, SHIP.jackdaw, SHIP.confessor)), 10)

    expect(names(rows)).toEqual(['Confessor', 'Jackdaw', 'Svipul'])
  })

  it('keeps every row pointing at the slot it is stored at', () => {
    // The sort is the array's order and nothing else. `index` is what a hull swap, a flagship
    // and a partial fork's row numbers all carry, and it has to survive the reordering or those
    // gestures act on the wrong hull — silently, since every index involved is a real row.
    const rows = scaffold(judge(slots(SHIP.rifter, SHIP.abaddon, SHIP.orthrus)), 10)

    expect(rows.slice(0, 3).map((row) => (row.kind === 'ship' ? row.at : -1))).toEqual([1, 2, 0])
    // And the empty rows still carry on from the end of the stored list, so filling one adds a
    // hull rather than overwriting.
    expect(rows.slice(3).map((row) => row.row)).toEqual([3, 4, 5, 6, 7, 8, 9])
  })

  it('draws the rows in stored order when the sort is turned off', () => {
    // The preference behind this is per browser and changes nothing about the comp — the sort
    // has only ever been how the rows are drawn. Which is exactly what this checks: the same
    // three hulls, the same three indexes, in the order they are stored.
    const rows = scaffold(judge(slots(SHIP.rifter, SHIP.abaddon, SHIP.orthrus)), 10, {
      sorted: false,
    })

    expect(names(rows)).toEqual(['Rifter', 'Abaddon', 'Orthrus'])
    expect(rows.slice(0, 3).map((row) => (row.kind === 'ship' ? row.at : -1))).toEqual([0, 1, 2])
    // And the scaffold is otherwise untouched: still a full field, still numbered on from the
    // end of the stored list.
    expect(rows).toHaveLength(10)
    expect(rows.slice(3).map((row) => row.row)).toEqual([3, 4, 5, 6, 7, 8, 9])
  })

  it('grows rather than hiding hulls when a comp is over the field size', () => {
    // Nothing refuses an eleventh hull — it is a violation, not a blocked action — so the
    // scaffold must not be the thing that quietly swallows it.
    const rows = scaffold(judge(slots(...Array(11).fill(SHIP.rifter))), 10)

    expect(rows).toHaveLength(11)
    expect(rows.every((row) => row.kind === 'ship')).toBe(true)
  })

  it('leaves the empty rows between hulls empty when the sort is off', () => {
    // The whole point of arranging a comp: a group of hulls, a gap, another group. Under a
    // weight sort there is nowhere to put a gap, so this is the only mode it can show in.
    const comp = placed([0, SHIP.abaddon], [1, SHIP.rifter], [5, SHIP.orthrus])
    const rows = scaffold(judge(comp), 10, { rows: rowsOf(comp), sorted: false })

    expect(rows.map((row) => (row.kind === 'ship' ? row.slot.name : '—'))).toEqual([
      'Abaddon',
      'Rifter',
      '—',
      '—',
      '—',
      'Orthrus',
      '—',
      '—',
      '—',
      '—',
    ])
    expect(rows.map((row) => row.row)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('numbers each empty row for itself, so a hull typed into one lands there', () => {
    const comp = placed([0, SHIP.abaddon], [5, SHIP.orthrus])
    const rows = scaffold(judge(comp), 10, { rows: rowsOf(comp), sorted: false })

    const gaps = rows.flatMap((row) => (row.kind === 'empty' ? [[row.row, row.lands]] : []))
    expect(gaps).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
      [6, 6],
      [7, 7],
      [8, 8],
      [9, 9],
    ])
  })

  it('sends every empty row to the first free one when the rows are sorted', () => {
    // Sorted, the blank lines are drawn under the hulls rather than in their places, so
    // "this row" would be a lie — clicking the fourth of them would silently open a gap at the
    // first. All of them mean the next free row instead, which is what a weight sort implies.
    const comp = placed([0, SHIP.abaddon], [5, SHIP.orthrus])
    const rows = scaffold(judge(comp), 10, { rows: rowsOf(comp) })

    const empties = rows.flatMap((row) => (row.kind === 'empty' ? [row] : []))
    expect(empties.every((row) => row.lands === 1)).toBe(true)
    // Still the comp's own unused rows, so no two rows of the scaffold claim the same number.
    expect(empties.map((row) => row.row)).toEqual([1, 2, 3, 4, 6, 7, 8, 9])
    expect(names(rows)).toEqual(['Abaddon', 'Orthrus'])
  })

  it('keeps drawing an arrangement that reaches past the field size', () => {
    // The same promise the eleven-hull comp gets, arrived at the other way. A comp can be
    // re-pinned to a version with a smaller field after it was arranged, and a hull below the
    // new last row is exactly the thing a builder has to be able to see to fix.
    const comp = placed([0, SHIP.abaddon], [11, SHIP.rifter])
    const rows = scaffold(judge(comp), 10, { rows: rowsOf(comp), sorted: false })

    expect(rows).toHaveLength(12)
    expect(rows.at(-1)).toMatchObject({ kind: 'ship', row: 11 })
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
  it('replaces the hull in place, leaving the order and the row alone', () => {
    expect(withRow(slots(SHIP.abaddon, SHIP.rifter), 0, SHIP.orthrus)).toEqual([
      { position: 0, typeId: SHIP.orthrus, isFlagship: false },
      { position: 1, typeId: SHIP.rifter, isFlagship: false },
    ])
  })

  it('changes nothing when the index names no hull, because adding one is not its job', () => {
    // It used to append here, which was how an empty row filled — and that shortcut stopped
    // being expressible once a row could be empty in the middle of a comp. `withHullOn` names
    // the row instead, and this only ever edits a hull that is already there.
    expect(withRow(slots(SHIP.rifter), 4, SHIP.orthrus)).toEqual(slots(SHIP.rifter))
  })

  it('takes the hull out when given none, leaving the other rows where they are', () => {
    // The row it was on becomes empty rather than closing up: rows below it are somewhere
    // somebody put them, and a removal is not a request to move them.
    expect(withRow(slots(SHIP.abaddon, SHIP.rifter, SHIP.orthrus), 1, null)).toEqual([
      { position: 0, typeId: SHIP.abaddon, isFlagship: false },
      { position: 2, typeId: SHIP.orthrus, isFlagship: false },
    ])
  })

  it('keeps the flagship designation with the row through a swap', () => {
    // Whether the replacement may *be* the flagship is a rule, and the engine says so.
    // Silently dropping the designation here would hide that.
    const withFlag: PlacedSlot[] = [{ position: 0, typeId: SHIP.vindicator, isFlagship: true }]

    expect(withRow(withFlag, 0, SHIP.rifter)).toEqual([
      { position: 0, typeId: SHIP.rifter, isFlagship: true },
    ])
  })
})

describe('withHullOn — a hull put on a named row', () => {
  it('fills an empty row without disturbing the hulls either side of it', () => {
    const comp = placed([0, SHIP.abaddon], [5, SHIP.orthrus])

    expect(withHullOn(comp, 3, SHIP.rifter)).toEqual([
      { position: 0, typeId: SHIP.abaddon, isFlagship: false },
      { position: 3, typeId: SHIP.rifter, isFlagship: false },
      { position: 5, typeId: SHIP.orthrus, isFlagship: false },
    ])
  })

  it('replaces the hull already on that row, keeping the row and its flagship', () => {
    const comp: PlacedSlot[] = [{ position: 4, typeId: SHIP.vindicator, isFlagship: true }]

    expect(withHullOn(comp, 4, SHIP.abaddon)).toEqual([
      { position: 4, typeId: SHIP.abaddon, isFlagship: true },
    ])
  })

  it('keeps the list sorted by row, which every index in the file rests on', () => {
    // Array index is the engine's index. A hull spliced in out of order would misplace every
    // violation the tile draws, and nothing would say so.
    const built = withHullOn(withHullOn(slots(), 7, SHIP.rifter), 2, SHIP.abaddon)

    expect(built.map((slot) => slot.position)).toEqual([2, 7])
    expect(judge(built).slots.map((slot) => slot.name)).toEqual(['Abaddon', 'Rifter'])
  })
})

describe('withHullMovedTo — a hull carried to another row', () => {
  it('carries it to an empty row, leaving the one it came off empty', () => {
    const comp = placed([0, SHIP.abaddon], [1, SHIP.rifter])

    expect(withHullMovedTo(comp, 1, 6)).toEqual([
      { position: 0, typeId: SHIP.abaddon, isFlagship: false },
      { position: 6, typeId: SHIP.rifter, isFlagship: false },
    ])
  })

  it('trades places rather than throwing the other hull away', () => {
    // Overwriting would make rearranging a comp the one gesture in the tool that quietly
    // deletes something. The comp holds exactly what it held, in a different order.
    const comp = placed([0, SHIP.abaddon], [4, SHIP.rifter])

    expect(withHullMovedTo(comp, 0, 4)).toEqual([
      { position: 0, typeId: SHIP.rifter, isFlagship: false },
      { position: 4, typeId: SHIP.abaddon, isFlagship: false },
    ])
  })

  it('keeps the list sorted by row however far the hull travels', () => {
    const comp = placed([0, SHIP.abaddon], [1, SHIP.rifter], [2, SHIP.orthrus])

    expect(withHullMovedTo(comp, 0, 9).map((slot) => slot.position)).toEqual([1, 2, 9])
    expect(judge(withHullMovedTo(comp, 0, 9)).slots.map((slot) => slot.name)).toEqual([
      'Rifter',
      'Orthrus',
      'Abaddon',
    ])
  })

  it('takes the flagship with the hull, which is the opposite of a swap', () => {
    // `withRow` and `withHullOn` answer "what hull is on this row", so the designation is the
    // row's. This answers "where is this hull", so it is the hull's and travels.
    const comp: PlacedSlot[] = [
      { position: 0, typeId: SHIP.vindicator, isFlagship: true },
      { position: 3, typeId: SHIP.abaddon, isFlagship: false },
    ]

    expect(withHullMovedTo(comp, 0, 3)).toEqual([
      { position: 0, typeId: SHIP.abaddon, isFlagship: false },
      { position: 3, typeId: SHIP.vindicator, isFlagship: true },
    ])
  })

  it('changes nothing when the hull is put back where it already is', () => {
    const comp = placed([0, SHIP.abaddon], [4, SHIP.rifter])

    expect(withHullMovedTo(comp, 4, 4)).toEqual(comp)
  })

  it('changes nothing when no hull is on the row it is asked to carry', () => {
    // A stale view rather than a bug worth throwing over — the same posture the fork route
    // takes to a row number the comp no longer has.
    const comp = placed([0, SHIP.abaddon])

    expect(withHullMovedTo(comp, 7, 2)).toEqual(comp)
  })
})

describe('firstFreeRow', () => {
  it('is the lowest row no hull is on, which is not the same as the end', () => {
    expect(firstFreeRow(placed([0, SHIP.abaddon], [1, SHIP.rifter]))).toBe(2)
    expect(firstFreeRow(placed([0, SHIP.abaddon], [3, SHIP.rifter]))).toBe(1)
    expect(firstFreeRow(slots())).toBe(0)
  })
})

describe('slotsAt — the rows a person picked out', () => {
  it('returns them in row order, whatever order they were picked in', () => {
    const four = slots(SHIP.abaddon, SHIP.rifter, SHIP.orthrus, SHIP.svipul)

    expect(slotsAt(four, [2, 0]).map((slot) => slot.typeId)).toEqual([SHIP.abaddon, SHIP.orthrus])
  })

  it('takes a row once however many times it is named', () => {
    const two = slots(SHIP.abaddon, SHIP.rifter)

    expect(slotsAt(two, [1, 1, 1])).toEqual([
      { position: 1, typeId: SHIP.rifter, isFlagship: false },
    ])
  })

  it('ignores a row that is not there rather than producing a hole', () => {
    const two = slots(SHIP.abaddon, SHIP.rifter)

    expect(slotsAt(two, [0, 9])).toHaveLength(1)
  })

  it('carries the flagship designation, because a subset holds at most one', () => {
    const three: PlacedSlot[] = [
      { position: 0, typeId: SHIP.abaddon, isFlagship: false },
      { position: 1, typeId: SHIP.vindicator, isFlagship: true },
      { position: 2, typeId: SHIP.rifter, isFlagship: false },
    ]

    expect(slotsAt(three, [1, 2])).toEqual([
      { position: 1, typeId: SHIP.vindicator, isFlagship: true },
      { position: 2, typeId: SHIP.rifter, isFlagship: false },
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

  it('fills the gaps of an arranged comp rather than skipping past them', () => {
    // The same answer the empty row's own search gives. A copy that landed below the gaps would
    // be the one gesture in the tool that treats an arrangement as something to work around.
    const arranged = placed([0, SHIP.abaddon], [4, SHIP.orthrus])

    expect(withHullsAdded(arranged, [SHIP.rifter, SHIP.svipul]).map((slot) => slot.position)).toEqual(
      [0, 1, 2, 4],
    )
  })

  it('never brings a flagship with it, so two can never meet', () => {
    // The receiving comp may already have one, and the API answers a second with a 409.
    // Taking type ids rather than slots is what makes this true by construction.
    const flagged: PlacedSlot[] = [{ position: 0, typeId: SHIP.vindicator, isFlagship: true }]

    expect(withHullsAdded(flagged, [SHIP.typhoon])).toEqual([
      { position: 0, typeId: SHIP.vindicator, isFlagship: true },
      { position: 1, typeId: SHIP.typhoon, isFlagship: false },
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

    const after = judge(withHullsAdded(full, [SHIP.rifter]))

    expect(after.slots).toHaveLength(11)
    expect(after.violations.map((violation) => violation.code)).toContain('over-field-size')
  })

  it('reprices the copies already there, the way a swap does', () => {
    // The arrival is judged whole rather than added up: the duplicate surcharge is retroactive,
    // so a hull arriving makes every copy already in the comp dearer.
    const two = slots(SHIP.orthrus, SHIP.orthrus)
    expect(costs(two)).toEqual([21, 21])

    const after = judge(withHullsAdded(two, [SHIP.orthrus]))

    expect(after.slots.map((slot) => slot.points)).toEqual([23, 23, 23])
    expect(after.summary.pointsUsed).toBe(69)
    // 27, not the 19 an Orthrus lists at — which is why nothing in the tile ever adds a price.
    expect(after.summary.pointsUsed - judge(two).summary.pointsUsed).toBe(27)
  })

  it('reports a hull the receiving ruleset does not price rather than refusing it', () => {
    // What a copy out of a comp pinned to another version looks like on arrival. Judged by the
    // *receiving* comp's ruleset, which is the only one entitled to say what a hull costs here.
    const one = slots(SHIP.rifter)

    const after = judge(withHullsAdded(one, [UNPRICED_TYPE_ID]))

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

describe('offersFlagship — where the star is worth drawing', () => {
  /** The row the tile would be rendering, which is what the star is attached to. */
  function row(typeId: number, isFlagship = false) {
    const judged = judge([{ position: 0, typeId, isFlagship }])
    const slot = judged.slots[0]
    if (!slot) throw new Error('a one-hull comp has one slot')
    return slot
  }

  const noFlagships = {
    ...atxxiiRuleset,
    flagship: { ...atxxiiRuleset.flagship, allowed: false },
  }

  it('offers it on a hull the format lets hold one', () => {
    expect(offersFlagship(atxxiiRuleset, row(SHIP.abaddon))).toBe(true)
  })

  it.each([
    ['a frigate', SHIP.rifter],
    ['a battleship the rules bar from it', SHIP.bhaalgorn],
    ['a hull the ruleset does not price at all', UNPRICED_TYPE_ID],
  ])('withholds it from %s', (_case, typeId) => {
    expect(offersFlagship(atxxiiRuleset, row(typeId))).toBe(false)
  })

  it('withholds it from every hull in a format that forbids flagships', () => {
    expect(offersFlagship(noFlagships, row(SHIP.abaddon))).toBe(false)
  })

  it.each([
    ['a hull the rules bar from it', atxxiiRuleset, SHIP.bhaalgorn],
    ['a format that forbids them outright', noFlagships, SHIP.abaddon],
    ['a hull the ruleset does not price', atxxiiRuleset, UNPRICED_TYPE_ID],
  ])('keeps it on a row that already holds the designation — %s', (_case, ruleset, typeId) => {
    // The load-bearing half. A swap keeps the designation under a new hull, a comp can be
    // re-pinned to a version that forbids flagships, and the API can hand one over — three ways
    // into a state whose only way out is this control. Hiding it there would leave the engine
    // reporting a violation with nothing on screen to act on.
    expect(offersFlagship(ruleset, row(typeId, true))).toBe(true)
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
  it('replaces what was picked on a plain pick, which is what clicking a row means', () => {
    const first = selectRow(EMPTY_SELECTION, 2)
    expect(first.rows).toEqual([2])

    // Not [2, 5]: a click with nothing held says "this one", the way every file list does.
    expect(selectRow(first, 5).rows).toEqual([5])
  })

  it('leaves a row picked when it is picked again, rather than flickering it out', () => {
    // A plain pick is not a toggle. Letting go is the toggle, Clear selection, or a click
    // outside the tile — three ways out, and none of them is "click the same row twice".
    const one = selectRow(EMPTY_SELECTION, 2)

    expect(selectRow(one, 2).rows).toEqual([2])
  })

  it('adds a row with toggle, and takes the same row back out', () => {
    const one = selectRow(EMPTY_SELECTION, 2, { toggle: true })
    expect(one.rows).toEqual([2])

    expect(selectRow(one, 2, { toggle: true }).rows).toEqual([])
  })

  it('keeps the rows in row order however they were picked', () => {
    const picked = [5, 1, 3].reduce(selectRowAt, EMPTY_SELECTION)

    expect(picked.rows).toEqual([1, 3, 5])
  })

  it('anchors on a plain pick as well as a toggle, so shift extends from either', () => {
    const plain = selectRow(EMPTY_SELECTION, 4)

    expect(plain.anchor).toBe(4)
    expect(selectRow(plain, 6, { range: true }).rows).toEqual([4, 5, 6])
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
    const second = selectRow(selectRow(first, 3, { toggle: true }), 6, { range: true })

    expect(second.rows).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('lets a toggle build on a range without throwing the range away', () => {
    // The two gestures compose, which is the whole point of control and shift being separate
    // keys: pick a run, then add the odd one out further down.
    const run = selectRow(selectRow(EMPTY_SELECTION, 0), 2, { range: true })

    expect(selectRow(run, 7, { toggle: true }).rows).toEqual([0, 1, 2, 7])
  })

  it('shortens a span when it is dragged back the way it came, where a range would not', () => {
    // The one difference between the two, and the reason there are two. A shift-*click* is a
    // second aimed gesture, so it can only mean "and also these". A shift-*arrow* is the cursor
    // being dragged a row at a time, and one that could not be pulled back would be a selection
    // nobody could correct without starting over.
    const anchored = selectRow(EMPTY_SELECTION, 2)
    const reached = selectRow(anchored, 5, { span: true })
    expect(reached.rows).toEqual([2, 3, 4, 5])

    expect(selectRow(reached, 3, { span: true }).rows).toEqual([2, 3])
    expect(selectRow(reached, 3, { range: true }).rows).toEqual([2, 3, 4, 5])
  })

  it('drops whatever a span did not reach, rather than adding to it', () => {
    const stray = selectRow(selectRow(EMPTY_SELECTION, 8, { toggle: true }), 2)

    expect(selectRow(stray, 4, { span: true }).rows).toEqual([2, 3, 4])
  })

  it('keeps a span anchored, so reversing over it stays measured from the same end', () => {
    const anchored = selectRow(EMPTY_SELECTION, 4)

    expect(selectRow(anchored, 1, { span: true }).anchor).toBe(4)
    expect(selectRow(anchored, 1, { span: true }).rows).toEqual([1, 2, 3, 4])
  })

  it('counts a span along the drawn order, not up the stored numbers', () => {
    // Same reason a range does: the rows the two ends bracket are the rows *on screen*, and a
    // weight sort means those are not the rows the numbers bracket.
    const order = [3, 0, 2, 1]
    const anchored = selectRow(EMPTY_SELECTION, 3)

    expect(selectRow(anchored, 2, { span: true, order }).rows).toEqual([0, 2, 3])
  })

  it('falls back to naming one row when the anchor is no longer in the order', () => {
    // The hull the anchor named has been removed. Meaningless rather than wrong, so it means
    // the row that was actually asked for.
    const anchored = selectRow(EMPTY_SELECTION, 9)

    expect(selectRow(anchored, 2, { span: true, order: [0, 1, 2] }).rows).toEqual([2])
  })
})

describe('selectEvery', () => {
  it('takes every filled row, in row order whatever order they are drawn in', () => {
    expect(selectEvery([3, 0, 2], null).rows).toEqual([0, 2, 3])
  })

  it('anchors where the cursor already is, so a shift-arrow after it trims from there', () => {
    expect(selectEvery([0, 1, 2, 3], 2).anchor).toBe(2)
  })

  it('anchors on the first row when the cursor is nowhere in it', () => {
    expect(selectEvery([4, 5], null).anchor).toBe(4)
    expect(selectEvery([4, 5], 9).anchor).toBe(4)
  })

  it('is an empty selection over a comp with no hulls in it', () => {
    expect(selectEvery([], null)).toEqual(EMPTY_SELECTION)
  })
})

describe('navigableRows', () => {
  it('is every row of an arranged comp, gaps and all', () => {
    // Sort off is the mode where where a hull sits is something somebody decided, so every gap
    // is a place and every place is a stop.
    const rows = scaffold(judge(placed([0, SHIP.abaddon], [5, SHIP.rifter])), 8, {
      rows: [0, 5],
      sorted: false,
    })

    expect(navigableRows(rows, false).map((row) => row.row)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })

  it('collapses the blank lines under a sorted comp to the one that is somewhere to be', () => {
    // They all report the same `lands` — there is nowhere to choose between them — so eight of
    // the nine stops would be presses spent going nowhere.
    const rows = scaffold(judge(slots(SHIP.abaddon, SHIP.rifter)), 8)

    expect(navigableRows(rows, true).map((row) => row.row)).toEqual([0, 1, 2])
    expect(navigableRows(rows, true).filter((row) => row.kind === 'empty')).toHaveLength(1)
  })

  it('keeps every filled row whichever way the comp is drawn', () => {
    const rows = scaffold(judge(slots(SHIP.rifter, SHIP.abaddon)), 4)

    // Weight order puts the Abaddon first, and both are still stops.
    expect(navigableRows(rows, true).filter((row) => row.kind === 'ship')).toHaveLength(2)
  })

  it('is every row of a comp with no room left, there being no blank line to fold away', () => {
    const rows = scaffold(judge(slots(SHIP.abaddon, SHIP.rifter)), 2)

    expect(navigableRows(rows, true)).toHaveLength(2)
  })
})

function selectRowAt(selection: RowSelection, index: number): RowSelection {
  return selectRow(selection, index, { toggle: true })
}
