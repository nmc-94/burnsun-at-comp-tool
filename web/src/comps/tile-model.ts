// The arithmetic and shaping behind the comp tile, with no React in it.
//
// The tile itself is a rendering of `LegalityResult` — summary to the delta pill, slots to
// the row scaffold, violations to the popover — so everything here is about getting from a
// stored comp to that result, and back from the result to the rows a person clicks on.
//
// One rule governs the whole file: when a question is "what would this comp cost", the
// answer comes from building that comp and calling `evaluate` on it. Never from adjusting
// a number. The duplicate surcharge is retroactive, so adding or removing one hull changes
// the price of every other copy of it, and any hand-rolled delta is a second pricing rule
// waiting to disagree with the first.

import { evaluate } from '../engine'
import type {
  Comp,
  CompSlot,
  LegalityResult,
  LegalitySummary,
  Ruleset,
  RulesetShip,
  SlotEvaluation,
  Violation,
} from '../engine'

/** A hull the builder has placed, or an empty slot in the scaffold waiting for one. */
export type Row =
  | { readonly kind: 'ship'; readonly index: number; readonly slot: SlotEvaluation }
  | { readonly kind: 'empty'; readonly index: number }

/** The delta pill's three states. Under budget is legal, but not free. */
export type DeltaTone = 'exact' | 'under' | 'over'

export interface DeltaPill {
  readonly text: string
  readonly tone: DeltaTone
  /**
   * The same fact in words, for the accessible name.
   *
   * The pill reads `−12`, which is a signed distance from the cap and means nothing said
   * aloud on its own — and announcing the *total* instead, as this once did, contradicts
   * what the pill visibly says.
   */
  readonly label: string
}

/** A hull offered by the search, with what picking it would do to the comp. */
export interface Candidate {
  readonly ship: RulesetShip
  /** What the comp would cost afterwards, minus what it costs now. */
  readonly delta: number
  /** Violations the pick would introduce that are not already present. */
  readonly introduces: readonly Violation[]
}

/**
 * The fixed row scaffold: filled rows first, then empty ones to the field size.
 *
 * Normally exactly `fieldSize` rows, which is what makes the tile a fixed height. It grows
 * only for a comp that already holds more hulls than the format allows — nothing here
 * refuses that comp, so nothing here may hide it either. There is no empty row to click in
 * that state, which is the scaffold having run out rather than a rule being enforced.
 */
export function scaffold(result: LegalityResult, fieldSize: number): Row[] {
  const rows: Row[] = result.slots.map((slot, index) => ({ kind: 'ship', index, slot }))
  for (let index = rows.length; index < fieldSize; index += 1) {
    rows.push({ kind: 'empty', index })
  }
  return rows
}

/** The signed distance from the point cap, as the tile shows it. */
export function deltaPill(summary: LegalitySummary): DeltaPill {
  const delta = summary.pointsUsed - summary.pointCap
  const cap = summary.pointCap
  if (delta === 0) {
    return { text: '±0', tone: 'exact', label: `Exactly at the ${cap} point cap` }
  }
  if (delta < 0) {
    const under = Math.abs(delta)
    return { text: `−${under}`, tone: 'under', label: `${under} points under the ${cap} point cap` }
  }
  return { text: `+${delta}`, tone: 'over', label: `${delta} points over the ${cap} point cap` }
}

/** The comp as the engine wants it: hull choices in row order. */
export function toEngineComp(slots: readonly CompSlot[]): Comp {
  return { slots: slots.map((slot) => ({ typeId: slot.typeId, isFlagship: slot.isFlagship })) }
}

/**
 * The comp that would result from putting `typeId` in row `index` — or from emptying that
 * row, when `typeId` is null.
 *
 * An index past the end appends, which is how the scaffold's empty rows add a hull. The
 * flagship designation stays with the row, so swapping a hull under a flagship keeps it
 * flagship — whether the replacement is *eligible* is a rule, and the engine reports it
 * rather than this quietly dropping the designation.
 */
export function withRow(
  slots: readonly CompSlot[],
  index: number,
  typeId: number | null,
): CompSlot[] {
  if (typeId === null) return slots.filter((_, at) => at !== index)
  const existing = slots[index]
  const replacement: CompSlot = { typeId, isFlagship: existing?.isFlagship ?? false }
  if (!existing) return [...slots, replacement]
  return slots.map((slot, at) => (at === index ? replacement : slot))
}

/**
 * The rows at `indexes`, in row order.
 *
 * A filter rather than a map over the indexes, which makes it row-ordered, duplicate-free
 * and safe against an index past the end without any of the three being a separate check.
 */
export function slotsAt(slots: readonly CompSlot[], indexes: readonly number[]): CompSlot[] {
  const wanted = new Set(indexes)
  return slots.filter((_, at) => wanted.has(at))
}

/**
 * The comp with `typeIds` appended, which is what arriving from another tile looks like.
 *
 * It takes type ids rather than slots on purpose: a comp holds at most one flagship — the
 * database enforces it and the API answers a second one with a 409 — so a hull copied into
 * a comp that already has one must arrive as a plain hull. Carrying `CompSlot`s here would
 * make that a rule to remember; carrying ids makes it impossible to get wrong.
 */
export function withHullsAdded(
  slots: readonly CompSlot[],
  typeIds: readonly number[],
): CompSlot[] {
  return typeIds.reduce<CompSlot[]>(
    (built, typeId) => withRow(built, built.length, typeId),
    [...slots],
  )
}

/**
 * What the comp would look like with that row changed.
 *
 * The honest implementation of an in-place swap: build the candidate and judge it whole.
 * Removing the row's old hull is not a subtraction — with a retroactive surcharge it
 * re-prices every remaining copy of that hull, and adding the new one re-prices every copy
 * of *that* one. Only a second `evaluate` gets both right.
 */
export function previewRow(
  slots: readonly CompSlot[],
  index: number,
  typeId: number | null,
  ruleset: Ruleset,
): LegalityResult {
  return evaluate(toEngineComp(withRow(slots, index, typeId)), ruleset)
}

/**
 * What the comp would look like with those hulls added, judged whole for the same reason
 * `previewRow` is.
 *
 * The `ruleset` argument is the one that matters when this answers a question about another
 * tile's hulls: comps on one board can be pinned to different versions, so the ruleset here
 * must be the *receiving* comp's. A hull the receiving ruleset does not list arrives
 * unresolved and unpriced, which is a violation to report rather than a copy to refuse.
 */
export function previewHulls(
  slots: readonly CompSlot[],
  typeIds: readonly number[],
  ruleset: Ruleset,
): LegalityResult {
  return evaluate(toEngineComp(withHullsAdded(slots, typeIds)), ruleset)
}

/** Designate row `index` as the flagship, clearing whatever held it before. */
export function withFlagship(slots: readonly CompSlot[], index: number | null): CompSlot[] {
  return slots.map((slot, at) => ({ typeId: slot.typeId, isFlagship: at === index }))
}

/**
 * Whether the row offers the flagship star at all.
 *
 * §4.2 says a slot may be designated "only if flagship-eligible", and in this format that is
 * battleships minus a short list — so on a comp of ten the star used to sit on ten rows and
 * mean something on two. The engine's answer to the other eight was a violation raised the
 * moment one was clicked, which is a rule being reported after the fact rather than a control
 * that was never offered.
 *
 * The exception is a row that already *holds* the designation, and it is the load-bearing half.
 * A swap keeps it (see `withRow`, and §4.2), a comp can be re-pinned to a version that forbids
 * flagships outright, and the API can hand one over — three ways into a state whose only way
 * out is this button. Hiding it there would leave `flagship-not-eligible` reported with nothing
 * to act on, which is the one thing "rules are reported, never enforced" does not allow.
 */
export function offersFlagship(ruleset: Ruleset, slot: SlotEvaluation): boolean {
  if (slot.isFlagship) return true
  return ruleset.flagship.allowed && ruleset.ships[slot.typeId]?.flagshipEligible === true
}

/**
 * Which rows of one tile are picked out, for porting or copying elsewhere.
 *
 * Rows, not comps. The URL's `?sel=` names *comps*; this is a text-selection gesture inside
 * a single tile, it is ephemeral, and it belongs nowhere near the address bar. The two are
 * different things at different scales and they want the same words, so they do not get
 * them.
 *
 * The anchor is where a range extends from — the last row touched without shift.
 */
export interface RowSelection {
  readonly rows: readonly number[]
  readonly anchor: number | null
}

export const EMPTY_SELECTION: RowSelection = { rows: [], anchor: null }

/**
 * Row `index` picked, or unpicked.
 *
 * The three gestures every list of rows answers to, and they are deliberately the ones a file
 * list uses rather than a set invented here. **Plain replaces**: clicking a row means "this
 * one", so whatever was picked before lets go. **Toggle** — control or command held, and the
 * row's own select box, because a checkbox that cleared its neighbours would be lying about
 * what it is — adds or removes the one row and leaves the rest alone. **Range** extends from
 * the anchor by union, so a range only ever adds; the way back out is a toggle on a row in it.
 *
 * The anchor is the last row touched *without* shift, which is what makes a second shift-click
 * re-extend from where the person last pointed rather than from wherever the last range ended.
 */
export function selectRow(
  selection: RowSelection,
  index: number,
  options?: { readonly range?: boolean; readonly toggle?: boolean },
): RowSelection {
  if (options?.range && selection.anchor !== null) {
    const held = new Set(selection.rows)
    const from = Math.min(selection.anchor, index)
    const to = Math.max(selection.anchor, index)
    for (let at = from; at <= to; at += 1) held.add(at)
    // The anchor stays put, so a second shift-click re-extends from where the range began
    // rather than from where the last one ended.
    return { rows: [...held].sort(ascending), anchor: selection.anchor }
  }

  if (options?.toggle) {
    const held = new Set(selection.rows)
    if (held.has(index)) held.delete(index)
    else held.add(index)
    return { rows: [...held].sort(ascending), anchor: index }
  }

  return { rows: [index], anchor: index }
}

function ascending(a: number, b: number): number {
  return a - b
}

/**
 * Which rows a violation blames, as a set the tile can highlight.
 *
 * Comp-wide violations blame nothing and contribute no rows. Note the engine deliberately
 * leaves logistics hulls out of a hull-size cap's slots: they are exempt from the cap, so
 * offering them up as something to drop would be wrong advice.
 */
export function rowsBlamedBy(violations: readonly Violation[]): Set<number> {
  const blamed = new Set<number>()
  for (const violation of violations) {
    for (const index of violation.slotIndexes) blamed.add(index)
  }
  return blamed
}

/** The violations in `after` that were not already in `before`, compared by code. */
export function introducedBy(
  before: readonly Violation[],
  after: readonly Violation[],
): Violation[] {
  const had = new Set(before.map((violation) => violation.code))
  return after.filter((violation) => !had.has(violation.code))
}

function score(name: string, query: string): number {
  const at = name.toLowerCase().indexOf(query)
  if (at < 0) return -1
  // A prefix match is what someone typing a hull name is almost always after, so it wins
  // over the same string buried mid-name.
  return at === 0 ? 2 : 1
}

/**
 * Hulls matching `query`, best first.
 *
 * The roster is the ruleset's own list and nothing else, so a hull that resolves to no
 * point value can never be picked from here. Everything the ruleset does list is offered,
 * including hulls that would break a rule — the search annotates, it does not gate.
 */
export function searchHulls(ruleset: Ruleset, query: string, limit = 20): RulesetShip[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  const matches: { ship: RulesetShip; rank: number }[] = []
  for (const ship of Object.values(ruleset.ships)) {
    const rank = score(ship.name, needle)
    if (rank > 0) matches.push({ ship, rank })
  }
  matches.sort((a, b) => b.rank - a.rank || a.ship.name.localeCompare(b.ship.name))
  return matches.slice(0, limit).map((match) => match.ship)
}

/**
 * Annotate each hull with what putting it in row `index` would cost and break.
 *
 * Deliberately takes the already-filtered list: this runs `evaluate` once per candidate,
 * on every keystroke, and the roster is a few hundred hulls long.
 */
export function annotate(
  ships: readonly RulesetShip[],
  slots: readonly CompSlot[],
  index: number,
  ruleset: Ruleset,
  current: LegalityResult,
): Candidate[] {
  return ships.map((ship) => {
    const after = previewRow(slots, index, ship.typeId, ruleset)
    return {
      ship,
      delta: after.summary.pointsUsed - current.summary.pointsUsed,
      introduces: introducedBy(current.violations, after.violations),
    }
  })
}
